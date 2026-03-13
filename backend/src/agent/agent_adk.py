"""
Agentic Boards – Google ADK Agent Implementation.

This module replaces the LangGraph orchestration with the Google Agent Development Kit.
It defines the tools and the agent configuration for use with Vertex AI and the 
Multimodal Live API.
"""

import json
import logging
import os
from typing import Annotated

from google import adk, genai
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
)
from src.agent.prompts.system import REACT_SYSTEM_PROMPT
from src.config import settings

logger = logging.getLogger(__name__)

# ── ADK Tool Definitions ───────────────────────────────────────────────────


def search_metadata(
    query: Annotated[str, "Natural language description of the data the user wants, e.g. 'sales by region'"]
) -> str:
    """Search the Databricks metadata catalogue to find relevant tables and columns."""
    return legacy_search_metadata.invoke({"query": query})


def execute_sql(
    sql: Annotated[str, "A valid Databricks SQL query using fully-qualified table names."]
) -> str:
    """Execute a SQL query on the Databricks warehouse and return the result rows."""
    return legacy_execute_sql.invoke({"sql": sql})


def execute_bigquery(
    sql: Annotated[str, "A valid BigQuery SQL query (standard SQL)."]
) -> str:
    """Execute a SQL query on Google BigQuery and return the result rows."""
    return legacy_execute_bigquery.invoke({"sql": sql})


def create_visualization(
    vega_lite_spec: Annotated[str, "A COMPLETE Vega-Lite v5 JSON specification as a string."]
) -> str:
    """Add a new chart tile to the user's dashboard."""
    return legacy_create_visualization.invoke({"vega_lite_spec": vega_lite_spec})


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


def create_text_tile(
    title: str, 
    markdown: str
) -> str:
    """Add a Markdown / Text tile to the dashboard."""
    return legacy_create_text_tile.invoke({
        "title": title,
        "markdown": markdown
    })


def modify_dashboard(
    modifications: str
) -> str:
    """Modify existing dashboard tiles — change chart specs, rename headers, or reposition tiles."""
    return legacy_modify_dashboard.invoke({"modifications": modifications})


def remove_tiles(
    tile_ids: list[str]
) -> str:
    """Remove one or more tiles from the dashboard."""
    return legacy_remove_tiles.invoke({"tile_ids": tile_ids})

# ── Agent Definition ──────────────────────────────────────────────────────

def get_adk_agent(dashboard_context: str = "The dashboard is currently empty."):
    """Initialize and return the Agentic Boards ADK agent."""
    
    instructions = REACT_SYSTEM_PROMPT.format(dashboard_context=dashboard_context)
    
    # ── Debug Logs ──
    logger.info(f"ADK Agent Initialization: settings.gemini_model={settings.gemini_model}")
    logger.info(f"ADK Agent Initialization: os.environ.get('GEMINI_MODEL')={os.environ.get('GEMINI_MODEL')}")
    
    # ── Force Global Environment for Vertex AI ──
    # This ensures any internal Client() creation (including by ADK) uses Vertex AI.
    os.environ["GOOGLE_CLOUD_PROJECT"] = settings.gcp_project_id
    os.environ["GOOGLE_CLOUD_LOCATION"] = settings.gcp_region
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.abspath("service_account.json")
    
    # Remove API keys to prevent fallback to Gemini API (AI Studio)
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GOOGLE_API_KEY", None)
    
    # ── Force Vertex AI Authentication ──
    # The Multimodal Live API (ADK run_live) on Vertex AI requires OAuth 2.
    # By default, ADK might try Gemini API (AI Studio) if an API key is present.
    # We initialize an explicit genai.Client with vertexai=True to ensure OAuth/service account auth.
    api_client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gcp_region
    )
    
    model = Gemini(
        model=settings.gemini_model
    )
    # Inject the Vertex AI client directly into the cached_property cache.
    # ADK's Gemini model exposes `api_client` as a functools.cached_property
    # whose cached value lives in instance.__dict__['api_client'] (no underscore).
    # Setting model._api_client does nothing; we must populate the cache key directly.
    model.__dict__['api_client'] = api_client
    
    agent = adk.Agent(
        name="AgenticBoardsLive",
        model=model,
        description="A real-time voice-interactive BI consultant.",
        instruction=instructions,
        tools=[
            search_metadata,
            execute_sql,
            execute_bigquery,
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
