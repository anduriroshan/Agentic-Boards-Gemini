import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from src.agent.state import AgentState
from src.agent.prompts.system import ROUTER_PROMPT

logger = logging.getLogger(__name__)


async def router_node(state: AgentState) -> dict:
    """Classify user intent as 'query', 'modify_viz', or 'question'."""
    from src.llm import get_llm

    llm = get_llm()
    last_human = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            content = msg.content
            last_human = content if isinstance(content, str) else str(content)
            break

    # Build context about what's currently on the dashboard
    tiles = state.get("current_tiles", [])
    tile_titles = ", ".join(t.get("title", "untitled") for t in tiles) if tiles else "none"

    prompt = ROUTER_PROMPT.format(tile_titles=tile_titles)

    result = await llm.ainvoke([
        SystemMessage(content=prompt),
        HumanMessage(content=last_human),
    ])

    intent_text = (
        result.content.strip().lower()
        if isinstance(result.content, str)
        else str(result.content).strip().lower()
    )

    if "modify_viz" in intent_text or "modify" in intent_text:
        intent = "modify_viz"
    elif "query" in intent_text:
        intent = "query"
    else:
        intent = "question"

    logger.info("[ROUTER] tiles_on_dashboard=%d  raw=%r  intent=%s", len(tiles), intent_text, intent)
    return {"intent": intent}
