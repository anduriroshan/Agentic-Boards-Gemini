"""
LLM module — factory function ``get_llm()`` returns the right
LangChain chat model based on ``LLM_MODE`` in your .env:

  - **openai**: Standard OpenAI API.
  - **gemini**: Google Gemini API via langchain-google-genai.

All agent nodes should import ``get_llm`` instead of a concrete class.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from langchain_core.language_models.chat_models import BaseChatModel

from src.config import settings

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

__all__ = ["get_llm"]


def get_llm(requested_model: str | None = None) -> BaseChatModel:
    """Return a LangChain chat model configured from environment variables."""
    mode = settings.llm_mode.strip().lower()
    if mode == "openai":
        return _build_openai(requested_model)
    elif mode == "gemini":
        return _build_gemini(requested_model)
    else:
        raise ValueError(
            f"Unknown LLM_MODE='{settings.llm_mode}'. "
            "Expected 'openai' or 'gemini'."
        )




def _build_openai(requested_model: str | None = None) -> BaseChatModel:
    """Standard OpenAI API — direct connection with a plain API key.

    This is the simplest mode: just set OPENAI_API_KEY and optionally
    OPENAI_MODEL / OPENAI_BASE_URL in your .env file.
    """
    from langchain_openai import ChatOpenAI

    if not settings.openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. "
            "Set it in backend/.env for openai mode."
        )

    model_name = requested_model or settings.openai_model

    logger.info(
        "LLM mode=openai  model=%s  base_url=%s",
        model_name,
        settings.openai_base_url,
    )

    return ChatOpenAI(
        api_key=settings.openai_api_key,
        model=model_name,
        base_url=settings.openai_base_url,
        temperature=0.7,
    )


def _build_gemini(requested_model: str | None = None) -> BaseChatModel:
    """Google Gemini API via langchain-google-genai.

    Set GEMINI_API_KEY and optionally GEMINI_MODEL in your .env file.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI

    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. "
            "Set it in backend/.env for gemini mode."
        )

    model_name = requested_model or settings.gemini_model

    logger.info(
        "LLM mode=gemini  model=%s",
        model_name,
    )

    return ChatGoogleGenerativeAI(
        google_api_key=settings.gemini_api_key,
        model=model_name,
        temperature=0.7,
    )
