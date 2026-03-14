"""
Lazy in-memory schema cache for Databricks tables.

Instead of running an indexing job upfront, this module introspects the
catalog/schema on the first search_metadata call and caches the result for
the lifetime of the process.  Subsequent calls are instant (dict lookup +
keyword scoring).

No Milvus, no background jobs, no waiting.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Types
# ------------------------------------------------------------------

TableMeta = dict[str, Any]   # {table, columns, measures, dimensions, ...}
SchemaCacheEntry = dict[str, TableMeta]  # keyed by fully-qualified table name


# ------------------------------------------------------------------
# Singleton cache
# ------------------------------------------------------------------

_lock = threading.Lock()
_cache: dict[str, SchemaCacheEntry] = {}   # key = "catalog.schema"
_populated_at: dict[str, float] = {}       # key = "catalog.schema" → epoch

# Refresh if cache is older than this (seconds).  Default: 30 min.
CACHE_TTL = 1800


def _cache_key(catalog: str, schema: str) -> str:
    return f"{catalog}.{schema}"


def invalidate(catalog: str, schema: str) -> None:
    """Evict cached schema — call this when the user changes Databricks config."""
    key = _cache_key(catalog, schema)
    with _lock:
        _cache.pop(key, None)
        _populated_at.pop(key, None)
    logger.info("[SchemaCache] Invalidated cache for %s", key)


def invalidate_all() -> None:
    with _lock:
        _cache.clear()
        _populated_at.clear()
    logger.info("[SchemaCache] Full cache cleared")


# ------------------------------------------------------------------
# Cache population — calls Databricks once, stores in memory
# ------------------------------------------------------------------

def _fetch_schema(catalog: str, schema: str) -> SchemaCacheEntry:
    """SHOW TABLES + DESCRIBE each table in catalog.schema.

    Returns a dict keyed by fully-qualified table name.
    """
    from src.databricks.client import get_databricks_manager

    mgr = get_databricks_manager()
    if not mgr.is_connected:
        logger.warning("[SchemaCache] Databricks not connected — returning empty schema")
        return {}

    logger.info("[SchemaCache] Fetching schema for %s.%s …", catalog, schema)
    t0 = time.time()

    try:
        rows = mgr.query(f"SHOW TABLES IN {catalog}.{schema}")
    except Exception as exc:
        logger.error("[SchemaCache] SHOW TABLES failed: %s", exc)
        return {}

    entry: SchemaCacheEntry = {}

    for row in rows:
        table_name = f"{catalog}.{schema}.{row.get('tableName', row.get('table_name', ''))}"
        if not table_name.endswith("."):
            try:
                desc_rows = mgr.query(f"DESCRIBE TABLE {table_name}")
            except Exception as exc:
                logger.warning("[SchemaCache] DESCRIBE %s failed: %s", table_name, exc)
                continue
        else:
            continue

        columns: list[str] = []
        measures: list[str] = []
        dimensions: list[str] = []

        for r in desc_rows:
            col_name = (r.get("col_name") or r.get("column_name") or "").strip()
            col_type = (r.get("data_type") or r.get("col_type") or "").strip()

            # DESCRIBE TABLE adds a blank separator row before partitioning info
            if not col_name or col_name.startswith("#"):
                break

            columns.append(col_name)
            full_ref = f"{table_name}.{col_name}"

            is_numeric = any(
                t in col_type
                for t in ("bigint", "int", "long", "double", "float", "decimal", "short")
            )
            if is_numeric:
                measures.append(full_ref)
            else:
                dimensions.append(full_ref)

        entry[table_name] = {
            "table": table_name,
            "type": "databricks",
            "cube": table_name.split(".")[-1],
            "columns": columns,
            "measures": measures,
            "dimensions": dimensions,
        }
        logger.debug("[SchemaCache] %s — %d columns", table_name, len(columns))

    elapsed = time.time() - t0
    logger.info(
        "[SchemaCache] Cached %d tables in %s.%s (%.1fs)",
        len(entry), catalog, schema, elapsed,
    )
    return entry


def _get_or_populate(catalog: str, schema: str) -> SchemaCacheEntry:
    """Return cached schema, re-fetching if missing or stale."""
    key = _cache_key(catalog, schema)

    with _lock:
        age = time.time() - _populated_at.get(key, 0)
        if key in _cache and age < CACHE_TTL:
            return _cache[key]

    # Fetch outside lock so other threads aren't blocked
    data = _fetch_schema(catalog, schema)

    with _lock:
        _cache[key] = data
        _populated_at[key] = time.time()

    return data


# ------------------------------------------------------------------
# Keyword-scoring search  (no embeddings, no Milvus)
# ------------------------------------------------------------------

_STOP_WORDS = {
    "a", "an", "the", "in", "on", "at", "by", "for", "with", "from",
    "to", "of", "and", "or", "is", "are", "was", "were", "show", "me",
    "create", "make", "build", "get", "give", "chart", "table", "plot",
    "pie", "bar", "line", "top", "bottom", "all", "my", "their",
}


def _tokenise(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {t for t in tokens if t not in _STOP_WORDS and len(t) > 1}


def _score(query_tokens: set[str], meta: TableMeta) -> float:
    """Return a relevance score [0, ∞) for a table against the query tokens."""
    score = 0.0
    table_name_tokens = _tokenise(meta["table"])
    column_tokens = _tokenise(" ".join(meta["columns"]))

    for token in query_tokens:
        # Exact token in table name → high value
        if token in table_name_tokens:
            score += 3.0
        # Partial match in table name (e.g. "sale" matches "sales_transactions")
        elif any(token in t for t in table_name_tokens):
            score += 1.5
        # Match in column names
        if token in column_tokens:
            score += 2.0
        elif any(token in c for c in column_tokens):
            score += 0.5

    return score


def search(
    query: str,
    catalog: str,
    schema: str,
    top_k: int = 5,
) -> list[TableMeta]:
    """Find the most relevant tables for *query* using keyword scoring.

    Populates the cache on first call (lazy).  Subsequent calls are instant.
    """
    entry = _get_or_populate(catalog, schema)

    if not entry:
        return []

    query_tokens = _tokenise(query)
    if not query_tokens:
        # No useful tokens — return all tables (let LLM decide)
        return list(entry.values())[:top_k]

    scored = [
        (meta, _score(query_tokens, meta))
        for meta in entry.values()
    ]
    scored.sort(key=lambda x: x[1], reverse=True)

    # Always return at least the top_k results even if score is 0
    top = [meta for meta, score in scored[:top_k] if score > 0]
    
    # If no tables had a positive score, just return the top_k by default 
    # to give the LLM something to work with rather than just 1 arbitrary table.
    if not top and scored:
        top = [meta for meta, score in scored[:top_k]]

    logger.info(
        "[SchemaCache] search(%r) → %s",
        query[:60],
        [m["table"].split(".")[-1] for m in top],
    )
    return top
