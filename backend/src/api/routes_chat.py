import asyncio
import json
import time
import uuid
import logging

from fastapi import APIRouter, Request as HTTPRequest
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Agent persona map ─────────────────────────────────────────────────────────
# Maps each tool to a named "agent" shown in the Activity panel
_TOOL_AGENT: dict[str, tuple[str, str]] = {
    "search_metadata":     ("DataAgent",      "search"),
    "execute_sql":         ("DataAgent",      "database"),
    "create_visualization":("VizAgent",       "chart-bar"),
    "create_kpi_tile":     ("VizAgent",       "chart-bar"),
    "create_text_tile":    ("VizAgent",       "file-text"),
    "create_data_table":   ("VizAgent",       "table"),
    "update_data_table":   ("VizAgent",       "table"),
    "modify_dashboard":    ("DashboardAgent", "layout"),
    "remove_tiles":        ("DashboardAgent", "trash"),
}


def _input_summary(tool_name: str, args: dict) -> str:
    """One-line description of what a tool is about to do."""
    if tool_name == "search_metadata":
        q = args.get("query", "")
        return f'Searching: "{q[:80]}"'
    if tool_name == "execute_sql":
        sql = args.get("sql", "").replace("\n", " ").strip()
        return sql[:130] + ("…" if len(sql) > 130 else "")
    if tool_name == "create_visualization":
        try:
            spec = json.loads(args.get("vega_lite_spec", "{}"))
            mark = spec.get("mark", "?")
            if isinstance(mark, dict):
                mark = mark.get("type", "?")
            return f"Building {mark} chart"
        except Exception:
            return "Building visualization"
    if tool_name == "create_data_table":
        return f'Creating table: "{args.get("title", "")}"'
    if tool_name == "update_data_table":
        return f'Updating table: "{args.get("title", "")}"'
    if tool_name == "modify_dashboard":
        try:
            mods = json.loads(args.get("modifications", "{}"))
            parts: list[str] = []
            if mods.get("spec_updates"):
                parts.append(f"{len(mods['spec_updates'])} chart spec(s)")
            if mods.get("layout_updates"):
                parts.append(f"{len(mods['layout_updates'])} layout(s)")
            if mods.get("title_updates"):
                parts.append(f"{len(mods['title_updates'])} title(s)")
            return "Modifying: " + ", ".join(parts) if parts else "Modifying dashboard"
        except Exception:
            return "Modifying dashboard"
    if tool_name == "remove_tiles":
        n = len(args.get("tile_ids", []))
        return f"Removing {n} tile{'s' if n != 1 else ''}"
    return tool_name


def _output_summary(tool_name: str, result_str: str) -> str:
    """One-line description of what a tool returned."""
    try:
        result = json.loads(result_str)
    except Exception:
        return "Done"
    if isinstance(result, dict) and result.get("error"):
        return f"Error: {str(result['error'])[:80]}"
    if tool_name == "search_metadata":
        tables = result if isinstance(result, list) else []
        names = ", ".join(t.get("cube", "") for t in tables[:3])
        return f"Found {len(tables)} table(s): {names}"
    if tool_name == "execute_sql":
        rows = result.get("rows", [])
        cols = list(rows[0].keys()) if rows else []
        col_str = ", ".join(cols[:5]) + ("…" if len(cols) > 5 else "")
        return f"Returned {len(rows)} rows — columns: {col_str}"
    if tool_name == "create_visualization":
        spec = result.get("vega_spec", {})
        mark = spec.get("mark", "?")
        if isinstance(mark, dict):
            mark = mark.get("type", "?")
        n = len((spec.get("data") or {}).get("values", []))
        return f"Chart created ({mark}, {n} data points)"
    if tool_name == "create_data_table":
        return (f"Table created — "
                f"{len(result.get('rows', []))} rows × "
                f"{len(result.get('columns', []))} columns")
    if tool_name == "update_data_table":
        return f"Table updated — {len(result.get('rows', []))} rows"
    if tool_name == "modify_dashboard":
        parts = []
        if result.get("spec_updates"):
            parts.append(f"{len(result['spec_updates'])} chart(s)")
        if result.get("layout_updates"):
            parts.append(f"{len(result['layout_updates'])} layout(s)")
        if result.get("title_updates"):
            parts.append(f"{len(result['title_updates'])} title(s)")
        return "Updated: " + ", ".join(parts) if parts else "Dashboard modified"
    if tool_name == "remove_tiles":
        n = len(result.get("tile_ids", []))
        return f"Removed {n} tile{'s' if n != 1 else ''}"
    return "Done"


