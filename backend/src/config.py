from pathlib import Path
import os

from pydantic_settings import BaseSettings
from pydantic import Field

# Resolve the .env path relative to *this* file so it works regardless of cwd
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    # ── Google OAuth ──────────────────────────────────────────
    google_client_id: str = Field(default="")
    google_client_secret: str = Field(default="")
    google_redirect_uri: str = Field(default="")
    frontend_url: str = Field(default="http://localhost:8001")
    
    # ── LLM ───────────────────────────────────────────────────
    # Mode: "openai" or "gemini"
    llm_mode: str = Field(default="gemini")

    # OpenAI direct mode settings  (LLM_MODE=openai)
    openai_api_key: str = Field(default="")
    openai_base_url: str = Field(default="https://api.openai.com/v1")
    openai_model: str = Field(default="gpt-4o-mini")

    # Gemini mode settings  (LLM_MODE=gemini)
    gemini_api_key: str = Field(default="")
    gemini_model: str = Field(default="gemini-2.0-flash")

    # ── Vertex AI / Google Cloud ──────────────────────────────
    gcp_project_id: str = Field(default="", description="Google Cloud Project ID")
    gcp_region: str = Field(default="us-central1", description="Vertex AI Region")
    google_application_credentials: str = Field(
        default="", 
        description="Path to GCP service account JSON key (optional if running on GCP)"
    )

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

    # BigQuery
    bigquery_project_id: str = Field(default="", description="GCP Project ID for BigQuery")
    bigquery_default_table: str = Field(
        default="agentic-boards.iowa_liquor_retail_sales.sales",
        description="Default BigQuery table for the agent to use"
    )

    # Milvus / Zilliz Cloud
    milvus_uri: str = Field(
        default="./data/milvus_data.db",
        description="Connect URI. Use a local file path for Milvus Lite (FREE), or Zilliz Cloud URL."
    )
    milvus_token: str = Field(
        default="",
        description="API key/token for Zilliz Cloud. Leave empty for local Milvus Lite."
    )
    milvus_enabled: bool = Field(default=True)

    # Cube.js
    cubejs_api_url: str = Field(default="http://localhost:4000/cubejs-api/v1")
    cubejs_api_secret: str = Field(default="")

    # Backend
    backend_port: int = Field(default=8000)
    database_url: str = Field(default="sqlite+aiosqlite:///./data/agentic_bi.db")

    model_config = {
        "env_file": str(_ENV_FILE),
        "env_file_encoding": "utf-8",
        "extra": "ignore"
    }


settings = Settings()

# ── Global Vertex AI Environment Setup ──
# Set these globally to ensure all SDKs (genai, aiplatform, bigquery) 
# use the same Vertex AI context and credentials.
if settings.gcp_project_id:
    os.environ["GOOGLE_CLOUD_PROJECT"] = settings.gcp_project_id
    os.environ["GOOGLE_CLOUD_LOCATION"] = settings.gcp_region
    # Force the service account path if it exists
    sa_path = os.path.join(os.getcwd(), "service_account.json")
    if os.path.exists(sa_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path

# Remove API keys to prevent SDKs from falling back to Gemini API (AI Studio)
# which causes authentication conflicts with Vertex AI.
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GOOGLE_API_KEY", None)
