from typing import Annotated, Sequence, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """Shared state for the Agentic Boards ReAct agent.

    The ``messages`` list is the core exchange:  the LLM's tool_calls and
    ToolMessages flow through it automatically via LangGraph's ToolNode.

    The remaining fields carry context injected by the API layer so that
    tools / the LLM can reference the current dashboard state.
    """

    messages: Annotated[Sequence[BaseMessage], add_messages]

    # ── Context injected from the frontend ────────────────────────────
    current_tiles: list[dict]   # [{tile_id, title, vega_spec, layout}, ...]
    chat_history: list[dict]    # [{role, content}, ...]
    llm_model: str | None       # Optional specific model to use for this request
    database_provider: str | None # Active database connection (e.g. "databricks", "bigquery")
    guardrail_result: dict | None # {"classification": "IN_SCOPE" | "OUT_OF_SCOPE", "reason": str}

