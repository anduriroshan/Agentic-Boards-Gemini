"""Local embedding model using sentence-transformers.

Uses all-MiniLM-L6-v2 (~80MB) for fast, offline vector generation.
Loaded lazily on first call to avoid startup cost if not needed.
"""

import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    """Lazy-load the sentence-transformers model."""
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model: all-MiniLM-L6-v2 ...")
            _model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Embedding model loaded.")
        except ImportError:
            raise RuntimeError(
                "sentence-transformers is required for embeddings. "
                "Install it with: pip install sentence-transformers"
            )
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts.

    Returns a list of float vectors (384 dimensions for MiniLM-L6-v2).
    """
    model = _get_model()
    embeddings = model.encode(texts, normalize_embeddings=True)
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    """Generate an embedding for a single query string."""
    return embed_texts([text])[0]


# Dimension of the embedding vectors (all-MiniLM-L6-v2)
EMBEDDING_DIM = 384