def _agent_step(step_id: str, phase: str, agent: str, icon: str,
                summary: str, status: str = "done",
                tool: str | None = None,
                elapsed_ms: int | None = None) -> dict:
    """Build an agent_step SSE event dict."""
    payload: dict = {
        "step_id": step_id,
        "phase": phase,       # thinking | call | result | final
        "agent": agent,
        "icon": icon,
        "summary": summary,
        "status": status,     # running | done | error
        "ts": int(time.time() * 1000),
    }
    if tool is not None:
        payload["tool"] = tool
    if elapsed_ms is not None:
        payload["elapsed_ms"] = elapsed_ms
    return {
        "event": "agent_step",
        "data": json.dumps(payload),
    }


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    llm_model: str | None = None
    current_tiles: list[dict] = []   # [{tile_id, title, vega_spec, layout}, ...]
    chat_history: list[dict] = []    # [{role, content}, ...]


# Hardcoded fallback spec for when the agent is not configured
FALLBACK_VEGA_SPEC = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "title": "Sample Sales by Category",
    "width": "container",
    "height": 300,
    "data": {
        "values": [
            {"category": "Electronics", "sales": 45000},
            {"category": "Clothing", "sales": 32000},
            {"category": "Food", "sales": 28000},
            {"category": "Books", "sales": 15000},
            {"category": "Toys", "sales": 21000},
        ]
    },
    "mark": "bar",
    "encoding": {
        "x": {"field": "category", "type": "nominal", "title": "Category"},
        "y": {"field": "sales", "type": "quantitative", "title": "Sales ($)"},
        "color": {"field": "category", "type": "nominal", "legend": None},
    },
}


def _parse_tool_result(tool_name: str, result_str: str):
    """Parse a ToolMessage result string and yield SSE events."""
    try:
        result = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return  # not JSON — skip

    if tool_name == "search_metadata":
        tables = result if isinstance(result, list) else []
        yield {
            "event": "metadata",
            "data": json.dumps({
                "node": "search",
                "tables": [m.get("cube", "") for m in tables],
                "measures": tables,
            }),
        }
        yield {
            "event": "thinking",
            "data": json.dumps({
                "node": "search",
                "message": f"Found {len(tables)} relevant data source(s). Writing SQL...",
            }),
        }

    elif tool_name == "execute_sql":
        if not result.get("error"):
            rows = result.get("rows", [])
            yield {
                "event": "query",
                "data": json.dumps({
                    "results": rows,
                    "row_count": result.get("row_count", len(rows)),
                }),
            }
            yield {
                "event": "thinking",
                "data": json.dumps({
                    "node": "query",
                    "message": f"Got {len(rows)} rows. Building visualization...",
                }),
            }

    elif tool_name == "create_visualization":
        if not result.get("error") and result.get("vega_spec"):
            yield {
                "event": "visualization",
                "data": json.dumps({
                    "vega_spec": result["vega_spec"],
                    "tile_id": result.get("tile_id", str(uuid.uuid4())),
                }),
            }

    elif tool_name == "create_kpi_tile":
        if not result.get("error"):
            # Parse sparkline JSON array if provided
            sparkline = None
            if result.get("sparkline_data"):
                try:
                    sparkline = json.loads(result["sparkline_data"])
                    if not isinstance(sparkline, list):
                        sparkline = None
                except Exception:
                    pass

            yield {
                "event": "kpi_tile",
                "data": json.dumps({
                    "tile_id": result.get("tile_id"),
                    "title":    result.get("title", ""),
                    "value":    result.get("value", ""),
                    "subtitle": result.get("subtitle", ""),
                    "color":    result.get("color", ""),
                    "sparkline": sparkline,
                }),
            }

    elif tool_name == "create_text_tile":
        if not result.get("error"):
            yield {
                "event": "text_tile",
                "data": json.dumps({
                    "tile_id": result.get("tile_id"),
                    "title": result.get("title", ""),
                    "markdown": result.get("markdown", ""),
                }),
            }

    elif tool_name == "create_data_table":
        if not result.get("error"):
            yield {
                "event": "data_table",
                "data": json.dumps({
                    "tile_id": result.get("tile_id"),
                    "title": result.get("title", "Table"),
                    "columns": result.get("columns", []),
                    "rows": result.get("rows", []),
                }),
            }

    elif tool_name == "update_data_table":
        if not result.get("error"):
            yield {
                "event": "update_data_table",
                "data": json.dumps({
                    "tile_id": result.get("tile_id"),
                    "title": result.get("title", "Table"),
                    "columns": result.get("columns", []),
                    "rows": result.get("rows", []),
                }),
            }

    elif tool_name == "remove_tiles":
        if not result.get("error"):
            for tid in result.get("tile_ids", []):
                yield {
                    "event": "remove_tile",
                    "data": json.dumps({"tile_id": tid}),
                }

    elif tool_name == "modify_dashboard":
        if not result.get("error"):
            spec_updates = result.get("spec_updates", [])
            layout_updates = result.get("layout_updates", [])
            title_updates = result.get("title_updates", [])
            text_updates = result.get("text_updates", [])

            for su in spec_updates:
                yield {
                    "event": "update_visualization",
                    "data": json.dumps({
                        "vega_spec": su.get("vega_spec"),
                        "tile_id": su.get("tile_id"),
                    }),
                }

            if layout_updates:
                yield {
                    "event": "update_layout",
                    "data": json.dumps({"layouts": layout_updates}),
                }

            for tu in title_updates:
                yield {
                    "event": "update_tile_title",
                    "data": json.dumps({
                        "tile_id": tu.get("tile_id"),
                        "title": tu.get("title"),
                    }),
                }
            
            for txt_u in text_updates:
                yield {
                    "event": "update_text",
                    "data": json.dumps({
                        "tile_id": txt_u.get("tile_id"),
                        "markdown": txt_u.get("markdown"),
                    })
                }


