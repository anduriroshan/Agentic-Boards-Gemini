"""
Index Databricks table metadata into Milvus for semantic search.

Connects to Databricks, introspects columns / types / sample values
for each configured table, generates embeddings, and upserts them.

Usage:
    cd backend
    python -m scripts.index_databricks_metadata

    # Index specific tables (overrides .env setting):
    python -m scripts.index_databricks_metadata \\
        variance.analysis_v2.gold_variancesummary_03 \\
        variance.analysis_v2.coa_hierarchy
"""

from __future__ import annotations

import hashlib
import logging
import sys
import os

# Ensure backend/src is importable when run as a script
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def _id(text: str) -> str:
    """Stable short ID from arbitrary text."""
    return hashlib.md5(text.encode()).hexdigest()[:16]


# ─────────────────────────────────────────────────────────────────────────────
# 1.  Introspect one table and produce a list of documents
# ─────────────────────────────────────────────────────────────────────────────

def introspect_table(table_name: str) -> list[dict]:
    """Return metadata documents for *table_name* by querying Databricks."""
    from src.databricks.client import get_databricks_manager

    mgr = get_databricks_manager()
    spark = mgr.connect()
    docs: list[dict] = []

    logger.info("Introspecting %s …", table_name)
    df = spark.table(table_name)
    schema = df.schema
    row_count = df.count()

    # ── Table-level document ──────────────────────────────────
    col_names = [f.name for f in schema.fields]
    docs.append({
        "id": _id(f"table:{table_name}"),
        "doc_type": "table",
        "table_name": table_name,
        "text": (
            f"Table '{table_name}' contains {row_count:,} rows and "
            f"{len(col_names)} columns: {', '.join(col_names)}."
        ),
        "metadata": {
            "row_count": row_count,
            "column_count": len(col_names),
            "columns": col_names,
        },
    })
    logger.info("  %d columns, %s rows", len(col_names), f"{row_count:,}")

    # ── Sample for column-level docs ──────────────────────────
    SAMPLE_ROWS = 1000
    logger.info("  Pulling %d-row sample for column stats …", SAMPLE_ROWS)
    sample_pdf = df.limit(SAMPLE_ROWS).toPandas()

    numeric_cols: list[str] = []
    categorical_cols: list[str] = []
    date_cols: list[str] = []

    for field in schema.fields:
        col = field.name
        dtype_str = str(field.dataType)

        # -- Per-column document --------------------------------
        if col in sample_pdf.columns:
            series = sample_pdf[col].dropna()
            cardinality = int(series.nunique())
            null_pct = int(sample_pdf[col].isna().sum())
            sample_vals = [str(v) for v in series.unique()[:15]]
        else:
            cardinality = 0
            null_pct = 0
            sample_vals = []

        # Numeric stats
        stats_snippet = ""
        is_numeric = any(
            t in dtype_str
            for t in ("Long", "Int", "Double", "Float", "Short", "Decimal")
        )
        if is_numeric and len(sample_pdf.get(col, [])):
            num = sample_pdf[col].dropna()
            if len(num) > 0:
                stats_snippet = (
                    f" Stats (sample): min={num.min()}, max={num.max()}, "
                    f"mean={num.mean():.2f}."
                )
            numeric_cols.append(col)

        # Date detection
        if any(t in dtype_str for t in ("Date", "Timestamp")):
            date_cols.append(col)

        text = (
            f"Column '{col}' in table '{table_name}'. "
            f"Type: {dtype_str}. "
            f"Cardinality (sample): {cardinality}. "
            f"Nulls (sample): {null_pct}/{len(sample_pdf)}."
            f"{stats_snippet} "
            f"Sample values: {', '.join(sample_vals[:10])}."
        )

        docs.append({
            "id": _id(f"col:{table_name}.{col}"),
            "doc_type": "column",
            "table_name": table_name,
            "column_name": col,
            "text": text,
            "metadata": {
                "column_name": col,
                "data_type": dtype_str,
                "cardinality": cardinality,
                "sample_values": sample_vals[:10],
                "nullable": field.nullable,
            },
        })

        # -- Categorical values document (low-cardinality) ------
        if col in sample_pdf.columns:
            uniq = sample_pdf[col].dropna().unique()
            if 1 < len(uniq) <= 30:
                all_vals = sorted(str(v) for v in uniq)
                categorical_cols.append(col)
                docs.append({
                    "id": _id(f"cat:{table_name}.{col}"),
                    "doc_type": "categorical",
                    "table_name": table_name,
                    "column_name": col,
                    "text": (
                        f"Column '{col}' in table '{table_name}' is categorical "
                        f"with {len(all_vals)} distinct values: {', '.join(all_vals)}. "
                        f"Use these exact values when filtering."
                    ),
                    "metadata": {
                        "column_name": col,
                        "distinct_values": all_vals,
                    },
                })

    # ── Analysis-guide document ───────────────────────────────
    docs.append({
        "id": _id(f"guide:{table_name}"),
        "doc_type": "analysis_guide",
        "table_name": table_name,
        "text": (
            f"Table '{table_name}' analysis guide — "
            f"Numeric/measure columns (aggregate): {', '.join(numeric_cols) or 'none'}. "
            f"Categorical/dimension columns (GROUP BY / filter): {', '.join(categorical_cols) or 'none'}. "
            f"Date/time columns (time-series): {', '.join(date_cols) or 'none'}."
        ),
        "metadata": {
            "numeric_columns": numeric_cols,
            "categorical_columns": categorical_cols,
            "date_columns": date_cols,
        },
    })

    logger.info(
        "  Generated %d documents (%d column, %d categorical, 1 table, 1 guide)",
        len(docs),
        sum(1 for d in docs if d["doc_type"] == "column"),
        sum(1 for d in docs if d["doc_type"] == "categorical"),
    )
    return docs


