"""
Databricks REST API routes.

Endpoints for managing the Databricks PySpark connection, querying data,
and configuring the active table from the frontend.
"""

import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from src.databricks.client import get_databricks_manager
from src.databricks.sql_validator import validate_sql_read_only, InvalidSQLError

router = APIRouter(prefix="/databricks", tags=["databricks"])
logger = logging.getLogger(__name__)


# ── Request / Response models ─────────────────────────────────

class ConnectRequest(BaseModel):
    host: Optional[str] = None
    token: Optional[str] = None
    cluster_id: Optional[str] = None
    catalog: Optional[str] = None
    schema_name: Optional[str] = None  # 'schema' is reserved in Pydantic


class TableConfigRequest(BaseModel):
    table: str  # e.g. "variance.analysis_2.gold_variancesummary_03"
    catalog: Optional[str] = None
    schema_name: Optional[str] = None


class QueryRequest(BaseModel):
    sql: str
    limit: int = 1000


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/status")
async def databricks_status():
    """Return current connection status and active table config."""
    mgr = get_databricks_manager()
    return mgr.status


@router.post("/connect")
async def databricks_connect(req: ConnectRequest, bg: BackgroundTasks):
    """Start a Databricks SparkSession (may take 2-3 min).

    The connection is started in a background task so the HTTP response
    returns immediately.  Poll ``GET /status`` to know when it is ready.
    """
    mgr = get_databricks_manager()

    if mgr.is_connected:
        return {"message": "Already connected", **mgr.status}

    if mgr._connecting:
        return {"message": "Connection already in progress", **mgr.status}

    def _bg_connect():
        try:
            mgr.connect(
                host=req.host,
                token=req.token,
                cluster_id=req.cluster_id,
                catalog=req.catalog,
                schema=req.schema_name,
            )
        except Exception as exc:
            logger.error("Background Databricks connect failed: %s", exc)

    bg.add_task(_bg_connect)
    return {"message": "Connection started — poll /api/databricks/status", "connecting": True}


@router.post("/disconnect")
async def databricks_disconnect():
    """Disconnect the current SparkSession."""
    mgr = get_databricks_manager()
    mgr.disconnect()
    return {"message": "Disconnected", **mgr.status}


@router.post("/reconnect")
async def databricks_reconnect(req: ConnectRequest, bg: BackgroundTasks):
    """Force-disconnect and reconnect (background)."""
    mgr = get_databricks_manager()

    def _bg_reconnect():
        try:
            mgr.reconnect(
                host=req.host,
                token=req.token,
                cluster_id=req.cluster_id,
                catalog=req.catalog,
                schema=req.schema_name,
            )
        except Exception as exc:
            logger.error("Background Databricks reconnect failed: %s", exc)

    bg.add_task(_bg_reconnect)
    return {"message": "Reconnection started — poll /api/databricks/status"}


@router.post("/query", response_model=QueryResponse)
async def databricks_query(req: QueryRequest):
    """Execute a SQL query against Databricks and return results as JSON."""
    mgr = get_databricks_manager()
    if not mgr.is_connected:
        raise HTTPException(status_code=503, detail="Databricks is not connected. POST /api/databricks/connect first.")
    
    try:
        validate_sql_read_only(req.sql)
    except InvalidSQLError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        df = mgr.query(req.sql)
        pdf = mgr.to_pandas(df, limit=req.limit)
        columns = list(pdf.columns)
        rows = pdf.to_dict(orient="records")
        return QueryResponse(columns=columns, rows=rows, row_count=len(rows))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/tables")
async def databricks_list_tables(catalog: Optional[str] = None, schema: Optional[str] = None):
    """List available tables in the configured catalog.schema."""
    mgr = get_databricks_manager()
    if not mgr.is_connected:
        raise HTTPException(status_code=503, detail="Databricks is not connected.")
    try:
        tables = mgr.list_tables(catalog=catalog, schema=schema)
        return {"tables": tables, "catalog": catalog or mgr.catalog, "schema": schema or mgr.schema}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/table-config")