def _process_graph_event(
    node_name: str,
    node_output: dict,
    run_id: str,
    call_start: dict[str, float],
    stream_ctx: dict | None = None,
) -> list[dict]:
    """Convert one LangGraph node-update into a list of SSE event dicts."""
    events: list[dict] = []

    if node_name == "guardrail":
        for msg in node_output.get("messages", []):
            if isinstance(msg, AIMessage) and msg.content:
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                logger.info("[GUARDRAIL] refusal response len=%d", len(content))
                events.append(_agent_step(
                    step_id=f"{run_id}-guard", phase="final",
                    agent="Orchestrator", icon="shield",
                    summary="Security check: Out of scope",
                    status="error",
                ))
                events.append({"event": "message", "data": json.dumps({"content": content})})
        
        # If it was IN_SCOPE, we might want to show a subtle "Security check: OK" or just nothing.
        # Let's show a subtle update if it's NOT a refusal.
        if not events:
            events.append(_agent_step(
                step_id=f"{run_id}-guard", phase="thinking",
                agent="Orchestrator", icon="shield",
                summary="Security check: OK",
                status="done",
            ))

    elif node_name == "agent":
        for msg in node_output.get("messages", []):
            if not isinstance(msg, AIMessage):
                continue
            if msg.tool_calls:
                tool_names = [tc["name"] for tc in msg.tool_calls]
                logger.info("[AGENT] calling tools: %s", tool_names)
                events.append(_agent_step(
                    step_id=f"{run_id}-init", phase="thinking",
                    agent="Orchestrator", icon="brain",
                    summary=f"Decided to use: {', '.join(n.replace('_', ' ') for n in tool_names)}",
                    status="done",
                ))
                for tc in msg.tool_calls:
                    # Track SQL from execute_sql for live chart support
                    if stream_ctx is not None and tc["name"] == "execute_sql":
                        stream_ctx["last_sql"] = tc.get("args", {}).get("sql")
                    agent_name, icon = _TOOL_AGENT.get(tc["name"], ("Agent", "cpu"))
                    call_start[tc["id"]] = time.time()
                    events.append(_agent_step(
                        step_id=tc["id"], phase="call",
                        agent=agent_name, icon=icon, tool=tc["name"],
                        summary=_input_summary(tc["name"], tc.get("args", {})),
                        status="running",
                    ))
                friendly = ", ".join(n.replace("_", " ") for n in tool_names)
                events.append({
                    "event": "thinking",
                    "data": json.dumps({"node": "agent", "message": f"Using: {friendly}…"}),
                })
            elif msg.content:
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                logger.info("[AGENT] final response len=%d", len(content))
                events.append(_agent_step(
                    step_id=f"{run_id}-final", phase="final",
                    agent="Orchestrator", icon="brain",
                    summary=content[:200] + ("…" if len(content) > 200 else ""),
                    status="done",
                ))
                events.append({"event": "message", "data": json.dumps({"content": content})})

    elif node_name == "tools":
        # Build tool_call_id → name map from AIMessages in the same output
        # (ToolMessage.name may be None in some LangChain versions)
        tc_name_map: dict[str, str] = {}
        for msg in node_output.get("messages", []):
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    tc_name_map[tc["id"]] = tc["name"]

        for msg in node_output.get("messages", []):
            if not isinstance(msg, ToolMessage):
                continue
            tool_name = msg.name or tc_name_map.get(msg.tool_call_id, "tool")
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            logger.info("[TOOL] %s → %s", tool_name, content[:200])
            elapsed = None
            if msg.tool_call_id in call_start:
                elapsed = int((time.time() - call_start.pop(msg.tool_call_id)) * 1000)
            try:
                is_error = bool(json.loads(content).get("error"))
            except Exception:
                is_error = False
            agent_name, icon = _TOOL_AGENT.get(tool_name, ("Agent", "cpu"))
            events.append(_agent_step(
                step_id=msg.tool_call_id, phase="result",
                agent=agent_name, icon=icon, tool=tool_name,
                summary=_output_summary(tool_name, content),
                status="error" if is_error else "done",
                elapsed_ms=elapsed,
            ))
            tool_events = list(_parse_tool_result(tool_name, content))
            # Inject query_meta into visualization / data_table events for live chart support
            if (
                stream_ctx is not None
                and tool_name in ("create_visualization", "create_data_table")
                and stream_ctx.get("last_sql")
            ):
                from src.api.routes_charts import detect_sql_params

                for evt in tool_events:
                    if evt.get("event") in ("visualization", "data_table"):
                        try:
                            evt_data = json.loads(evt["data"])
                            evt_data["query_meta"] = {
                                "sql": stream_ctx["last_sql"],
                                "params": detect_sql_params(stream_ctx["last_sql"]),
                            }
                            evt["data"] = json.dumps(evt_data)
                        except (json.JSONDecodeError, KeyError):
                            pass
            events.extend(tool_events)

    return events


