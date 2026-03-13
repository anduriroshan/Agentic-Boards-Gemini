"""
Agentic Boards – LangGraph ReAct agent.

The LLM decides which tools to call (and in what order) via
structured tool_calls.  LangGraph loops:

    agent ──> ToolNode ──> agent ──> … ──> END

No manual router node — the model's native tool-calling handles it.
"""

from __future__ import annotations

import json
import logging

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from src.agent.state import AgentState
from src.agent.tools import ALL_TOOLS
from src.agent.prompts.system import REACT_SYSTEM_PROMPT
from src.agent.prompts.guardrail import GUARDRAIL_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


def _summarise_vega_spec(spec: dict) -> str:
    """Extract a human-readable semantic summary from a Vega-Lite spec.

    Returns a compact string describing what the chart shows so the LLM can
    reason about existing tiles without re-querying Databricks.
    """
    if not isinstance(spec, dict):
        return "unknown chart"

    parts: list[str] = []

    # Mark type
    mark = spec.get("mark")
    if isinstance(mark, dict):
        mark = mark.get("type", "unknown")
    if mark:
        parts.append(f"mark={mark}")

    # Encoding channels
    enc = spec.get("encoding", {})
    for channel in ("x", "y", "color", "size", "theta", "radius", "detail"):
        ch = enc.get(channel)
        if ch:
            field = ch.get("field") or ch.get("aggregate")
            agg = ch.get("aggregate")
            dtype = ch.get("type", "")[:3]  # nom/ord/qua/tmp
            label = field or ""
            if agg and agg != field:
                label = f"{agg}({field})"
            if label:
                parts.append(f"{channel}={label}[{dtype}]")

    # Data shape
    values = (spec.get("data") or {}).get("values", [])
    if values:
        parts.append(f"rows={len(values)}")
        if values:
            parts.append(f"columns={list(values[0].keys())}")

    # Transform hint
    transforms = spec.get("transform", [])
    for t in transforms[:2]:  # show at most 2
        if "filter" in t:
            parts.append(f"filter={str(t['filter'])[:60]}")
        elif "aggregate" in t:
            parts.append("aggregated")

    return ", ".join(parts) if parts else "chart"


def _summarise_tile(t: dict) -> str:
    """Build a full tile context line including semantic spec summary and data."""
    layout = t.get("layout", {})
    tile_type = t.get("type", "chart")
    tile_id = t.get("tile_id", "?")
    title = t.get("title", "Untitled")

    base = (
        f'  - "{title}" '
        f'(tile_id: {tile_id}, type: {tile_type}, '
        f'x={layout.get("x", 0)}, y={layout.get("y", 0)}, '
        f'w={layout.get("w", 6)}, h={layout.get("h", 4)})'
    )

    if tile_type == "chart":
        spec = t.get("vega_spec", {})
        if isinstance(spec, str):
            try:
                spec = json.loads(spec)
            except Exception:
                spec = {}
        summary = _summarise_vega_spec(spec)
        # Include up to 150 data rows so the LLM can do statistical analysis
        # without re-querying Databricks
        values = (spec.get("data") or {}).get("values", [])
        data_section = ""
        if values:
            sample = values[:150]
            try:
                data_section = "\n    data: " + json.dumps(sample, default=str)
            except Exception:
                data_section = f"\n    data: ({len(values)} rows, serialization error)"
        return f"{base}\n    chart: {summary}{data_section}"

    if tile_type == "table":
        return f"{base}"

    return base


def _build_system_message(state: AgentState) -> str:
    """Construct the system prompt, injecting rich dashboard context."""
    tiles = state.get("current_tiles", [])
    if tiles:
        tile_lines = [_summarise_tile(t) for t in tiles]
        dashboard_section = (
            "Current dashboard tiles:\n" + "\n".join(tile_lines)
        )
    else:
        dashboard_section = "The dashboard is currently empty."

    return REACT_SYSTEM_PROMPT.format(dashboard_context=dashboard_section)


def _needs_visualization_nudge(state_messages: list) -> bool:
    """Return True if execute_sql returned data but create_visualization was never called.

    Used to detect the common failure where the custom model describes the
    data in text instead of actually calling create_visualization.
    """
    sql_returned_data = False
    viz_called = False

    for msg in state_messages:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            for tc in msg.tool_calls:
                if tc["name"] == "create_visualization":
                    viz_called = True
                if tc["name"] == "create_data_table":
                    viz_called = True
        if isinstance(msg, ToolMessage):
            # Check if this is an execute_sql result with actual rows
            if msg.name == "execute_sql":
                try:
                    result = json.loads(msg.content)
                    rows = result.get("rows", [])
                    if rows and not result.get("error"):
                        sql_returned_data = True
                except Exception:
                    pass

    return sql_returned_data and not viz_called


