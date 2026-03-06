"""Milvus-based vector store for Cube.js metadata retrieval.

Stores embedded representations of measures, dimensions, and joins
from the Cube.js semantic layer. At query time, performs similarity
search to find the most relevant schema elements for a user question.
"""

import logging

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    MilvusClient,
    connections,
    utility,
)

from src.config import settings
from src.metadata.embeddings import EMBEDDING_DIM, embed_query, embed_texts

logger = logging.getLogger(__name__)

COLLECTION_NAME = "cube_metadata"


class MilvusVectorStore:
    """Client for storing and searching Cube.js metadata in Milvus."""

    def __init__(self):
        self._connected = False

    def _ensure_connection(self):
        """Connect to Milvus if not already connected."""
        if self._connected:
            return
        connections.connect(
            alias="default",
            host=settings.milvus_host,
            port=settings.milvus_port,
        )
        self._connected = True
        logger.info(f"Connected to Milvus at {settings.milvus_host}:{settings.milvus_port}")

    def _ensure_collection(self) -> Collection:
        """Get or create the cube_metadata collection."""
        self._ensure_connection()

        if utility.has_collection(COLLECTION_NAME):
            collection = Collection(COLLECTION_NAME)
            collection.load()
            return collection

        # Define schema
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=256),
            FieldSchema(name="cube_name", dtype=DataType.VARCHAR, max_length=128),
            FieldSchema(name="member_name", dtype=DataType.VARCHAR, max_length=256),
            FieldSchema(name="member_type", dtype=DataType.VARCHAR, max_length=32),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=2048),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM),
        ]
        schema = CollectionSchema(fields, description="Cube.js metadata for semantic search")
        collection = Collection(COLLECTION_NAME, schema)

        # Create IVF_FLAT index for similarity search
        index_params = {
            "metric_type": "IP",  # Inner Product (cosine similarity with normalized vectors)
            "index_type": "IVF_FLAT",
            "params": {"nlist": 128},
        }
        collection.create_index("embedding", index_params)
        collection.load()

        logger.info(f"Created Milvus collection '{COLLECTION_NAME}' with IVF_FLAT index")
        return collection

    def upsert(self, documents: list[dict]) -> int:
        """Index documents into Milvus.

        Each document should have:
            - id: str (e.g. "Orders.totalRevenue")
            - cube_name: str (e.g. "Orders")
            - member_name: str (e.g. "totalRevenue")
            - member_type: str ("measure" | "dimension")
            - text: str (human-readable description for embedding)

        Returns the number of documents inserted.
        """
        if not documents:
            return 0

        collection = self._ensure_collection()

        texts = [doc["text"] for doc in documents]
        vectors = embed_texts(texts)

        data = [
            [doc["id"] for doc in documents],
            [doc["cube_name"] for doc in documents],
            [doc["member_name"] for doc in documents],
            [doc["member_type"] for doc in documents],
            texts,
            vectors,
        ]

        # Delete existing docs with same IDs first (upsert behavior)
        ids = [doc["id"] for doc in documents]
        expr = " || ".join([f'id == "{doc_id}"' for doc_id in ids])
        try:
            collection.delete(expr)
        except Exception:
            pass  # Collection may be empty

        result = collection.insert(data)
        collection.flush()

        logger.info(f"Indexed {len(documents)} documents into Milvus")
        return result.insert_count

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        """Search for relevant Cube.js metadata using semantic similarity.

        Args:
            query: Natural language question from the user.
            top_k: Maximum number of results to return.

        Returns:
            List of dicts with keys: id, cube_name, member_name, member_type, text, score
        """
        collection = self._ensure_collection()

        query_vector = embed_query(query)

        search_params = {"metric_type": "IP", "params": {"nprobe": 16}}
        results = collection.search(
            data=[query_vector],
            anns_field="embedding",
            param=search_params,
            limit=top_k,
            output_fields=["cube_name", "member_name", "member_type", "text"],
        )

        hits = []
        for hit in results[0]:
            hits.append({
                "id": hit.id,
                "cube_name": hit.entity.get("cube_name"),
                "member_name": hit.entity.get("member_name"),
                "member_type": hit.entity.get("member_type"),
                "text": hit.entity.get("text"),
                "score": hit.score,
            })

        return hits

    def drop_collection(self):
        """Drop the collection (useful for re-indexing)."""
        self._ensure_connection()
        if utility.has_collection(COLLECTION_NAME):
            utility.drop_collection(COLLECTION_NAME)
            logger.info(f"Dropped collection '{COLLECTION_NAME}'")

    def count(self) -> int:
        """Return the number of documents in the collection."""
        collection = self._ensure_collection()
        return collection.num_entities
