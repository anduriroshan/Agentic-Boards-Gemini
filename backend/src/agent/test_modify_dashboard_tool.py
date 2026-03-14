import json

from src.agent.tools import create_kpi_tile, modify_dashboard


def _invoke(payload: str) -> dict:
    out = modify_dashboard.invoke({"modifications": payload})
    return json.loads(out)


def test_modify_dashboard_accepts_top_level_list_of_spec_updates():
    payload = json.dumps([
        {
            "tile_id": "tile-1",
            "vega_spec": {"mark": "bar", "encoding": {"x": {"field": "a"}}},
        }
    ])

    result = _invoke(payload)
    assert "error" not in result
    assert result.get("spec_updates")
    assert result["spec_updates"][0]["tile_id"] == "tile-1"


def test_modify_dashboard_accepts_list_of_wrapped_update_groups():
    payload = json.dumps([
        {"title_updates": [{"tile_id": "tile-2", "title": "Updated"}]},
        {"layout_updates": [{"tile_id": "tile-2", "x": 0, "y": 0, "w": 6, "h": 4}]},
    ])

    result = _invoke(payload)
    assert "error" not in result
    assert result.get("title_updates")
    assert result.get("layout_updates")


def test_modify_dashboard_rejects_non_object_payload():
    payload = json.dumps(["bad", "payload"])
    result = _invoke(payload)
    assert "error" in result


def test_modify_dashboard_accepts_native_dict_payload():
    out = modify_dashboard.invoke(
        {
            "modifications": {
                "title_updates": [{"tile_id": "tile-3", "title": "Revenue KPI"}],
            }
        }
    )
    result = json.loads(out)
    assert "error" not in result
    assert result.get("title_updates")


def test_modify_dashboard_accepts_native_list_payload():
    out = modify_dashboard.invoke(
        {
            "modifications": [
                {"tile_id": "tile-4", "markdown": "Updated"},
            ]
        }
    )
    result = json.loads(out)
    assert "error" not in result
    assert result.get("text_updates")


def test_modify_dashboard_accepts_list_of_json_strings_with_nested_kpi_update():
    payload = json.dumps([
        json.dumps({
            "tile_id": "tile-5",
            "kpi_updates": {"subtitle": "Data range: 2012-01-03 to 2026-02-27"},
        })
    ])
    result = _invoke(payload)
    assert "error" not in result
    assert result.get("kpi_updates")
    assert result["kpi_updates"][0]["tile_id"] == "tile-5"
    assert result["kpi_updates"][0]["subtitle"].startswith("Data range:")


def test_create_kpi_tile_is_idempotent_for_same_payload():
    first = json.loads(create_kpi_tile.invoke({
        "title": "Maximum Revenue Collected",
        "value": "$279,557.28",
        "subtitle": "Data range: 2012-01-03 to 2026-02-27",
        "color": "",
        "sparkline_data": "",
    }))
    second = json.loads(create_kpi_tile.invoke({
        "title": "Maximum Revenue Collected",
        "value": "$279,557.28",
        "subtitle": "Data range: 2012-01-03 to 2026-02-27",
        "color": "",
        "sparkline_data": "",
    }))
    assert first["tile_id"] == second["tile_id"]
