"""Milvus-based vector store for Cube.js metadata retrieval.

Stores embedded representations of measures, dimensions, and joins
from the Cube.js semantic layer. At query time, performs similarity
search to find the most relevant schema elements for a user question.
"""

import logging

from pymilvus import MilvusClient, DataType

from src.config import settings
from src.metadata.embeddings import EMBEDDING_DIM, embed_query, embed_texts

logger = logging.getLogger(__name__)

COLLECTION_NAME = "cube_metadata"


class MilvusVectorStore:
    """Client for storing and searching Cube.js metadata in Milvus (Lite or Server)."""

    def __init__(self):
        self._client: MilvusClient | None = None

    def _get_client(self) -> MilvusClient:
        """Initialize and return the MilvusClient."""
        if self._client is None:
            import os
            from pathlib import Path
            uri = settings.milvus_uri
            if not uri.startswith(("http://", "https://")):
                # Resolve to absolute path and ensure directory exists
                path = Path(uri).resolve()
                path.parent.mkdir(parents=True, exist_ok=True)
                uri = str(path)

            self._client = MilvusClient(
                uri=uri,
                token=settings.milvus_token
            )
            logger.info("Initialized MilvusClient (Cube) with URI: %s", uri)
        return self._client

    def _ensure_collection(self):
        """Ensure the collection exists and is loaded."""
        client = self._get_client()

        if client.has_collection(COLLECTION_NAME):
            return

        # Define schema and index in one go using the high-level API
        client.create_collection(
            collection_name=COLLECTION_NAME,
            dimension=EMBEDDING_DIM,
            primary_field_name="id",
            id_type="string",
            max_length=256,
            metric_type="IP",  # Inner Product
            auto_id=False
        )
        logger.info("Created Milvus collection '%s'", COLLECTION_NAME)

    def upsert(self, documents: list[dict]) -> int:
        """Index documents into Milvus."""
        if not documents:
            return 0

        self._ensure_collection()
        client = self._get_client()

        texts = [doc["text"] for doc in documents]
        vectors = embed_texts(texts)

        data = []
        for i, doc in enumerate(documents):
            data.append({
                "id": doc["id"],
                "cube_name": doc["cube_name"],
                "member_name": doc["member_name"],
                "member_type": doc["member_type"],
                "text": texts[i],
                "vector": vectors[i],
            })

        # MilvusClient supports upsert directly
        result = client.upsert(collection_name=COLLECTION_NAME, data=data)
        
        logger.info(f"Upserted {len(documents)} documents into Milvus")
        return result.get("upsert_count", len(documents))

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        """Search for relevant Cube.js metadata using semantic similarity."""
        self._ensure_collection()
        client = self._get_client()

        query_vector = embed_query(query)

        results = client.search(
            collection_name=COLLECTION_NAME,
            data=[query_vector],
            limit=top_k,
            output_fields=["cube_name", "member_name", "member_type", "text"],
        )

        hits = []
        for hit in results[0]:
            # MilvusClient returns results as dicts
            hits.append({
                "id": hit["id"],
                "cube_name": hit["entity"].get("cube_name"),
                "member_name": hit["entity"].get("member_name"),
                "member_type": hit["entity"].get("member_type"),
                "text": hit["entity"].get("text"),
                "score": hit["distance"],
            })

        return hits

    def drop_collection(self):
        """Drop the collection."""
        client = self._get_client()
        if client.has_collection(COLLECTION_NAME):
            client.drop_collection(COLLECTION_NAME)
            logger.info(f"Dropped collection '{COLLECTION_NAME}'")

    def count(self) -> int:
        """Return the number of documents in the collection."""
        self._ensure_collection()
        client = self._get_client()
        res = client.get_collection_stats(COLLECTION_NAME)
        return int(res.get("row_count", 0))