async def _agent_event_generator(request: ChatRequest, http_request: HTTPRequest):
    """Run the LangGraph ReAct agent and stream SSE events.

    The agent runs in a background asyncio.Task.  While the task runs we poll
    http_request.is_disconnected() every 0.3 s so that clicking Stop (or
    closing the browser tab) cancels the LangGraph stream immediately.
    """
    session_id = request.session_id or str(uuid.uuid4())
    logger.info("─" * 60)
    logger.info("[CHAT] session=%s  msg=%r", session_id, request.message)

    run_id = str(uuid.uuid4())
    call_start: dict[str, float] = {}
    stream_ctx: dict = {"last_sql": None}
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    # ── background task: run agent and push events into queue ────────────────
    async def _stream_task() -> None:
        try:
            from src.agent.graph import agent_graph

            # Emit initial thinking before we even hit the LLM
            await queue.put(_agent_step(
                step_id=f"{run_id}-init", phase="thinking",
                agent="Orchestrator", icon="brain",
                summary="Analyzing request…", status="running",
            ))

            history_messages = []
            for item in request.chat_history:
                role, text = item.get("role", ""), item.get("content", "")
                if not text:
                    continue
                if role == "user":
                    history_messages.append(HumanMessage(content=text))
                elif role == "assistant":
                    history_messages.append(AIMessage(content=text))

            initial_state = {
                "messages": history_messages + [HumanMessage(content=request.message)],
                "current_tiles": request.current_tiles,
                "chat_history": request.chat_history,
                "llm_model": request.llm_model,
                "guardrail_result": None,
            }

            async for graph_event in agent_graph.astream(
                initial_state,
                config={"recursion_limit": 50},
                stream_mode="updates",
            ):
                for node_name, node_output in graph_event.items():
                    logger.info("[NODE] %s → keys=%s", node_name, list(node_output.keys()))
                    for sse in _process_graph_event(node_name, node_output, run_id, call_start, stream_ctx):
                        await queue.put(sse)

        except asyncio.CancelledError:
            logger.info("[CHAT] stream task cancelled (client disconnected)")
        except Exception as e:
            logger.exception("[CHAT] Agent execution failed: %s", e)
            await queue.put(_agent_step(
                step_id=f"{run_id}-error", phase="final",
                agent="Orchestrator", icon="brain",
                summary=f"Error: {str(e)[:120]}", status="error",
            ))
            await queue.put({"event": "error", "data": json.dumps({"message": str(e)})})
        finally:
            logger.info("[CHAT] session=%s  done", session_id)
            await queue.put({"event": "done", "data": json.dumps({"session_id": session_id, "run_id": run_id})})
            await queue.put(None)  # sentinel: stream finished

    task = asyncio.create_task(_stream_task())

    # ── forward queue events to SSE; cancel agent on disconnect ──────────────
    try:
        while True:
            if await http_request.is_disconnected():
                logger.info("[CHAT] client disconnected — cancelling agent task")
                task.cancel()
                return
            try:
                item = await asyncio.wait_for(queue.get(), timeout=0.3)
            except asyncio.TimeoutError:
                continue
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


