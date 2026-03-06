from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import Field

# Resolve the .env path relative to *this* file so it works regardless of cwd
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    # ── LLM ───────────────────────────────────────────────────
    # Mode: "passthrough" (OpenAI-compatible, api-key auth)
    #       "custom"      (Accenture proprietary ChatCompletion, OAuth2 token)
    llm_mode: str = Field(default="passthrough")

    # Pass-through mode settings (OpenAI-compatible)
    llm_api_key: str = Field(default="")
    llm_base_url: str = Field(
        default="https://apigatewayazeu.accenture.com/genai/stage/lbpass/",
    )
    llm_model: str = Field(default="gpt-4.1-mini")

    # Custom mode settings (Accenture proprietary endpoint, Azure AD OAuth2)
    llm_tenant_id: str = Field(default="")
    llm_client_id: str = Field(default="")
    llm_client_secret: str = Field(default="")
    llm_auth_scope: str = Field(
        default="api://e053b11b-8480-4abf-9c64-a2e23be62ff5/.default",
    )
    llm_api_url: str = Field(
        default=(
            "https://apigatewayazeu.accenture.com/genai/stage/interaction/api/v1"
            "/Client/7a4a8864-0e44-41a4-9181-b50fbcdfd2bd"
            "/Engine/576E5532-31F4-40A9-B8B0-48EF68553B8C"
            "/Model/9c530a7f-e6d4-411d-adb1-f0d2a3073b7f/ChatCompletion"
        ),
    )
    llm_user_id: str = Field(default="2403")
    llm_system_context: str = Field(
        default=(
            "You are a financial analyst AI assistant specialising in variance analysis. "
            "Provide concise, accurate, and actionable insights based on the financial data provided."
        ),
    )

    # OpenAI direct mode settings  (LLM_MODE=openai)
    openai_api_key: str = Field(default="")
    openai_base_url: str = Field(default="https://api.openai.com/v1")
    openai_model: str = Field(default="gpt-4o-mini")

    # Gemini mode settings  (LLM_MODE=gemini)
    gemini_api_key: str = Field(default="")
    gemini_model: str = Field(default="gemini-2.0-flash")

    # Databricks
    databricks_host: str = Field(default="")
    databricks_http_path: str = Field(default="")
    databricks_token: str = Field(default="")
    databricks_cluster_id: str = Field(default="")
    databricks_catalog: str = Field(default="variance")
    databricks_schema: str = Field(default="analysis_v2")
    databricks_default_table: str = Field(default="variance.analysis_v2.gold_variancesummary_03")
    databricks_index_tables: str = Field(
        default="variance.analysis_v2.gold_variancesummary_03,variance.analysis_v2.coa_hierarchy",
        description="Comma-separated list of tables to index into Milvus",
    )

    # Milvus
    milvus_host: str = Field(default="localhost")
    milvus_port: int = Field(default=19530)
    milvus_enabled: bool = Field(default=False)

    # Cube.js
    cubejs_api_url: str = Field(default="http://localhost:4000/cubejs-api/v1")
    cubejs_api_secret: str = Field(default="")

    # Backend
    backend_port: int = Field(default=8000)
    database_url: str = Field(default="sqlite+aiosqlite:///./agentic_bi.db")

    model_config = {"env_file": str(_ENV_FILE), "env_file_encoding": "utf-8"}


settings = Settings()
