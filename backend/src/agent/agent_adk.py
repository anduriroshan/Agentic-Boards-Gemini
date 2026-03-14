"""
Agentic Boards – Google ADK Agent Implementation.

This module replaces the LangGraph orchestration with the Google Agent Development Kit.
It defines the tools and the agent configuration for use with Vertex AI and the 
Multimodal Live API.
"""

import asyncio
import json
import logging
import os
from typing import Annotated, Any

from google import adk, genai
from google.genai import types
from google.adk.models import Gemini
from pydantic import BaseModel, Field

from src.agent.tools import (
    search_metadata as legacy_search_metadata,
    execute_sql as legacy_execute_sql,
    execute_bigquery as legacy_execute_bigquery,
    create_visualization as legacy_create_visualization,
    create_kpi_tile as legacy_create_kpi_tile,
    create_data_table as legacy_create_data_table,
    update_data_table as legacy_update_data_table,
    create_text_tile as legacy_create_text_tile,
    modify_dashboard as legacy_modify_dashboard,
    remove_tiles as legacy_remove_tiles,
    get_bigquery_schema as legacy_get_bigquery_schema,
)
from src.agent.prompts.system import REACT_SYSTEM_PROMPT
from src.config import settings

logger = logging.getLogger(__name__)

# ── Activity Status Helper ───────────────────────────────────────────────────

_ACTIVITY_TOOL_AGENT: dict[str, tuple[str, str]] = {
    "search_metadata": ("DataAgent", "search"),
    "execute_sql": ("DataAgent", "database"),
    "execute_bigquery": ("DataAgent", "database"),
    "get_bigquery_schema": ("DataAgent", "database"),
    "create_visualization": ("VizAgent", "bar-chart-3"),
    "create_kpi_tile": ("VizAgent", "chart-bar"),
    "create_text_tile": ("VizAgent", "file-text"),
    "create_data_table": ("VizAgent", "table"),
    "update_data_table": ("VizAgent", "table"),
    "modify_dashboard": ("DashboardAgent", "layout"),
    "remove_tiles": ("DashboardAgent", "layout"),
    "get_recent_activity": ("Orchestrator", "history"),
}

def summarize_tool_output(result_text: str, max_rows: int = 15) -> str:
    """
    Summarizes large tool outputs (like SQL results) to prevent overflowing 
    the Multimodal Live API context window (32k).
    Returns a sample of the data and a summary header.
    """
    if not result_text or len(result_text) < 2000:
        return result_text
        
    try:
        data = json.loads(result_text)
        if isinstance(data, list):
            total_count = len(data)
            if total_count > max_rows:
                sample = data[:max_rows]
                columns = list(sample[0].keys()) if sample else []
                summary = (
                    f"\n[SUMMARY: Result contains {total_count} rows. "
                    f"First {max_rows} shown below as a representative sample. "
                    f"The full data is already rendered in the dashboard UI.]\n"
                    f"Columns: {', '.join(columns)}\n"
                )
                return summary + json.dumps(sample, indent=2)
        return result_text
    except Exception as e:
        logger.warning(f"Summarizer failed (likely not JSON): {e}")
        # If not JSON or parsing failed, just return truncated text
        if len(result_text) > 15000:
            return result_text[:15000] + "\n... [TRUNCATED for context window]"
        return result_text


async def send_activity_status(tool_name: str, summary: str, status: str = "running"):
    """Helper to send a real-time status update to the frontend via WebSocket."""
    from src.api import routes_live
    import time
    
    current_websocket = getattr(routes_live, "_current_websocket", None)
    current_step_id = getattr(routes_live, "_current_step_id", None)
    tool_agent_map = getattr(routes_live, "_TOOL_AGENT", _ACTIVITY_TOOL_AGENT)

    if current_websocket is None or current_step_id is None:
        logger.debug("[WS] Live route context vars unavailable; skipping activity status for %s", tool_name)
        return

    ws = current_websocket.get()
    step_id = current_step_id.get()
    
    if not ws:
        logger.debug(f"[WS] No active websocket in ContextVar for tool {tool_name}. Activity status update skipped.")
        return
        
    if not step_id:
        step_id = f"tool_{tool_name}_{int(time.time())}"
        logger.debug(f"[WS] No step_id in ContextVar, generated fallback: {step_id}")
    
    agent_name, icon = tool_agent_map.get(tool_name, ("DataAgent", "database"))
    
    try:
        await ws.send_json({
            "type": "agent_activity",
            "step": {
                "step_id": step_id,
                "phase": "call",
                "agent": agent_name,
                "icon": icon,
                "tool": tool_name,
                "summary": summary,
                "status": status,
                "ts": int(time.time() * 1000)
            }
        })
        logger.info(f"[WS] Activity status sent: {tool_name} ({status})")
    except Exception as e:
        logger.warning(f"Failed to send real-time status: {e}")

