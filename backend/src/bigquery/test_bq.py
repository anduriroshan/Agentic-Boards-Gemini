import sys
from pathlib import Path

# Ensure backend root is on sys.path
_backend_root = str(Path(__file__).resolve().parent.parent.parent)
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

import logging
from src.bigquery.client import get_bigquery_manager
from src.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_bq():
    print("=" * 60)
    print("  BigQuery Smoke Test")
    print("=" * 60)
    
    project = settings.bigquery_project_id or settings.gcp_project_id
    table = settings.bigquery_default_table
    
    print(f"  Project: {project}")
    print(f"  Default Table: {table}")
    
    if not project:
        print("  ✗ GCP_PROJECT_ID not set. Skipping.")
        return False
        
    try:
        manager = get_bigquery_manager()
        sql = f"SELECT * FROM `{table}` LIMIT 5"
        print(f"  Executing: {sql}")
        
        df = manager.query_pandas(sql)
        print(f"  ✓ Success! Found {len(df)} rows.")
        if not df.empty:
            print("  Column names:", list(df.columns))
            print("  Sample data:\n", df.head(2))
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False

if __name__ == "__main__":
    success = test_bq()
    sys.exit(0 if success else 1)
