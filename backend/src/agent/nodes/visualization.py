import json
import uuid

from langchain_core.messages import HumanMessage, SystemMessage

from src.agent.state import AgentState
from src.agent.prompts.system import VISUALIZATION_PROMPT


async def visualization_node(state: AgentState) -> dict:
    """Generate a Vega-Lite spec from query results."""
    from src.llm import get_llm

    llm = get_llm()

    results = state.get("query_results") or []
    if not results:
        return {
            "error": "No data to visualize",
            "vega_spec": None,
        }

    # Get the user message
    last_human = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            content = msg.content
            last_human = content if isinstance(content, str) else str(content)
            break

    columns = list(results[0].keys()) if results else []
    sample = results[:5]

    prompt = VISUALIZATION_PROMPT.format(
        columns=json.dumps(columns),
        sample_data=json.dumps(sample, indent=2),
        total_rows=len(results),
        user_message=last_human,
    )

    result = await llm.ainvoke([
        SystemMessage(content="You generate Vega-Lite 5.0 specifications. Respond with ONLY valid JSON."),
        HumanMessage(content=prompt),
    ])

    response_text = result.content if isinstance(result.content, str) else str(result.content)

    # Parse the Vega-Lite spec
    vega_spec = None
    try:
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        vega_spec = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: create a basic bar chart from the data
        vega_spec = _fallback_spec(results, columns)

    # Ensure data is embedded
    if vega_spec and "data" not in vega_spec:
        vega_spec["data"] = {"values": results}

    # Ensure schema is set
    if vega_spec and "$schema" not in vega_spec:
        vega_spec["$schema"] = "https://vega.github.io/schema/vega-lite/v5.json"

    tile_id = str(uuid.uuid4())

    return {
        "vega_spec": vega_spec,
        "tile_id": tile_id,
    }


def _fallback_spec(data: list[dict], columns: list[str]) -> dict:
    """Create a basic bar chart as fallback when LLM output can't be parsed."""
    x_field = columns[0] if columns else "x"
    y_field = columns[1] if len(columns) > 1 else columns[0] if columns else "y"

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": "Generated Chart",
        "width": "container",
        "height": 300,
        "data": {"values": data},
        "mark": "bar",
        "encoding": {
            "x": {"field": x_field, "type": "nominal"},
            "y": {"field": y_field, "type": "quantitative"},
        },
    }