async def _fallback_event_generator(request: ChatRequest):
    """Fallback SSE generator that returns hardcoded data (no LLM required)."""
    session_id = request.session_id or str(uuid.uuid4())

    yield {
        "event": "thinking",
        "data": json.dumps({"node": "router", "message": "Processing your request..."}),
    }

    yield {
        "event": "message",
        "data": json.dumps({"content": f'Here\'s a sample chart for: "{request.message}"'}),
    }

    tile_id = str(uuid.uuid4())
    yield {
        "event": "visualization",
        "data": json.dumps({"vega_spec": FALLBACK_VEGA_SPEC, "tile_id": tile_id}),
    }

    yield {
        "event": "done",
        "data": json.dumps({"session_id": session_id}),
    }


@router.post("/chat")
async def chat(request: ChatRequest, http_request: HTTPRequest):
    return EventSourceResponse(_agent_event_generator(request, http_request))


@router.post("/chat/fallback")
async def chat_fallback(request: ChatRequest):
    """Fallback endpoint that works without LLM configuration."""
    return EventSourceResponse(_fallback_event_generator(request))


@router.get("/chat/models")
async def list_models():
    """Return a list of available models based on LLM mode dynamically from providers."""
    from src.config import settings
    mode = settings.llm_mode.strip().lower()
    
    if mode == "gemini":
        try:
            import google.generativeai as genai
            genai.configure(api_key=settings.gemini_api_key)
            models = []
            for m in genai.list_models():
                if "generateContent" in m.supported_generation_methods:
                    models.append(m.name.replace("models/", ""))
            models.sort(reverse=True) # Usually newer models are alphabetically/numerically higher
            if not models:
                models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-pro"]
            return {"mode": "gemini", "models": models}
        except Exception as e:
            logger.warning("Failed to fetch dynamic Gemini models: %s", e)
            return {"mode": "gemini", "models": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-pro"]}

    elif mode == "openai":
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url or None)
            model_list = await client.models.list()
            # Filter to likely chat models
            models = [m.id for m in model_list.data if "gpt" in m.id or "o1" in m.id or "o3" in m.id]
            models.sort(reverse=True)
            if not models:
                models = ["gpt-4o", "gpt-4-turbo", "gpt-4o-mini", "gpt-3.5-turbo"]
            return {"mode": "openai", "models": models}
        except Exception as e:
            logger.warning("Failed to fetch dynamic OpenAI models: %s", e)
            return {"mode": "openai", "models": ["gpt-4o", "gpt-4-turbo", "gpt-4o-mini", "gpt-3.5-turbo"]}
            
    return {"mode": mode, "models": ["default"]}
