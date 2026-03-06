"""Modify existing dashboard tiles — Vega-Lite specs AND/OR tile layouts.

Handles:
  - Visual changes (colors, mark types, axis labels, etc.) → spec_updates
  - Position/size changes (move, resize, reorder tiles)   → layout_updates
  - Both at once
"""

import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from src.agent.state import AgentState

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> dict:
    """Extract a JSON object from LLM response (strips markdown fences)."""
    m = re.search(r"```(?:json|vega-lite)?\s*([\s\S]+?)```", text, re.IGNORECASE)
    if m:
        text = m.group(1)
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start != -1 and end > start:
        text = text[start:end]
    return json.loads(text)


async def modify_viz_node(state: AgentState) -> dict:
    """Modify dashboard tiles — specs, layouts, or both."""
    from src.llm import get_llm

    llm = get_llm()

    # Get user request
    last_human = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            content = msg.content
            last_human = content if isinstance(content, str) else str(content)
            break

    tiles = state.get("current_tiles", [])

    if not tiles:
        return {
            "error": "No charts on the dashboard to modify.",
            "vega_spec": None,
            "tile_id": None,
            "layout_updates": None,
        }

    # ── Build tile descriptions for the LLM ──────────────────────────
    tile_descriptions: list[str] = []
    for i, tile in enumerate(tiles):
        layout = tile.get("layout", {
            "x": (i % 2) * 6,
            "y": (i // 2) * 4,
            "w": 6,
            "h": 4,
        })
        desc = (
            f'Tile {i + 1}: "{tile.get("title", "Chart")}" '
            f'(tile_id: {tile.get("tile_id")})\n'
            f'  Layout: x={layout.get("x", 0)}, y={layout.get("y", 0)}, '
            f'w={layout.get("w", 6)}, h={layout.get("h", 4)}\n'
            f'  Vega-Lite spec:\n{json.dumps(tile.get("vega_spec", {}), indent=2)}'
        )
        tile_descriptions.append(desc)

    tiles_text = "\n\n".join(tile_descriptions)

    logger.info(
        "[MODIFY_VIZ] Processing request=%r  tiles=%d",
        last_human, len(tiles),
    )

    prompt = f"""You are a dashboard layout and Vega-Lite expert.

The dashboard uses a 12-column grid layout system:
- x: column position (0–11), left to right
- y: row position (0+), top to bottom
- w: width in columns (1–12). 12 = full width, 6 = half width
- h: height in row units (each row ≈ 100 px). Typical chart h = 3–5

Current tiles on the dashboard:

{tiles_text}

User instruction: {last_human}

Respond with a JSON object containing ONLY the arrays that are needed:

{{
  "spec_updates": [
    {{"tile_id": "...", "vega_spec": {{ ... complete updated Vega-Lite spec ... }}}}
  ],
  "layout_updates": [
    {{"tile_id": "...", "x": 0, "y": 0, "w": 6, "h": 4}}
  ]
}}

Rules:
- Include "spec_updates" ONLY if chart appearance must change (colours, mark type,
  axis labels, size within the chart, etc.).
- Include "layout_updates" ONLY if tile position or dashboard size must change
  (move, reorder, widen, make taller, place below another tile, etc.).
- You may include both arrays if the instruction requires both.
- For spec_updates: return the COMPLETE Vega-Lite spec with ALL data values intact.
- For layout_updates: include an entry for EVERY tile whose position changes; other
  tiles may stay where they are (omit them).
- Respond with ONLY valid JSON — no markdown fences, no explanation."""

    result = await llm.ainvoke([
        SystemMessage(
            content=(
                "You are a dashboard and Vega-Lite expert. "
                "Modify chart specs and tile layouts as instructed. "
                "Return ONLY valid JSON."
            )
        ),
        HumanMessage(content=prompt),
    ])

    response_text = (
        result.content if isinstance(result.content, str) else str(result.content)
    )

    try:
        parsed = _extract_json(response_text)

        spec_updates = parsed.get("spec_updates", [])
        layout_updates = parsed.get("layout_updates", [])

        # First spec update populates the legacy vega_spec / tile_id fields
        vega_spec = None
        tile_id = None
        if spec_updates:
            first = spec_updates[0]
            vega_spec = first.get("vega_spec")
            tile_id = first.get("tile_id")
            logger.info("[MODIFY_VIZ] Spec update for tile=%s", tile_id)

        if layout_updates:
            logger.info(
                "[MODIFY_VIZ] Layout updates for %d tile(s): %s",
                len(layout_updates),
                [u.get("tile_id") for u in layout_updates],
            )

        return {
            "vega_spec": vega_spec,
            "tile_id": tile_id,
            "layout_updates": layout_updates if layout_updates else None,
            "error": None,
        }

    except (json.JSONDecodeError, ValueError) as exc:
        logger.error(
            "[MODIFY_VIZ] Failed to parse response: %s\nResponse: %s",
            exc, response_text[:500],
        )
        return {
            "error": f"Failed to parse modification response: {exc}",
            "vega_spec": None,
            "tile_id": None,
            "layout_updates": None,
        }
