"""Google Gemini embedding model for fast, serverless vector generation.

Uses Google's text-embedding-004 model. This avoids installing 
massive local libraries like torch and sentence-transformers.
"""

import logging
from src.config import settings

logger = logging.getLogger(__name__)

_embeddings = None

def _get_embeddings():
    """Lazy-load the Google embeddings client."""
    global _embeddings
    if _embeddings is None:
        try:
            # 1. Use Vertex AI if GCP context is provided
            if settings.gcp_project_id:
                from langchain_google_vertexai import VertexAIEmbeddings
                logger.info("Initializing Vertex AI Embeddings...")
                _embeddings = VertexAIEmbeddings(
                    model="text-embedding-004",
                    project=settings.gcp_project_id,
                    location=settings.gcp_region,
                )
            else:
                # 2. Fallback to AI Studio
                from langchain_google_genai import GoogleGenerativeAIEmbeddings
                logger.info("Initializing Google Gemini Embeddings (AI Studio)...")
                _embeddings = GoogleGenerativeAIEmbeddings(
                    model="models/text-embedding-004",
                    google_api_key=settings.gemini_api_key,
                    transport="rest",
                )
        except ImportError as e:
            raise RuntimeError(
                f"Required library missing: {e}. "
                "Check pyproject.toml dependencies."
            )
    return _embeddings

def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts using Gemini API."""
    client = _get_embeddings()
    return client.embed_documents(texts)

def embed_query(text: str) -> list[float]:
    """Generate an embedding for a single query string using Gemini API."""
    client = _get_embeddings()
    return client.embed_query(text)

# Dimension for text-embedding-004 is 768 by default
EMBEDDING_DIM = 768