async def databricks_update_table(req: TableConfigRequest, bg: BackgroundTasks):
    """Update the active default table (and optionally catalog/schema).

    Invalidates the in-memory schema cache so the next search_metadata call
    will lazily re-fetch the new schema from Databricks.
    """
    mgr = get_databricks_manager()
    old_catalog, old_schema = mgr.catalog, mgr.schema

    if req.catalog:
        mgr.catalog = req.catalog
    if req.schema_name:
        mgr.schema = req.schema_name
    mgr.set_default_table(req.table)

    # Invalidate schema cache for old and new catalog.schema so next query
    # lazily re-fetches the fresh schema — no slow background indexing.
    from src.metadata import schema_cache
    schema_cache.invalidate(old_catalog, old_schema)
    if req.catalog or req.schema_name:
        schema_cache.invalidate(mgr.catalog, mgr.schema)

    return {
        "message": f"Default table set to {req.table}",
        "catalog": mgr.catalog,
        "schema": mgr.schema,
        "default_table": mgr.default_table,
    }


def _run_reindex(tables: list[str]) -> None:
    """Background helper: introspect tables and refresh Milvus index."""
    try:
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))
        from scripts.index_databricks_metadata import introspect_table
        from src.metadata.databricks_store import DatabricksMetadataStore

        all_docs: list[dict] = []
        for table_name in tables:
            try:
                docs = introspect_table(table_name)
                all_docs.extend(docs)
                logger.info("[REINDEX] %s → %d documents", table_name, len(docs))
            except Exception as exc:
                logger.error("[REINDEX] failed for %s: %s", table_name, exc)

        if all_docs:
            store = DatabricksMetadataStore()
            store.drop()
            count = store.upsert(all_docs)
            logger.info("[REINDEX] Finished — %d documents in Milvus", count)
        else:
            logger.warning("[REINDEX] No documents generated; Milvus not updated")
    except Exception as exc:
        logger.exception("[REINDEX] Background re-index failed: %s", exc)


@router.post("/reindex")
async def databricks_reindex(bg: BackgroundTasks,
                               catalog: Optional[str] = None,
                               schema: Optional[str] = None):
    """Trigger a Milvus re-index for all tables in the current (or given) catalog.schema.

    Runs in the background — returns immediately.  Watch server logs for progress.
    """
    mgr = get_databricks_manager()
    if not mgr.is_connected:
        raise HTTPException(status_code=503, detail="Databricks is not connected.")

    cat = catalog or mgr.catalog
    sch = schema or mgr.schema

    try:
        tables = mgr.list_tables(catalog=cat, schema=sch)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not list tables: {exc}")

    if not tables:
        return {"message": f"No tables found in {cat}.{sch}", "tables": []}

    bg.add_task(_run_reindex, tables)
    return {
        "message": f"Re-indexing {len(tables)} table(s) in background…",
        "tables": tables,
        "catalog": cat,
        "schema": sch,
    }


@router.get("/table-config")
async def databricks_get_table():
    """Get the current default table config."""
    mgr = get_databricks_manager()
    return {
        "catalog": mgr.catalog,
        "schema": mgr.schema,
        "default_table": mgr.default_table,
    }


@router.post("/schema-cache/warm")
async def warm_schema_cache(
    bg: BackgroundTasks,
    catalog: Optional[str] = None,
    schema: Optional[str] = None,
):
    """Pre-warm the in-memory schema cache for catalog.schema.

    Runs SHOW TABLES + DESCRIBE TABLE for every table in the schema and
    stores results in memory.  Much faster than Milvus reindex (~2-5s vs
    minutes) — no embeddings, no vector DB.

    Returns immediately; warming happens in a background thread.
    """
    mgr = get_databricks_manager()
    if not mgr.is_connected:
        raise HTTPException(status_code=503, detail="Databricks is not connected.")

    cat = catalog or mgr.catalog
    sch = schema or mgr.schema

    def _warm():
        from src.metadata import schema_cache
        schema_cache.invalidate(cat, sch)   # force fresh fetch
        result = schema_cache._get_or_populate(cat, sch)
        logger.info("[WARM] Schema cache populated: %d tables in %s.%s", len(result), cat, sch)

    bg.add_task(_warm)
    return {"message": f"Warming schema cache for {cat}.{sch} in background…", "catalog": cat, "schema": sch}


@router.get("/schema-cache/status")
async def schema_cache_status():
    """Return what's currently in the schema cache."""
    from src.metadata import schema_cache
    status = {}
    for key, entry in schema_cache._cache.items():
        age = int(time.time() - schema_cache._populated_at.get(key, 0))
        status[key] = {
            "tables": list(entry.keys()),
            "table_count": len(entry),
            "age_seconds": age,
            "stale": age > schema_cache.CACHE_TTL,
        }
    return {"cache": status, "total_schemas": len(status)}
