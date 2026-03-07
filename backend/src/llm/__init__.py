"""
LLM module — factory function ``get_llm()`` returns the right
LangChain chat model based on ``LLM_MODE`` in your .env:

  - **passthrough** (default): OpenAI-compatible endpoint, api-key auth only.
    Uses ``langchain_openai.ChatOpenAI``.
  - **custom**: Proprietary ChatCompletion endpoint with Azure AD
    OAuth2 token. Uses ``GatewayChatModel``.

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


def get_llm() -> BaseChatModel:
    """Return a LangChain chat model configured from environment variables."""
    mode = settings.llm_mode.strip().lower()

    if mode == "passthrough":
        return _build_passthrough()
    elif mode == "custom":
        return _build_custom()
    elif mode == "openai":
        return _build_openai()
    elif mode == "gemini":
        return _build_gemini()
    else:
        raise ValueError(
            f"Unknown LLM_MODE='{settings.llm_mode}'. "
            "Expected 'passthrough', 'custom', 'openai', or 'gemini'."
        )


def _build_passthrough() -> BaseChatModel:
    """Azure OpenAI-compatible endpoint via GenAI gateway.

    URL pattern:
        {base_url}/openai/deployments/{model}/chat/completions?api-version=...

    Auth: Bearer token (OAuth2, auto-refreshed) + api-key header.
    """
    from langchain_openai import AzureChatOpenAI
    from src.llm.auth import TokenManager

    if not settings.llm_api_key:
        raise RuntimeError(
            "LLM_API_KEY is not set. "
            "Set it in backend/.env for passthrough mode."
        )

    # TokenManager caches & auto-refreshes the OAuth2 token
    token_manager = TokenManager()

    logger.info(
        "LLM mode=passthrough  model=%s  base_url=%s",
        settings.llm_model,
        settings.llm_base_url,
    )

    import httpx

    # httpx >= 0.28 dropped the `proxies` kwarg that the openai SDK was
    # passing internally, causing a TypeError.  Supplying a pre-built
    # client bypasses that code path entirely.
    http_client = httpx.Client()
    async_http_client = httpx.AsyncClient()

    return AzureChatOpenAI(
        azure_endpoint=settings.llm_base_url,
        azure_deployment=settings.llm_model,
        api_version="2024-02-01",
        azure_ad_token_provider=token_manager.get_token,
        temperature=1,  # GPT-5 only supports the default value of 1
        default_headers={
            "api-key": settings.llm_api_key,
            "X-UserId": settings.llm_user_id,
        },
        http_client=http_client,
        http_async_client=async_http_client,
    )


def _build_custom() -> BaseChatModel:
    """Proprietary ChatCompletion + Azure AD OAuth2."""
    from src.llm.langchain_wrapper import GatewayChatModel

    logger.info("LLM mode=custom  url=%s", settings.llm_api_url[:80])
    return GatewayChatModel()


def _build_openai() -> BaseChatModel:
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

    logger.info(
        "LLM mode=openai  model=%s  base_url=%s",
        settings.openai_model,
        settings.openai_base_url,
    )

    return ChatOpenAI(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        base_url=settings.openai_base_url,
        temperature=0.7,
    )


def _build_gemini() -> BaseChatModel:
    """Google Gemini API via langchain-google-genai.

    Set GEMINI_API_KEY and optionally GEMINI_MODEL in your .env file.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI

    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. "
            "Set it in backend/.env for gemini mode."
        )

    logger.info(
        "LLM mode=gemini  model=%s",
        settings.gemini_model,
    )

    return ChatGoogleGenerativeAI(
        google_api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        temperature=0.7,
    )