# ── ADK Tool Definitions ───────────────────────────────────────────────────


async def search_metadata(
    query: Annotated[str, "Natural language description of the data the user wants, e.g. 'sales by region'"]
) -> str:
    """Search the Databricks metadata catalogue to find relevant tables and columns."""
    res = await asyncio.to_thread(legacy_search_metadata.invoke, {"query": query})
    return summarize_tool_output(res)


async def execute_sql(
    sql: Annotated[str, "A valid Databricks SQL query using fully-qualified table names."]
) -> str:
    """Execute a SQL query on the Databricks warehouse and return the result rows."""
    await send_activity_status("execute_sql", f"Running Databricks SQL: {sql[:50]}...")
    res = await asyncio.to_thread(legacy_execute_sql.invoke, {"sql": sql})
    await send_activity_status("execute_sql", f"Databricks SQL Complete", status="done")
    return summarize_tool_output(res)


async def execute_bigquery(
    sql: Annotated[str, "A valid BigQuery SQL query (standard SQL)."]
) -> str:
    """Execute a SQL query on Google BigQuery and return the result rows."""
    await send_activity_status("execute_bigquery", f"Running BigQuery SQL: {sql[:50]}...")
    res = await asyncio.to_thread(legacy_execute_bigquery.invoke, {"sql": sql})
    await send_activity_status("execute_bigquery", f"BigQuery SQL Complete", status="done")
    return summarize_tool_output(res)


async def get_bigquery_schema(
    table_name: Annotated[str, "The fully-qualified BigQuery table name (project.dataset.table)."]
) -> str:
    """Get the column definitions (schema) for a specific BigQuery table."""
    await send_activity_status("get_bigquery_schema", f"Fetching schema for {table_name}...")
    res = await asyncio.to_thread(legacy_get_bigquery_schema.invoke, {"table_name": table_name})
    await send_activity_status("get_bigquery_schema", "Schema Fetched", status="done")
    return summarize_tool_output(res)


async def create_visualization(
    vega_lite_spec: Annotated[str, "A COMPLETE Vega-Lite v5 JSON specification as a string."]
) -> str:
    """Add a new chart tile to the user's dashboard."""
    await send_activity_status("create_visualization", "Preparing chart data...")
    res = await asyncio.to_thread(legacy_create_visualization.invoke, {"vega_lite_spec": vega_lite_spec})
    await send_activity_status("create_visualization", "Chart Tile Created", status="done")
    return res


async def create_kpi_tile(
    title: str, 
    value: str, 
    subtitle: str = "", 
    color: str = "", 
    sparkline_data: str = ""
) -> str:
    """Add a Power BI-style KPI / metric card tile to the dashboard."""
    await send_activity_status("create_kpi_tile", f"Creating KPI: {title}...")
    res = await asyncio.to_thread(legacy_create_kpi_tile.invoke, {
        "title": title,
        "value": value,
        "subtitle": subtitle,
        "color": color,
        "sparkline_data": sparkline_data
    })
    await send_activity_status("create_kpi_tile", "KPI Card Created", status="done")
    return res


async def create_data_table(
    title: str, 
    columns: str, 
    rows: str
) -> str:
    """Add an interactive data-table tile to the dashboard."""
    await send_activity_status("create_data_table", f"Initializing table: {title}...")
    res = await asyncio.to_thread(legacy_create_data_table.invoke, {
        "title": title,
        "columns": columns,
        "rows": rows
    })
    await send_activity_status("create_data_table", "Data Table Created", status="done")
    return res


async def update_data_table(
    tile_id: str, 
    title: str, 
    columns: str, 
    rows: str
) -> str:
    """Update an EXISTING data-table tile on the dashboard with new data."""
    await send_activity_status("update_data_table", f"Refreshing table: {title}...")
    res = await asyncio.to_thread(legacy_update_data_table.invoke, {
        "tile_id": tile_id,
        "title": title,
        "columns": columns,
        "rows": rows
    })
    await send_activity_status("update_data_table", "Data Table Updated", status="done")
    return res


async def create_text_tile(
    title: str, 
    markdown: str
) -> str:
    """Add a Markdown / Text tile to the dashboard."""
    return await asyncio.to_thread(legacy_create_text_tile.invoke, {
        "title": title,
        "markdown": markdown
    })


