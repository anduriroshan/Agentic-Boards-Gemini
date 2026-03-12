"""
Agentic Boards – Google ADK Agent Implementation.

This module replaces the LangGraph orchestration with the Google Agent Development Kit.
It defines the tools and the agent configuration for use with Vertex AI and the 
Multimodal Live API.
"""

import json
import logging
from typing import Annotated

from google import adk
from pydantic import BaseModel, Field

from src.agent.tools import (
    search_metadata as legacy_search_metadata,
    execute_sql as legacy_execute_sql,
    create_visualization as legacy_create_visualization,
    create_kpi_tile as legacy_create_kpi_tile,
    create_data_table as legacy_create_data_table,
    update_data_table as legacy_update_data_table,
    create_text_tile as legacy_create_text_tile,
    modify_dashboard as legacy_modify_dashboard,
    remove_tiles as legacy_remove_tiles,
)
from src.agent.prompts.system import REACT_SYSTEM_PROMPT
from src.config import settings

logger = logging.getLogger(__name__)

# ── ADK Tool Definitions ───────────────────────────────────────────────────

@adk.tool
def search_metadata(
    query: Annotated[str, "Natural language description of the data the user wants, e.g. 'sales by region'"]
) -> str:
    """Search the Databricks metadata catalogue to find relevant tables and columns."""
    return legacy_search_metadata.invoke({"query": query})

@adk.tool
def execute_sql(
    sql: Annotated[str, "A valid Databricks SQL query using fully-qualified table names."]
) -> str:
    """Execute a SQL query on the Databricks warehouse and return the result rows."""
    return legacy_execute_sql.invoke({"sql": sql})

@adk.tool
def create_visualization(
    vega_lite_spec: Annotated[str, "A COMPLETE Vega-Lite v5 JSON specification as a string."]
) -> str:
    """Add a new chart tile to the user's dashboard."""
    return legacy_create_visualization.invoke({"vega_lite_spec": vega_lite_spec})

@adk.tool
def create_kpi_tile(
    title: str, 
    value: str, 
    subtitle: str = "", 
    color: str = "", 
    sparkline_data: str = ""
) -> str:
    """Add a Power BI-style KPI / metric card tile to the dashboard."""
    return legacy_create_kpi_tile.invoke({
        "title": title,
        "value": value,
        "subtitle": subtitle,
        "color": color,
        "sparkline_data": sparkline_data
    })

@adk.tool
def create_data_table(
    title: str, 
    columns: str, 
    rows: str
) -> str:
    """Add an interactive data-table tile to the dashboard."""
    return legacy_create_data_table.invoke({
        "title": title,
        "columns": columns,
        "rows": rows
    })

@adk.tool
def update_data_table(
    tile_id: str, 
    title: str, 
    columns: str, 
    rows: str
) -> str:
    """Update an EXISTING data-table tile on the dashboard with new data."""
    return legacy_update_data_table.invoke({
        "tile_id": tile_id,
        "title": title,
        "columns": columns,
        "rows": rows
    })

@adk.tool
def create_text_tile(
    title: str, 
    markdown: str
) -> str:
    """Add a Markdown / Text tile to the dashboard."""
    return legacy_create_text_tile.invoke({
        "title": title,
        "markdown": markdown
    })

@adk.tool
def modify_dashboard(
    modifications: str
) -> str:
    """Modify existing dashboard tiles — change chart specs, rename headers, or reposition tiles."""
    return legacy_modify_dashboard.invoke({"modifications": modifications})

@adk.tool
def remove_tiles(
    tile_ids: list[str]
) -> str:
    """Remove one or more tiles from the dashboard."""
    return legacy_remove_tiles.invoke({"tile_ids": tile_ids})

# ── Agent Definition ──────────────────────────────────────────────────────

def get_adk_agent(dashboard_context: str = "The dashboard is currently empty."):
    """Initialize and return the Agentic Boards ADK agent."""
    
    instructions = REACT_SYSTEM_PROMPT.format(dashboard_context=dashboard_context)
    
    agent = adk.Agent(
        name="AgenticBoardsLive",
        model=settings.gemini_model, # e.g. gemini-2.0-flash-exp
        description="A real-time voice-interactive BI consultant.",
        instructions=instructions,
        tools=[
            search_metadata,
            execute_sql,
            create_visualization,
            create_kpi_tile,
            create_data_table,
            update_data_table,
            create_text_tile,
            modify_dashboard,
            remove_tiles,
        ]
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
