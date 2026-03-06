"""
Milvus vector store for Databricks table metadata.

Stores embedded column descriptions, categorical values, and analysis
guides so the LLM agent can discover schema semantically at query time.

Replaces the older Cube.js-oriented cube_metadata collection.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    connections,
    utility,
)

from src.config import settings
from src.metadata.embeddings import EMBEDDING_DIM, embed_query, embed_texts

logger = logging.getLogger(__name__)

COLLECTION_NAME = "databricks_metadata"


class DatabricksMetadataStore:
    """Stores and retrieves Databricks table metadata in Milvus."""

    def __init__(self) -> None:
        self._connected = False

    # ── Connection ────────────────────────────────────────────

    def _ensure_connection(self) -> None:
        if self._connected:
            return
        # Disconnect any stale alias before reconnecting
        try:
            connections.disconnect("default")
        except Exception:
            pass
        connections.connect(
            alias="default",
            host=settings.milvus_host,
            port=int(settings.milvus_port),
        )
        self._connected = True
        logger.info("Connected to Milvus at %s:%s", settings.milvus_host, settings.milvus_port)

    def _ensure_collection(self) -> Collection:
        self._ensure_connection()

        if utility.has_collection(COLLECTION_NAME):
            col = Collection(COLLECTION_NAME)
            col.load()
            return col

        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=256),
            FieldSchema(name="doc_type", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="table_name", dtype=DataType.VARCHAR, max_length=256),
            FieldSchema(name="column_name", dtype=DataType.VARCHAR, max_length=256),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=4096),
            FieldSchema(name="metadata_json", dtype=DataType.VARCHAR, max_length=8192),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM),
        ]
        schema = CollectionSchema(fields, description="Databricks table metadata for semantic search")
        col = Collection(COLLECTION_NAME, schema)

        col.create_index(
            "embedding",
            {
                "index_type": "IVF_FLAT",
                "metric_type": "COSINE",
                "params": {"nlist": 128},
            },
        )
        col.load()
        logger.info("Created Milvus collection '%s'", COLLECTION_NAME)
        return col

    # ── Write ─────────────────────────────────────────────────

    def upsert(self, documents: list[dict[str, Any]]) -> int:
        """Embed and upsert documents into Milvus.

        Each document must have: id, doc_type, table_name, text.
        Optional: column_name, metadata (dict).
        """
        if not documents:
            return 0

        col = self._ensure_collection()

        texts = [d["text"] for d in documents]
        vectors = embed_texts(texts)

        data = [
            [d["id"] for d in documents],
            [d["doc_type"] for d in documents],
            [d["table_name"] for d in documents],
            [d.get("column_name", "") for d in documents],
            [d["text"][:4090] for d in documents],
            [json.dumps(d.get("metadata", {}))[:8190] for d in documents],
            vectors,
        ]

        # Delete existing with same IDs
        ids = [d["id"] for d in documents]
        try:
            expr = " || ".join([f'id == "{i}"' for i in ids])
            col.delete(expr)
        except Exception:
            pass

        result = col.insert(data)
        col.flush()
        logger.info("Upserted %d documents into '%s'", len(documents), COLLECTION_NAME)
        return result.insert_count

    # ── Read ──────────────────────────────────────────────────

    def search(self, query: str, top_k: int = 15) -> list[dict[str, Any]]:
        """Semantic search for relevant table metadata."""
        col = self._ensure_collection()

        query_vec = embed_query(query)
        results = col.search(
            data=[query_vec],
            anns_field="embedding",
            param={"metric_type": "COSINE", "params": {"nprobe": 16}},
            limit=top_k,
            output_fields=["doc_type", "table_name", "column_name", "text", "metadata_json"],
        )

        hits = []
        for hit in results[0]:
            fields = hit.fields if hasattr(hit, "fields") else hit.entity.__dict__
            meta_raw = fields.get("metadata_json") or "{}"
            hits.append({
                "id": hit.id,
                "score": hit.score,
                "doc_type": fields.get("doc_type"),
                "table_name": fields.get("table_name"),
                "column_name": fields.get("column_name"),
                "text": fields.get("text"),
                "metadata": json.loads(meta_raw) if meta_raw else {},
            })

        return hits

    # ── Maintenance ───────────────────────────────────────────

    def drop(self) -> None:
        self._ensure_connection()
        if utility.has_collection(COLLECTION_NAME):
            utility.drop_collection(COLLECTION_NAME)
            logger.info("Dropped collection '%s'", COLLECTION_NAME)

    def count(self) -> int:
        col = self._ensure_collection()
        return col.num_entities
