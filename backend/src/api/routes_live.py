import asyncio
import hashlib
import json
import logging
import time
import uuid
from contextvars import ContextVar
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from google import adk
import google.adk.sessions as sessions
from google.adk.agents import LiveRequestQueue
from google.genai import types

from src.agent.agent_adk import get_adk_agent
from src.api.live_session_state import LiveSessionCoordinator, TurnLifecycleState

logger = logging.getLogger(__name__)
router = APIRouter()

class NormalClosureFilter(logging.Filter):
    """Suppresses misleading 1000 None APIErrors from ADK/GenAI during clean closure."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if "1000 None" in msg or "ConnectionClosedOK" in msg:
            return False
        return True


adk_logger = logging.getLogger("google_adk.google.adk.flows.llm_flows.base_llm_flow")
adk_logger.addFilter(NormalClosureFilter())


_session_activity_log: ContextVar[list[str]] = ContextVar("_session_activity_log", default=[])
_current_websocket: ContextVar[WebSocket | None] = ContextVar("_current_websocket", default=None)
_current_step_id: ContextVar[str | None] = ContextVar("_current_step_id", default=None)


def get_session_activity() -> list[str]:
    """Helper for the get_recent_activity tool to access current session history."""
    return _session_activity_log.get()


@router.websocket("/agent/live")
async def websocket_endpoint(websocket: WebSocket):
    logger.info("[WS] Incoming connection request from %s", websocket.client)
    await websocket.accept()
    logger.info("[WS] Connection ACCEPTED for %s", websocket.client)

    log: list[str] = []
    _session_activity_log.set(log)
    _current_websocket.set(websocket)

    agent = get_adk_agent(
        "Dashboard state will be provided by context_update messages; do not assume it is empty."
    )

    session_service = sessions.InMemorySessionService()
    live_request_queue = LiveRequestQueue()
    runner = adk.Runner(
        agent=agent,
        session_service=session_service,
        app_name="AgenticBoards",
    )

    coordinator = LiveSessionCoordinator()

    stop_event = asyncio.Event()
    live_request_queue_closed = False
    last_sql_info = {"sql": None, "provider": "bigquery"}
    processed_tool_call_keys: set[str] = set()
    initial_context_synced = False

    async def send_json_safe(payload: dict[str, Any]) -> bool:
        if websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    async def send_turn_state(state: str, turn_id: str | None = None, tool: str | None = None):
        payload: dict[str, Any] = {"type": "turn_state", "state": state}
        if turn_id:
            payload["turn_id"] = turn_id
        if tool:
            payload["tool"] = tool
        await send_json_safe(payload)

    def build_tool_call_key(fc: Any, turn_id: str) -> tuple[str, str | None]:
        call_id = getattr(fc, "id", None) or getattr(fc, "call_id", None)
        args = fc.args if isinstance(fc.args, dict) else {"_raw": str(fc.args)}
        signature = json.dumps(
            {"turn_id": turn_id, "name": fc.name, "args": args},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        # Deduplicate side-effectful tool events by semantic signature per turn.
        # Call IDs are still forwarded for observability/debugging.
        return f"sig:{hashlib.sha1(signature.encode('utf-8')).hexdigest()}", str(call_id) if call_id else None

    async def ensure_model_turn_started() -> str:
        started, turn_id = coordinator.mark_model_activity()
        if started:
            logger.info("[WS] Turn started: %s", turn_id)
            await send_turn_state("model_start", turn_id)
        return turn_id

    def build_context_injection(data: dict[str, Any]) -> str:
        tiles = data.get("tiles", [])
        provider = data.get("database_provider", "databricks")
        connection_flag = f"[ACTIVE CONNECTION: {provider.upper()}]"
        return (
            f"SYSTEM NOTIFICATION: {connection_flag}\n"
            "The user has updated or loaded a dashboard session. "
            f"Current tiles: {json.dumps(tiles)}. "
            "Update your internal memory with these tile names and IDs immediately. "
            "STRICTLY follow the ACTIVE CONNECTION flag when choosing SQL executors. "
            "DO NOT call any tools or speak in response to this message. "
            "Wait for the user to speak or ask a question before taking any action."
        )

    async def flush_pending_context_if_safe():
        nonlocal initial_context_synced
        if not coordinator.should_flush_context():
            return

        pending = coordinator.consume_pending_context()
        if not pending:
            return

        try:
            tiles = pending.payload.get("tiles", [])
            logger.info("[WS] Flushing queued context_update (%s tiles)", len(tiles))
            live_request_queue.send_content(
                types.Content(
                    parts=[types.Part(text=build_context_injection(pending.payload))],
                    role="user",
                )
            )
            coordinator.last_context_hash = pending.payload_hash
            if not initial_context_synced:
                await send_json_safe({"type": "context_sync", "state": "received", "tiles": len(tiles)})
                initial_context_synced = True
        except Exception as e:
            logger.error("[WS] Failed to inject queued context_update: %s", e)
            coordinator.pending_context = pending

    async def maybe_emit_model_end(force: bool = False):
        ended_turn_id = coordinator.maybe_end_turn_on_idle(force=force)
        if not ended_turn_id:
            return

        logger.info("[WS] Turn ended: %s", ended_turn_id)
        await send_turn_state("model_end", ended_turn_id)
        await flush_pending_context_if_safe()

    async def safe_close_live_request_queue():
        nonlocal live_request_queue_closed
        if live_request_queue_closed:
            return
        live_request_queue_closed = True
        try:
            live_request_queue.close()
        except Exception as e:
            logger.warning("[WS] LiveRequestQueue close failed: %s", e)

    async def upstream():
        try:
            while not stop_event.is_set():
                msg = await websocket.receive()

                if msg["type"] == "websocket.disconnect":
                    logger.info("[WS] Client disconnected via websocket.disconnect")
                    break

                if "bytes" in msg and msg["bytes"] is not None:
                    live_request_queue.send_realtime(
                        types.Blob(data=msg["bytes"], mime_type="audio/pcm;rate=16000")
                    )
                    continue

                if "text" not in msg or msg["text"] is None:
                    continue

                try:
                    data = json.loads(msg["text"])
                except Exception as e:
                    logger.error("[WS] Failed to parse JSON message: %s", e)
                    continue

                msg_type = data.get("type")
                logger.info("[WS] Received text message: %s", msg_type)

                if msg_type != "context_update":
                    continue

                queued = coordinator.queue_context_update(data)
                if not queued:
                    logger.info("[WS] Ignored duplicate context_update")
                    continue

                if coordinator.turn_state == TurnLifecycleState.IDLE:
                    await flush_pending_context_if_safe()
                else:
                    logger.info("[WS] Queued context_update for safe boundary flush")

        except WebSocketDisconnect:
            logger.info("[WS] Client disconnected.")
        except Exception as e:
            logger.error("[WS] Upstream error: %s", e)
        finally:
            await safe_close_live_request_queue()

    async def idle_watcher():
        try:
            while not stop_event.is_set():
                await asyncio.sleep(0.2)
                await maybe_emit_model_end(force=False)
        except asyncio.CancelledError:
            pass

    upstream_task = asyncio.create_task(upstream())
    idle_task = asyncio.create_task(idle_watcher())

    try:
        user_id = "default_user"
        session_id = "live_session_01"
        app_name = "AgenticBoards"

        await session_service.create_session(user_id=user_id, session_id=session_id, app_name=app_name)
        logger.info("[WS] Session created for %s/%s", user_id, session_id)

        async for event in runner.run_live(
            live_request_queue=live_request_queue,
            user_id=user_id,
            session_id=session_id,
        ):
            if websocket.client_state != WebSocketState.CONNECTED:
                logger.info("[WS] Websocket not connected (%s)", websocket.client_state)
                break

            try:
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.inline_data and part.inline_data.data:
                            await ensure_model_turn_started()
                            logger.info("[WS] Model audio chunk received (%s bytes)", len(part.inline_data.data))
                            await websocket.send_bytes(part.inline_data.data)
                        elif part.thought:
                            await ensure_model_turn_started()
                            await send_json_safe(
                                {
                                    "type": "agent_activity",
                                    "step": {
                                        "step_id": str(uuid.uuid4()),
                                        "phase": "reasoning",
                                        "agent": "Orchestrator",
                                        "icon": "brain",
                                        "summary": part.thought[:150] + ("..." if len(part.thought) > 150 else ""),
                                        "status": "done",
                                        "ts": int(time.time() * 1000),
                                    },
                                }
                            )
                        elif part.text:
                            await ensure_model_turn_started()
                            logger.info("[WS] Agent text: %s", part.text)
                            log.append(f"Responded with text: {part.text[:50]}...")
                            await send_json_safe(
                                {
                                    "type": "agent_activity",
                                    "step": {
                                        "step_id": str(uuid.uuid4()),
                                        "phase": "final",
                                        "agent": "Orchestrator",
                                        "icon": "brain",
                                        "summary": part.text[:100] + ("..." if len(part.text) > 100 else ""),
                                        "status": "done",
                                        "ts": int(time.time() * 1000),
                                    },
                                }
                            )

                func_calls = event.get_function_calls()
                if func_calls:
                    turn_id = await ensure_model_turn_started()

                    for fc in func_calls:
                        tool_call_key, tool_call_id = build_tool_call_key(fc, turn_id)
                        if tool_call_key in processed_tool_call_keys:
                            logger.info("[WS] Skipping duplicate tool_call event: %s", tool_call_key)
                            continue
                        processed_tool_call_keys.add(tool_call_key)
                        if len(processed_tool_call_keys) > 4000:
                            processed_tool_call_keys.clear()

                        logger.info("[WS] Agent tool call: %s", fc.name)
                        log.append(f"Called tool: {fc.name}")
                        if fc.name == "modify_dashboard":
                            logger.info("[WS] modify_dashboard args: %s", str(fc.args)[:800])

                        if fc.name == "execute_bigquery":
                            last_sql_info["sql"] = fc.args.get("sql")
                            last_sql_info["provider"] = "bigquery"
                        elif fc.name == "execute_sql":
                            last_sql_info["sql"] = fc.args.get("sql")
                            last_sql_info["provider"] = "databricks"

                        await send_turn_state("tool_start", turn_id, fc.name)

                        payload: dict[str, Any] = {
                            "type": "tool_call",
                            "name": fc.name,
                            "args": fc.args,
                            "turn_id": turn_id,
                            "tool_call_key": tool_call_key,
                        }
                        if tool_call_id:
                            payload["tool_call_id"] = tool_call_id
                        if fc.name in ("create_visualization", "create_data_table", "create_kpi_tile") and last_sql_info["sql"]:
                            from src.api.routes_charts import detect_sql_params

                            payload["query_meta"] = {
                                "sql": last_sql_info["sql"],
                                "params": detect_sql_params(last_sql_info["sql"]),
                                "type": last_sql_info["provider"],
                            }

                        await send_json_safe(payload)
                        await send_turn_state("tool_end", turn_id, fc.name)

            except (WebSocketDisconnect, RuntimeError):
                logger.info("[WS] Client disconnected during event handling.")
                break

        await maybe_emit_model_end(force=True)

    except Exception as e:
        if "1000" in str(e) and "None" in str(e):
            logger.info("[WS] Live session closed normally (1000).")
        else:
            logger.error("[WS] Critical error in live session: %s", e, exc_info=True)
    finally:
        stop_event.set()

        for task in (upstream_task, idle_task):
            task.cancel()

        await asyncio.gather(upstream_task, idle_task, return_exceptions=True)

        interrupted_turn_id = coordinator.mark_interrupted()
        if interrupted_turn_id:
            await send_turn_state("interrupted", interrupted_turn_id)

        await safe_close_live_request_queue()
        _current_websocket.set(None)
        _current_step_id.set(None)
        logger.info("[WS] Live session cleanup.")
