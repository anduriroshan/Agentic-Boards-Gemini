import json

from src.agent.tools import (
    _filter_results_by_provider,
    _get_fallback_metadata,
    create_data_table,
    create_kpi_tile,
    modify_dashboard,
    update_data_table,
)


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


def test_modify_dashboard_accepts_title_updates_as_string_with_tile_id():
    payload = json.dumps([
        json.dumps({
            "tile_id": "tile-8",
            "title_updates": "Top 8 Items by Revenue",
        })
    ])
    result = _invoke(payload)
    assert "error" not in result
    assert result.get("title_updates")
    assert result["title_updates"][0]["tile_id"] == "tile-8"
    assert result["title_updates"][0]["title"] == "Top 8 Items by Revenue"


def test_modify_dashboard_accepts_camel_case_aliases_for_spec_updates():
    out = modify_dashboard.invoke(
        {
            "modifications": {
                "specUpdates": {
                    "tileId": "tile-6",
                    "vegaSpec": {"mark": {"type": "bar", "color": "#ff00aa"}},
                }
            }
        }
    )
    result = json.loads(out)
    assert "error" not in result
    assert result.get("spec_updates")
    assert result["spec_updates"][0]["tile_id"] == "tile-6"
    assert isinstance(result["spec_updates"][0]["vega_spec"], dict)


def test_modify_dashboard_accepts_direct_spec_patch_without_vega_spec_key():
    out = modify_dashboard.invoke(
        {
            "modifications": {
                "specUpdates": {
                    "tileId": "tile-7",
                    "encoding": {"color": {"field": "item_description", "type": "nominal"}},
                }
            }
        }
    )
    result = json.loads(out)
    assert "error" not in result
    assert result.get("spec_updates")
    assert result["spec_updates"][0]["tile_id"] == "tile-7"
    assert result["spec_updates"][0]["vega_spec"]["encoding"]["color"]["field"] == "item_description"


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


def test_create_data_table_normalizes_column_aliases_and_wrapped_rows():
    out = create_data_table.invoke({
        "title": "Recent Sales",
        "columns": json.dumps([
            {"name": "invoice_and_item_number", "label": "Invoice"},
            {"column_name": "date"},
            {"field": "store_name", "headerName": "Store"},
        ]),
        "rows": json.dumps({
            "rows": [
                {"invoice_and_item_number": "INV-1", "date": "2025-01-01", "store_name": "A"},
                {"invoice_and_item_number": "INV-2", "date": "2025-01-02", "store_name": "B"},
            ]
        }),
    })
    result = json.loads(out)
    assert [c["field"] for c in result["columns"]] == [
        "invoice_and_item_number",
        "date",
        "store_name",
    ]
    assert result["rows"][0]["invoice_and_item_number"] == "INV-1"


def test_update_data_table_converts_row_arrays_to_objects():
    out = update_data_table.invoke({
        "tile_id": "tile-table-1",
        "title": "Recent Sales",
        "columns": json.dumps(["invoice_and_item_number", "date"]),
        "rows": json.dumps([["INV-1", "2025-01-01"], ["INV-2", "2025-01-02"]]),
    })
    result = json.loads(out)
    assert result["rows"][0] == {
        "invoice_and_item_number": "INV-1",
        "date": "2025-01-01",
    }


def test_filter_results_by_provider_prefers_bigquery_entries():
    results = [
        {"table": "agentic-boards.iowa_liquor_retail_sales.sales", "type": "bigquery"},
        {"table": "databricks-datasets.tpch.orders", "type": "databricks"},
    ]
    filtered = _filter_results_by_provider(results, "bigquery")
    assert len(filtered) == 1
    assert filtered[0]["type"] == "bigquery"


def test_fallback_metadata_bigquery_excludes_databricks_entries():
    fallback = _get_fallback_metadata("bigquery")
    assert all(str(entry.get("type", "")).lower() != "databricks" for entry in fallback)
