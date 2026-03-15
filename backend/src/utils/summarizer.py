import json
from typing import Any

def summarize_tile_content(tile: dict[str, Any]) -> str:
    """Extract a concise summary of the data inside a tile."""
    tile_type = str(tile.get("type", tile.get("kind", ""))).lower()
    
    # 1. KPI Tiles: Just show the main value and subtitle
    if tile_type == "kpi":
        val = tile.get("value", "N/A")
        sub = tile.get("subtitle", "")
        return f"Value: {val}" + (f" ({sub})" if sub else "")
    
    # 2. Table Tiles: Show top rows
    if tile_type == "table":
        rows = tile.get("rows", [])
        if not rows: return "Empty table"
        # Take first 3 rows as a sample
        sample = rows[:3]
        return f"Data sample ({len(rows)} rows): " + json.dumps(sample)
    
    # 3. Chart Tiles: Show the Vega-Lite encoding summary if data isn't embedded
    if tile_type == "chart" or tile_type == "visualization":
        spec = tile.get("vega_spec", {})
        data_vals = (spec.get("data") or {}).get("values", [])
        if data_vals:
            return f"Chart data ({len(data_vals)} rows): " + json.dumps(data_vals[:3])
        return "Chart (logic only, no static data embedded)"

    # 4. Text Tiles: Show snippet
    if tile_type == "text":
        content = tile.get("markdown", "")
        return f"Content: {content[:100]}..." if len(content) > 100 else f"Content: {content}"

    return "No data summary available"
