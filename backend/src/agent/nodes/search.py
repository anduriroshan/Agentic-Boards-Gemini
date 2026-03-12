import logging
from collections import defaultdict

from langchain_core.messages import HumanMessage

from src.agent.state import AgentState
from src.config import settings

logger = logging.getLogger(__name__)

# ── Hardcoded fallback (used when Milvus is disabled) ────────────────────────
FALLBACK_METADATA = [
    {
        "cube": "sales_transactions",
        "table": "sample.bakehouse.sales_transactions",
        "measures": [],
        "dimensions": [],
        "description": "Variance summary (fallback – run index_databricks_metadata to populate Milvus)",
    },
    {
        "cube": "coa_hierarchy",
        "table": "variance.analysis_v2.coa_hierarchy",
        "measures": [],
        "dimensions": [],
        "description": "COA hierarchy (fallback – run index_databricks_metadata to populate Milvus)",
    },
    {
        "cube": "sales",
        "table": "agentic-boards.iowa_liquor_retail_sales.sales",
        "type": "bigquery",
        "measures": [],
        "dimensions": [],
        "description": "Iowa liquor retail sales (BigQuery)",
    },
]


def _hits_to_metadata(hits: list[dict]) -> list[dict]:
    """Convert Milvus search hits into structured metadata for the LLM.

    Groups column-level hits by table and classifies them as numeric
    (measures) or categorical/date (dimensions) based on doc_type and
    metadata stored in each hit.
    """
    tables: dict[str, dict] = defaultdict(lambda: {
        "table": "",
        "columns": [],
        "measures": [],
        "dimensions": [],
        "categorical_values": {},
        "analysis_guide": "",
    })

    for hit in hits:
        tbl = hit.get("table_name", "")
        doc_type = hit.get("doc_type", "")
        meta = hit.get("metadata", {})

        if not tbl:
            continue

        tables[tbl]["table"] = tbl

        if doc_type == "table":
            tables[tbl]["columns"] = meta.get("columns", [])

        elif doc_type == "column":
            col_name = hit.get("column_name", meta.get("column_name", ""))
            dtype = meta.get("data_type", "")
            is_numeric = any(
                t in dtype for t in ("Long", "Int", "Double", "Float", "Short", "Decimal")
            )
            full_ref = f"{tbl}.{col_name}"
            if is_numeric:
                tables[tbl]["measures"].append(full_ref)
            else:
                tables[tbl]["dimensions"].append(full_ref)

        elif doc_type == "categorical":
            col_name = hit.get("column_name", meta.get("column_name", ""))
            tables[tbl]["categorical_values"][col_name] = meta.get("distinct_values", [])

        elif doc_type == "analysis_guide":
            tables[tbl]["analysis_guide"] = hit.get("text", "")

    return [
        {
            "cube": tbl.split(".")[-1],
            "table": data["table"],
            "measures": data["measures"],
            "dimensions": data["dimensions"],
            "categorical_values": data["categorical_values"],
            "analysis_guide": data["analysis_guide"],
            "columns": data["columns"],
        }
        for tbl, data in tables.items()
    ]


async def search_node(state: AgentState) -> dict:
    """Search for relevant Databricks table metadata.

    When Milvus is enabled (MILVUS_ENABLED=true), performs semantic
    similarity search to find the most relevant columns and tables
    for the user's question.  Otherwise falls back to hardcoded stubs.
    """
    if not settings.milvus_enabled:
        logger.info("Milvus disabled – returning fallback metadata")
        return {"cube_metadata": FALLBACK_METADATA}

    # Extract the user's question
    user_query = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            user_query = msg.content if isinstance(msg.content, str) else str(msg.content)
            break

    if not user_query:
        return {"cube_metadata": FALLBACK_METADATA}

    try:
        from src.metadata.databricks_store import DatabricksMetadataStore

        store = DatabricksMetadataStore()
        hits = store.search(user_query, top_k=15)
        logger.info("Milvus returned %d hits for: %s", len(hits), user_query[:80])

        if not hits:
            logger.warning("Milvus returned 0 hits – falling back to hardcoded metadata")
            return {"cube_metadata": FALLBACK_METADATA}

        metadata = _hits_to_metadata(hits)
        return {"cube_metadata": metadata}

    except Exception as e:
        logger.exception("Milvus search failed: %s. Falling back to hardcoded metadata.", e)
        return {"cube_metadata": FALLBACK_METADATA}
