"""
Gateway GenAI ChatCompletion client.

Provides both sync and async interfaces to the gateway.  Uses direct
``requests`` for the sync path and ``httpx`` for the async path.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import requests
import time
import asyncio

from src.config import settings
from src.llm.auth import TokenManager

logger = logging.getLogger(__name__)


class GatewayGenAIClient:
    """Low-level HTTP client for the Gateway GenAI ChatCompletion endpoint.

    Uses ``LLM_API_URL`` directly — no URL assembly required.
    """

    def __init__(self) -> None:
        self.token_manager = TokenManager()
        self.api_url: str = settings.llm_api_url
        self.user_id: str = settings.llm_user_id
        self.system_context: str = settings.llm_system_context

    # ------------------------------------------------------------------
    # Sync
    # ------------------------------------------------------------------

    def chat_sync(
        self,
        question: str,
        *,
        system_prompt: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        examples: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """Call the GenAI ChatCompletion API synchronously.

        Args:
            question:      The user question / instruction for the LLM.
            system_prompt: Override for the default system context.
            context:       Optional dict with financial metrics to enrich the prompt.
            examples:      Few-shot examples (``[{user_input, ai_output}]``).

        Returns:
            LLM response text.
        """
        token = self.token_manager.get_token()

        full_question = self._build_prompt(question, context)

        payload = {
            "context": system_prompt or self.system_context,
            "question": full_question,
            "callbackurl": "",
            "example": examples or [
                {
                    "user_input": "What is the main driver of the revenue variance?",
                    "ai_output": (
                        "The primary driver of the revenue variance is the change in "
                        "sales volume relative to the prior period."
                    ),
                }
            ],
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "X-UserId": self.user_id,
        }

        max_retries = 3
        for attempt in range(max_retries):
            logger.info("POST %s … (Attempt %d/%d)", self.api_url[:80], attempt + 1, max_retries)
            resp = requests.post(self.api_url, headers=headers, json=payload, timeout=120)

            if resp.status_code in (502, 503, 504) and attempt < max_retries - 1:
                logger.warning("GenAI API returned %s. Retrying in %ds...", resp.status_code, 2 ** attempt)
                time.sleep(2 ** attempt)
                continue

            if not resp.ok:
                raise RuntimeError(
                    f"GenAI API returned {resp.status_code}: {resp.text[:500]}"
                )

            return self._extract_answer(resp.json())
        
        raise RuntimeError("GenAI API failed after max retries")

    # ------------------------------------------------------------------
    # Async (used by the LangChain wrapper)
    # ------------------------------------------------------------------

    async def chat(
        self,
        system_prompt: str,
        user_message: str,
        examples: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """Async version for the LangChain wrapper."""
        import httpx  # noqa: E402  — optional dep, only needed for async path

        token = self.token_manager.get_token()

        payload = {
            "context": system_prompt,
            "question": user_message,
            "callbackurl": "",
            "example": examples or [],
        }

        headers = {
            "Authorization": f"Bearer {token}",
            "X-UserId": self.user_id,
            "Content-Type": "application/json",
        }

        max_retries = 3
        async with httpx.AsyncClient(timeout=120.0) as client:
            for attempt in range(max_retries):
                resp = await client.post(self.api_url, json=payload, headers=headers)
                
                if resp.status_code in (502, 503, 504) and attempt < max_retries - 1:
                    logger.warning("GenAI API returned %s. Retrying in %ds...", resp.status_code, 2 ** attempt)
                    await asyncio.sleep(2 ** attempt)
                    continue
                    
                resp.raise_for_status()
                return self._extract_answer(resp.json())
        
        raise RuntimeError("GenAI API failed after max retries")

    # ------------------------------------------------------------------
    # Prompt builder (financial context enrichment)
    # ------------------------------------------------------------------

    @staticmethod
    def _build_prompt(
        prompt: str, context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Enrich the base prompt with key financial metrics from context."""
        if not context:
            return prompt

        lines = [prompt, "", "--- Financial Context ---"]
        field_labels = {
            "total_variance": "Total Variance",
            "top_entity": "Top Entity by Variance",
            "top_coa": "Top COA Hierarchy",
            "variance_count": "Number of Variance Records",
            "top_contributor_pct": "Top Contributor % of Parent",
        }
        for key, label in field_labels.items():
            if key in context:
                value = context[key]
                if isinstance(value, float):
                    lines.append(f"  {label}: {value:,.2f}")
                else:
                    lines.append(f"  {label}: {value}")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Response parser
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_answer(data: Any) -> str:
        """Pull the answer text from the API response."""
        if isinstance(data, str):
            return data
        if isinstance(data, dict):
            for key in ("answer", "response", "output", "result", "text", "content"):
                if key in data and data[key]:
                    return str(data[key])
        # Fallback: return full JSON so nothing is silently lost
        return str(data)
