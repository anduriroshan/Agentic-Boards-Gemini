import logging
import pandas as pd
from google.cloud import bigquery
from src.config import settings

logger = logging.getLogger(__name__)

class BigQueryManager:
    """Manages connections and queries to Google BigQuery."""

    def __init__(self):
        self.project_id = settings.bigquery_project_id or settings.gcp_project_id
        self._client = None
        self.default_table = settings.bigquery_default_table

    @property
    def client(self) -> bigquery.Client:
        if self._client is None:
            if not self.project_id:
                raise ValueError("GCP Project ID not configured for BigQuery.")
            self._client = bigquery.Client(project=self.project_id)
        return self._client

    def connect(self):
        """Proactively initialize the BigQuery client."""
        _ = self.client
        return self.status

    @property
    def status(self) -> dict:
        """Return the current status of the BigQuery connection."""
        return {
            "connected": self._client is not None,
            "project_id": self.project_id,
            "default_table": self.default_table,
        }

    def list_tables(self, dataset_id: str = None) -> list[str]:
        """List tables in a given dataset or the default one."""
        client = self.client
        if not dataset_id:
            # Try to extract dataset from default_table (project.dataset.table)
            if self.default_table and "." in self.default_table:
                parts = self.default_table.split(".")
                if len(parts) >= 2:
                    dataset_id = parts[-2]
            
        if not dataset_id:
            raise ValueError("No dataset_id provided and could not infer from default_table.")

        tables = client.list_tables(dataset_id)
        return [f"{t.project}.{t.dataset_id}.{t.table_id}" for t in tables]

    def query(self, sql: str) -> list[dict]:
        """Execute a SQL query and return rows as a list of dicts."""
        df = self.query_pandas(sql)
        return df.to_dict(orient="records")

    def query_pandas(self, sql: str) -> pd.DataFrame:
        """Execute a SQL query and return a Pandas DataFrame."""
        logger.info("[BigQuery] Executing query: %s", sql[:200])
        try:
            query_job = self.client.query(sql)
            df = query_job.to_dataframe()
            return df
        except Exception as e:
            logger.error("[BigQuery] Query failed: %s", e)
            raise e

_manager = None

def get_bigquery_manager() -> BigQueryManager:
    global _manager
    if _manager is None:
        _manager = BigQueryManager()
    return _manager
