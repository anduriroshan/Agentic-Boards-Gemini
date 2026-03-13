"""Chart refresh / live-data API endpoints.

These endpoints support the "live chart" feature — charts can re-execute
their source SQL with parameter overrides (e.g. changing LIMIT from 10 to 20)
without asking the AI again.
"""

from __future__ import annotations

import datetime
import decimal
import json
import logging
import re

from fastapi import APIRouter
from pydantic import BaseModel
from src.databricks.sql_validator import validate_sql_read_only, InvalidSQLError

router = APIRouter()
logger = logging.getLogger(__name__)


# ── SQL parameter detection & application ──────────────────────────────────────


def detect_sql_params(sql: str) -> dict:
    """Detect editable parameters from a SQL query.

    Scans for common SQL patterns (LIMIT, ORDER BY direction) and returns
    a dict of detected parameters with metadata for the frontend UI.
    """
    params: dict = {}

    # Detect LIMIT N
    limit_match = re.search(r"\bLIMIT\s+(\d+)\b", sql, re.IGNORECASE)
    if limit_match:
        params["limit"] = {
            "value": int(limit_match.group(1)),
            "type": "number",
            "label": "Row Limit",
            "min": 1,
            "max": 10000,
        }

    # Detect ORDER BY ... ASC|DESC
    order_match = re.search(
        r"\bORDER\s+BY\s+.+?\s+(ASC|DESC)\b", sql, re.IGNORECASE
    )
    if order_match:
        params["sortOrder"] = {
            "value": order_match.group(1).upper(),
            "type": "select",
            "label": "Sort Order",
            "options": ["ASC", "DESC"],
        }

    return params


def apply_sql_params(sql: str, overrides: dict) -> str:
    """Apply parameter overrides to a SQL query string.

    Only supports safe, validated transformations:
    - limit: replaces or appends LIMIT N (capped 1-10000)
    - sortOrder: swaps ASC/DESC in ORDER BY clause
    """
    modified = sql

    if "limit" in overrides:
        limit_val = max(1, min(10000, int(overrides["limit"])))
        if re.search(r"\bLIMIT\s+\d+\b", modified, re.IGNORECASE):
            modified = re.sub(
                r"\bLIMIT\s+\d+\b",
                f"LIMIT {limit_val}",
                modified,
                flags=re.IGNORECASE,
            )
        else:
            modified = modified.rstrip().rstrip(";") + f" LIMIT {limit_val}"

    if "sortOrder" in overrides:
        direction = str(overrides["sortOrder"]).upper()
        if direction in ("ASC", "DESC"):
            modified = re.sub(
                r"(\bORDER\s+BY\s+.+?\s+)(ASC|DESC)\b",
                rf"\g<1>{direction}",
                modified,
                flags=re.IGNORECASE,
            )

    return modified


# ── API models ─────────────────────────────────────────────────────────────────


class ChartRefreshRequest(BaseModel):
    sql: str
    params: dict = {}


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.post("/charts/refresh")
async def refresh_chart(request: ChartRefreshRequest):
    """Re-execute a chart's SQL query with optional parameter overrides.

    Used by the frontend to refresh chart data or change parameters
    (e.g. LIMIT, sort order) without re-invoking the AI agent.
    """
    from src.databricks.client import get_databricks_manager
    from src.bigquery.client import get_bigquery_manager

    provider_type = request.params.get("type", "databricks").lower()

    try:
        modified_sql = apply_sql_params(request.sql, request.params)
        logger.info("[CHART REFRESH] provider=%s SQL: %s", provider_type, modified_sql[:200])

        if provider_type == "bigquery":
            bq = get_bigquery_manager()
            rows = bq.query(modified_sql)
        else:
            dm = get_databricks_manager()
            if not dm.is_connected:
                return {"error": "Databricks is not connected.", "rows": []}
            validate_sql_read_only(request.sql)
            rows = dm.query(modified_sql)

        # Serialize non-JSON-safe types
        for row in rows:
            for k, v in row.items():
                if isinstance(v, (datetime.date, datetime.datetime)):
                    row[k] = v.isoformat()
                elif isinstance(v, decimal.Decimal):
                    row[k] = float(v)

        logger.info("[CHART REFRESH] returned %d rows", len(rows))
        return {
            "rows": rows,
            "row_count": len(rows),
            "sql": modified_sql,
            "params": detect_sql_params(modified_sql),
        }
    except Exception as e:
        logger.error("[CHART REFRESH] failed: %s", e)
        return {"error": str(e), "rows": []}
