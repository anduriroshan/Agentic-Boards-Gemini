"""
Token management for the GenAI Gateway.

Uses Azure AD client-credentials flow via direct HTTP POST (no MSAL dependency).
Tokens are cached in memory and auto-refreshed 60 s before expiry.
"""

from __future__ import annotations

import logging
import time
from typing import Optional, Tuple

import requests

from src.config import settings

logger = logging.getLogger(__name__)

_AUTH_URL_TEMPLATE = (
    "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
)
_TOKEN_REFRESH_BUFFER_SECONDS = 60


class TokenManager:
    """Manages OAuth2 client-credentials tokens for the GenAI gateway.

    Token lifecycle:
        - Obtained via Azure AD client-credentials (application) flow.
        - Cached in memory and auto-refreshed when near expiry.
    """

    def __init__(self) -> None:
        self._access_token: Optional[str] = None
        self._token_expiry: float = 0.0  # epoch seconds

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def get_token(self) -> str:
        """Return a valid Bearer token, refreshing if expired or near expiry."""
        now = time.time()
        if self._access_token and now < (
            self._token_expiry - _TOKEN_REFRESH_BUFFER_SECONDS
        ):
            logger.debug("Using cached access token")
            return self._access_token

        logger.info("Fetching new access token from Azure AD …")
        self._access_token, self._token_expiry = self._fetch_token()
        logger.info("Access token obtained successfully")
        return self._access_token

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _fetch_token() -> Tuple[str, float]:
        """POST to the Azure AD token endpoint and return (token, expiry_epoch).

        Raises ``RuntimeError`` if credentials are missing or the request fails.
        """
        tenant_id = settings.llm_tenant_id
        client_id = settings.llm_client_id
        client_secret = settings.llm_client_secret
        scope = settings.llm_auth_scope

        if not all([tenant_id, client_id, client_secret]):
            raise RuntimeError(
                "Missing LLM auth credentials. "
                "Set LLM_TENANT_ID, LLM_CLIENT_ID, LLM_CLIENT_SECRET in your .env file."
            )

        auth_url = _AUTH_URL_TEMPLATE.format(tenant_id=tenant_id)

        data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope,
        }

        resp = requests.post(auth_url, data=data, timeout=30)

        if not resp.ok:
            raise RuntimeError(
                f"Token endpoint returned {resp.status_code}: {resp.text[:300]}"
            )

        token_data = resp.json()
        access_token = token_data.get("access_token")
        expires_in = int(token_data.get("expires_in", 3600))

        if not access_token:
            raise RuntimeError(f"No access_token in response: {token_data}")

        expiry_epoch = time.time() + expires_in
        return access_token, expiry_epoch
