#!/usr/bin/env python3
"""
Manual smoke-test for the LLM integration.

Verifies each layer independently:
  Step 0 — Config check (env vars loaded?)
  Step 1 — get_llm() factory (does it build a model?)
  Step 2 — LLM invoke (does it return a response?)

Supports both modes:
  passthrough  — OpenAI-compatible endpoint, api-key auth
  custom       — Accenture proprietary ChatCompletion, OAuth2

Usage:
    cd backend
    python -m src.llm.test_llm

Set credentials in backend/.env before running.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

# Ensure the backend root is on sys.path so `from src.…` works
# regardless of how the script is invoked.
_backend_root = str(Path(__file__).resolve().parent.parent.parent)
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)


def _header(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


def test_config() -> bool:
    """Check that required env vars are populated for the active mode."""
    _header("Step 0 — Configuration check")
    from src.config import settings

    mode = settings.llm_mode.strip().lower()
    print(f"  LLM_MODE = {mode}")

    all_ok = True

    if mode == "passthrough":
        checks = {
            "LLM_API_KEY": settings.llm_api_key,
            "LLM_BASE_URL": settings.llm_base_url,
            "LLM_MODEL": settings.llm_model,
            "LLM_TENANT_ID": settings.llm_tenant_id,
            "LLM_CLIENT_ID": settings.llm_client_id,
            "LLM_CLIENT_SECRET": settings.llm_client_secret,
        }
    elif mode == "custom":
        checks = {
            "LLM_TENANT_ID": settings.llm_tenant_id,
            "LLM_CLIENT_ID": settings.llm_client_id,
            "LLM_CLIENT_SECRET": settings.llm_client_secret,
            "LLM_AUTH_SCOPE": settings.llm_auth_scope,
            "LLM_API_URL": settings.llm_api_url,
            "LLM_USER_ID": settings.llm_user_id,
        }
    elif mode == "openai":
        checks = {
            "OPENAI_API_KEY": settings.openai_api_key,
            "OPENAI_MODEL": settings.openai_model,
            "OPENAI_BASE_URL": settings.openai_base_url,
        }
    elif mode == "gemini":
        checks = {
            "GEMINI_API_KEY": settings.gemini_api_key,
            "GEMINI_MODEL": settings.gemini_model,
        }
    else:
        print(f"  ✗ Unknown LLM_MODE='{mode}'")
        return False

    placeholders = {"<your-api-key>", "<your-client-id>", "<your-client-secret>"}
    for name, value in checks.items():
        present = bool(value) and value not in placeholders
        status = "✓" if present else "✗ MISSING"
        display = f"{value[:20]}…" if present and len(value) > 20 else (value if present else "")
        print(f"  {status:12s}  {name:25s}  {display}")
        if not present:
            all_ok = False

    if not all_ok:
        print("\n  ⚠  Some config values are missing — fill them in backend/.env")
    return all_ok


def test_factory() -> object | None:
    """Try to build the LLM via get_llm()."""
    _header("Step 1 — get_llm() factory")
    try:
        from src.llm import get_llm

        t0 = time.time()
        llm = get_llm()
        elapsed = time.time() - t0
        print(f"  ✓ Built {type(llm).__name__} in {elapsed:.2f}s")
        return llm
    except Exception as exc:
        print(f"  ✗ Factory failed: {exc}")
        return None


def test_invoke(llm: object) -> str | None:
    """Send a simple prompt through the LLM."""
    _header("Step 2 — LLM invoke")
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        messages = [
            SystemMessage(content="You are a helpful assistant. Reply in one sentence."),
            HumanMessage(content="Say what's up. roshan"),
        ]

        t0 = time.time()
        result = llm.invoke(messages)
        elapsed = time.time() - t0

        text = result.content if isinstance(result.content, str) else str(result.content)
        print(f"  ✓ Response received in {elapsed:.2f}s")
        print(f"    Response: {text[:200]}")
        return text
    except Exception as exc:
        print(f"  ✗ Invoke failed: {exc}")
        return None


def main() -> None:
    print("=" * 60)
    print("  LLM — Manual Smoke Test")
    print("=" * 60)

    # Step 0: Config
    config_ok = test_config()
    if not config_ok:
        print("\n⚠  Fix the missing config values before proceeding.")
        print("   You can still continue — tests will show specific errors.\n")

    # Step 1: Factory
    llm = test_factory()

    # Step 2: Invoke (only if factory worked)
    response = None
    if llm is not None:
        response = test_invoke(llm)

    # Summary
    _header("Summary")
    results = [
        ("Config", config_ok),
        ("get_llm() factory", llm is not None),
        ("LLM invoke", response is not None),
    ]
    for name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status:10s}  {name}")

    all_passed = all(r[1] for r in results)
    print(f"\n{'  ✓ All tests passed!' if all_passed else '  ✗ Some tests failed.'}")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
