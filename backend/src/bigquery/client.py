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
