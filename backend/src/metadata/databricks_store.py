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

from pymilvus import MilvusClient, DataType

from src.config import settings
from src.metadata.embeddings import EMBEDDING_DIM, embed_query, embed_texts

logger = logging.getLogger(__name__)

COLLECTION_NAME = "databricks_metadata"


class DatabricksMetadataStore:
    """Stores and retrieves Databricks table metadata in Milvus (Lite or Server)."""

    def __init__(self) -> None:
        self._client: MilvusClient | None = None

    def _get_client(self) -> MilvusClient:
        if self._client is None:
            import os
            from pathlib import Path
            # Ensure path is absolute for Milvus Lite
            uri = settings.milvus_uri
            if not uri.startswith(("http://", "https://")):
                # Resolve to absolute path and ensure directory exists
                path = Path(uri).resolve()
                path.parent.mkdir(parents=True, exist_ok=True)
                uri = str(path)
                
            logger.info(f"[Milvus] Connecting to: {uri}")
            client_kwargs = {"uri": uri}
            if settings.milvus_token:
                client_kwargs["token"] = settings.milvus_token
            
            self._client = MilvusClient(**client_kwargs)
        return self._client

    def _ensure_collection(self) -> None:
        client = self._get_client()

        if client.has_collection(COLLECTION_NAME):
            return

        # Define schema and index using high-level API
        # Using COSINE metric for richer Databricks metadata
        client.create_collection(
            collection_name=COLLECTION_NAME,
            dimension=EMBEDDING_DIM,
            primary_field_name="id",
            id_type="string",
            max_length=256,
            metric_type="COSINE",
            auto_id=False
        )
        logger.info("Created Milvus collection '%s'", COLLECTION_NAME)

    # ── Write ─────────────────────────────────────────────────

    def upsert(self, documents: list[dict[str, Any]]) -> int:
        """Embed and upsert documents into Milvus."""
        if not documents:
            return 0

        self._ensure_collection()
        client = self._get_client()

        texts = [d["text"] for d in documents]
        vectors = embed_texts(texts)

        data = []
        for i, d in enumerate(documents):
            data.append({
                "id": d["id"],
                "doc_type": d["doc_type"],
                "table_name": d["table_name"],
                "column_name": d.get("column_name", ""),
                "text": d["text"][:4090],
                "metadata_json": json.dumps(d.get("metadata", {}))[:8190],
                "vector": vectors[i],
            })

        result = client.upsert(collection_name=COLLECTION_NAME, data=data)
        logger.info("Upserted %d documents into '%s'", len(documents), COLLECTION_NAME)
        return result.get("upsert_count", len(documents))

    def search(self, query: str, top_k: int = 15) -> list[dict[str, Any]]:
        """Semantic search for relevant table metadata."""
        self._ensure_collection()
        client = self._get_client()

        query_vec = embed_query(query)
        results = client.search(
            collection_name=COLLECTION_NAME,
            data=[query_vec],
            limit=top_k,
            output_fields=["doc_type", "table_name", "column_name", "text", "metadata_json"],
        )

        hits = []
        for hit in results[0]:
            entity = hit.get("entity", {})
            meta_raw = entity.get("metadata_json") or "{}"
            hits.append({
                "id": hit["id"],
                "score": hit["distance"],
                "doc_type": entity.get("doc_type"),
                "table_name": entity.get("table_name"),
                "column_name": entity.get("column_name"),
                "text": entity.get("text"),
                "metadata": json.loads(meta_raw) if meta_raw else {},
            })

        return hits

    def drop(self) -> None:
        client = self._get_client()
        if client.has_collection(COLLECTION_NAME):
            client.drop_collection(COLLECTION_NAME)
            logger.info("Dropped collection '%s'", COLLECTION_NAME)

    def count(self) -> int:
        self._ensure_collection()
        client = self._get_client()
        res = client.get_collection_stats(COLLECTION_NAME)
        return int(res.get("row_count", 0))