def _viz_already_done(state_messages: list) -> str | None:
    """If a terminal output tool already completed successfully, return a
    confirmation message.  The caller should use this as the final plain-text
    response, skipping the LLM call entirely, to break the infinite loop.

    Terminal tools: create_visualization, create_data_table, create_kpi_tile, create_text_tile.
    """
    _TERMINAL_TOOLS = {"create_visualization", "create_data_table", "create_kpi_tile", "create_text_tile"}
    for msg in state_messages:
        if not isinstance(msg, ToolMessage):
            continue
        tool_name = msg.name or ""
        if tool_name not in _TERMINAL_TOOLS:
            continue
        # Check the result was successful (no error key)
        try:
            result = json.loads(msg.content)
            if isinstance(result, dict) and not result.get("error"):
                action = result.get("action", tool_name)
                tile_id = result.get("tile_id", "")
                return (
                    f"Done. The {action.replace('_', ' ')} has been added to the dashboard"
                    + (f" (tile id: {tile_id[:8]}…)." if tile_id else ".")
                )
        except Exception:
            pass
    return None


async def guardrail_node(state: AgentState) -> dict:
    """Classify the user's intent to ensure it is in scope for the project."""
    from src.llm import get_llm

    # Use a fast model for guardrails (defaulting to gemini-2.0-flash if possible)
    llm = get_llm(state.get("llm_model"))
    
    messages = state.get("messages", [])
    
    # Pass the whole conversation to the guardrail for context (e.g. "try again")
    prompt = [
        SystemMessage(content=GUARDRAIL_SYSTEM_PROMPT),
    ] + list(messages)
    
    try:
        response = await llm.ainvoke(prompt)
        content = response.content if isinstance(response.content, str) else str(response.content)
        # Parse JSON from the response
        import re
        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
        else:
            # Fallback if LLM doesn't return valid JSON
            result = {"classification": "IN_SCOPE", "reason": "Failed to parse guardrail response"}
    except Exception as e:
        logger.error(f"[GUARDRAIL] Error: {e}")
        result = {"classification": "IN_SCOPE", "reason": f"Error during guardrail: {e}"}

    logger.info(f"[GUARDRAIL] classification={result.get('classification')} reason={result.get('reason')}")
    
    updates = {"guardrail_result": result}
    
    # If out of scope, add a refusal message to the state
    if result.get("classification") == "OUT_OF_SCOPE":
        refusal = AIMessage(
            content=(
                f"I'm sorry, but I can only help with data analysis, dashboards, and reporting tasks. "
                f"Your request appears to be out of scope: {result.get('reason')}"
            )
        )
        updates["messages"] = [refusal]
        
    return updates


def should_continue_after_guardrail(state: AgentState) -> str:
    """Route to agent if IN_SCOPE, otherwise END."""
    res = state.get("guardrail_result") or {}
    if res.get("classification") == "OUT_OF_SCOPE":
        return END
    return "agent"


async def agent_node(state: AgentState) -> dict:
    """Call the LLM with tools bound.  Returns either a tool_call or a
    final text response (which ends the loop)."""
    from src.llm import get_llm

    # ── Early-exit guard: terminal tool already completed ─────────────────────
    # Prevents the infinite loop where the model keeps calling create_visualization
    # after it already ran successfully.
    done_msg = _viz_already_done(list(state["messages"]))
    if done_msg:
        logger.info("[AGENT] terminal tool already done — returning confirmation")
        return {"messages": [AIMessage(content=done_msg)]}

    llm = get_llm(state.get("llm_model")).bind_tools(ALL_TOOLS)

    system_prompt = _build_system_message(state)

    # Prepend system message to the conversation
    messages = [SystemMessage(content=system_prompt)] + list(state["messages"])

    response = await llm.ainvoke(messages)
    logger.info(
        "[AGENT] tool_calls=%s  content_len=%d",
        [tc["name"] for tc in response.tool_calls] if response.tool_calls else "none",
        len(response.content) if isinstance(response.content, str) else 0,
    )

    # ── Nudge guard: did the model skip create_visualization? ────────────────
    # If the response is plain text but we have SQL data that hasn't been
    # visualised yet, re-inject a forced tool call nudge.
    if (
        not response.tool_calls
        and response.content
        and _needs_visualization_nudge(list(state["messages"]))
    ):
        logger.warning(
            "[AGENT] Model returned plain text after SQL data — inject nudge"
        )
        nudge = HumanMessage(
            content=(
                "You have the SQL data above. "
                "You MUST now call create_visualization with a complete Vega-Lite spec "
                "that embeds that data in data.values. "
                "Output ONLY the tool_call JSON, no explanation: "
                '{"tool_call": {"name": "create_visualization", "arguments": {"vega_lite_spec": "..."}}}'
            )
        )
        messages_with_nudge = messages + [response, nudge]
        response = await llm.ainvoke(messages_with_nudge)
        logger.info(
            "[AGENT] after nudge tool_calls=%s",
            [tc["name"] for tc in response.tool_calls] if response.tool_calls else "none",
        )

    return {"messages": [response]}


def build_agent_graph() -> StateGraph:
    """Build and compile the ReAct agent graph."""
    graph = StateGraph(AgentState)

    graph.add_node("guardrail", guardrail_node)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(ALL_TOOLS))

    graph.set_entry_point("guardrail")

    # Guardrail check
    graph.add_conditional_edges("guardrail", should_continue_after_guardrail)

    # If the LLM emitted tool_calls → run ToolNode → loop back to agent
    # If the LLM emitted a plain text response → END
    graph.add_conditional_edges("agent", tools_condition)
    graph.add_edge("tools", "agent")

    return graph.compile()


# Singleton compiled graph
agent_graph = build_agent_graph()

