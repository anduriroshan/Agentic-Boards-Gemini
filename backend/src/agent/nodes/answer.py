from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agent.state import AgentState
from src.agent.prompts.system import SYSTEM_PROMPT


async def answer_node(state: AgentState) -> dict:
    """Handle general questions that don't require data queries."""
    from src.llm import get_llm

    llm = get_llm()

    result = await llm.ainvoke([
        SystemMessage(content=SYSTEM_PROMPT),
        *state["messages"],
    ])

    return {
        "messages": [result],
    }
