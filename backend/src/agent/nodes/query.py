import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from src.agent.state import AgentState
from src.agent.prompts.system import QUERY_GENERATION_PROMPT

logger = logging.getLogger(__name__)


def _extract_sql(text: str) -> str:
    """Extract SQL from LLM response, stripping markdown fences."""
    # Try ```sql ... ``` block first
    m = re.search(r"```(?:sql)?\s*([\s\S]+?)```", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Fall back to raw text
    return text.strip()


async def query_node(state: AgentState) -> dict:
    """Generate SQL via LLM and execute it on Databricks."""
    from src.llm import get_llm
    from src.databricks.client import get_databricks_manager

    llm = get_llm()
    databricks_manager = get_databricks_manager()

    # Get the user message
    last_human = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            content = msg.content
            last_human = content if isinstance(content, str) else str(content)
            break

    metadata = state.get("cube_metadata", [])
    metadata_str = json.dumps(metadata, indent=2)

    prompt = QUERY_GENERATION_PROMPT.format(
        metadata=metadata_str,
        user_message=last_human,
    )

    result = await llm.ainvoke([
        SystemMessage(content="You are a Databricks SQL expert. Respond with ONLY a valid SQL query, no explanation."),
        HumanMessage(content=prompt),
    ])

    response_text = result.content if isinstance(result.content, str) else str(result.content)
    sql = _extract_sql(response_text)
    logger.info("[QUERY] Generated SQL:\n%s", sql)

    # Execute on Databricks
    try:
        if not databricks_manager.is_connected:
            logger.warning("[QUERY] Databricks not connected — returning empty results")
            return {
                "sql_generated": sql,
                "cube_query": {"sql": sql},
                "query_results": [],
                "error": "Databricks is not connected. Please connect via Settings.",
            }

        df = databricks_manager.query(sql)
        rows = databricks_manager.to_pandas(df).to_dict(orient="records")
        logger.info("[QUERY] Databricks returned %d rows", len(rows))
        return {
            "sql_generated": sql,
            "cube_query": {"sql": sql},
            "query_results": rows,
            "error": None,
        }
    except Exception as e:
        logger.error("[QUERY] Databricks execution failed: %s", e)
        return {
            "sql_generated": sql,
            "cube_query": {"sql": sql},
            "query_results": [],
            "error": f"SQL execution failed: {e}",
        }