# ─────────────────────────────────────────────────────────────────────────────
# 2.  Main: introspect all tables → embed → upsert into Milvus
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    # Resolve table list from CLI args or env
    if len(sys.argv) > 1:
        tables = sys.argv[1:]
    else:
        raw = settings.databricks_index_tables
        if not raw:
            logger.error(
                "No tables specified. Pass them as CLI args or set "
                "DATABRICKS_INDEX_TABLES in .env"
            )
            sys.exit(1)
        tables = [t.strip() for t in raw.split(",") if t.strip()]

    print("=" * 64)
    print("  Databricks Metadata → Milvus Indexer")
    print("=" * 64)
    print(f"\n  Tables to index: {len(tables)}")
    for t in tables:
        print(f"    • {t}")

    # 1. Connect to Databricks (reuses singleton — one 2-3 min wait)
    print("\n[1/3] Connecting to Databricks …")
    from src.databricks.client import get_databricks_manager
    mgr = get_databricks_manager()
    mgr.connect()
    print(f"  ✓ Connected (Spark {mgr.spark.version})")

    # 2. Introspect each table
    print("\n[2/3] Introspecting tables …")
    all_docs: list[dict] = []
    for table_name in tables:
        try:
            docs = introspect_table(table_name)
            all_docs.extend(docs)
            print(f"  ✓ {table_name}: {len(docs)} documents")
        except Exception as exc:
            logger.error("  ✗ %s — %s", table_name, exc)

    if not all_docs:
        print("\n  No documents to index. Exiting.")
        sys.exit(0)

    # 3. Embed & upsert into Milvus
    print(f"\n[3/3] Embedding & upserting {len(all_docs)} documents into Milvus …")
    from src.metadata.databricks_store import DatabricksMetadataStore
    store = DatabricksMetadataStore()
    store.drop()  # Fresh re-index
    count = store.upsert(all_docs)

    total = store.count()
    print(f"\n  ✓ Indexed {count} documents — collection now has {total} total.")
    print("=" * 64)

    # Preview
    print("\n  Document type breakdown:")
    from collections import Counter
    type_counts = Counter(d["doc_type"] for d in all_docs)
    for doc_type, cnt in type_counts.most_common():
        print(f"    {doc_type:20s} {cnt}")


if __name__ == "__main__":
    main()