async def modify_dashboard(
    modifications: str | dict[str, Any] | list[Any]
) -> str:
    """Modify existing dashboard tiles — change chart specs, rename headers, or reposition tiles."""
    await send_activity_status("modify_dashboard", "Applying surgical updates...")
    try:
        payload = modifications if isinstance(modifications, str) else json.dumps(modifications)
        res = await asyncio.to_thread(legacy_modify_dashboard.invoke, {"modifications": payload})
        status_msg = "Dashboard Modified"
        try:
            parsed = json.loads(res)
            if isinstance(parsed, dict) and parsed.get("error"):
                status_msg = f"Dashboard update failed: {str(parsed['error'])[:120]}"
                logger.warning("modify_dashboard returned tool error: %s", parsed["error"])
        except Exception:
            pass

        await send_activity_status("modify_dashboard", status_msg, status="done")
        return res
    except Exception as e:
        logger.exception("modify_dashboard tool failed: %s", e)
        await send_activity_status("modify_dashboard", "Dashboard update failed", status="done")
        return json.dumps({
            "action": "modify_dashboard",
            "error": f"modify_dashboard failed: {e}",
        })


async def remove_tiles(
    tile_ids: list[str]
) -> str:
    """Remove one or more tiles from the dashboard."""
    await send_activity_status("remove_tiles", f"Removing {len(tile_ids)} tile(s)...")
    res = await asyncio.to_thread(legacy_remove_tiles.invoke, {"tile_ids": tile_ids})
    await send_activity_status("remove_tiles", "Tiles Removed", status="done")
    return res


async def get_recent_activity() -> str:
    """Query the history of tools called and actions taken in the current session.
    Use this if the user asks 'What have you done?', 'Where are we?', or 'Is the table ready?'.
    """
    await send_activity_status("get_recent_activity", "Fetching session activity log...")
    try:
        from src.api.routes_live import get_session_activity
        activity = get_session_activity()
        if not activity:
            await send_activity_status("get_recent_activity", "Activity Log Checked", status="done")
            return "No tool calls have been documented in this session yet."
        
        await send_activity_status("get_recent_activity", f"Retrieved {len(activity)} entries", status="done")
        return "\n".join([f"- {a}" for a in activity])
    except Exception as e:
        logger.warning(f"Failed to fetch activity log: {e}")
        await send_activity_status("get_recent_activity", "Failed to retrieve activity", status="done")
        return "Activity log is currently unavailable."

# ── Agent Definition ──────────────────────────────────────────────────────

def get_adk_agent(dashboard_context: str = "The dashboard is currently empty.", database_provider: str = None):
    """Initialize and return the Agentic Boards ADK agent."""
    
    connection_flag = f"\n[ACTIVE CONNECTION: {database_provider.upper()}]\n" if database_provider else ""
    instructions = connection_flag + REACT_SYSTEM_PROMPT.format(dashboard_context=dashboard_context)
    
    # ── Debug Logs ──
    logger.info(f"ADK Agent Initialization: settings.gemini_model={settings.gemini_model}")
    logger.info(f"ADK Agent Initialization: os.environ.get('GEMINI_MODEL')={os.environ.get('GEMINI_MODEL')}")
    
    # ── Force Vertex AI Authentication ──
    # The Multimodal Live API (ADK run_live) on Vertex AI requires OAuth 2.
    # We initialize an explicit genai.Client with vertexai=True to ensure OAuth/service account auth.
    api_client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gcp_region
    )
    
    model = Gemini(
        model=settings.gemini_model,
        system_instruction=instructions,
        parallel_tool_calls=False,
    )
    # Inject the Vertex AI client directly into the cached_property cache.
    # ADK's Gemini model exposes `api_client` and `_live_api_client` as cached_properties.
    # We must populate both in the instance __dict__ to ensure the correct Vertex client is used.
    model.__dict__['api_client'] = api_client
    model.__dict__['_live_api_client'] = api_client
    
    agent = adk.Agent(
        name="AgenticBoardsLive",
        model=model,
        description="A real-time voice-interactive BI consultant.",
        instruction=instructions,
        tools=[
            search_metadata,
            execute_sql,
            execute_bigquery,
            get_bigquery_schema,
            create_visualization,
            create_kpi_tile,
            create_data_table,
            update_data_table,
            create_text_tile,
            modify_dashboard,
            remove_tiles,
            get_recent_activity,
        ],
        generate_content_config=types.GenerateContentConfig(
            response_modalities=[types.Modality.AUDIO]
        )
    )
    
    return agent

def run_live_session(dashboard_context: str):
    """
    Experimental: Setup a live session runner for the agent.
    This will be used by the WebSocket handler in main.py.
    """
    agent = get_adk_agent(dashboard_context)
    # The actual live session handling (WebSockets, Audio) will be 
    # implemented in main.py using the ADK Runner and LiveRequestQueue.
    return agent
