"""
BigQuery REST API routes.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.bigquery.client import get_bigquery_manager

router = APIRouter(prefix="/bigquery", tags=["bigquery"])
logger = logging.getLogger(__name__)

class TableConfigRequest(BaseModel):
    table: str

@router.get("/status")
async def bigquery_status():
    mgr = get_bigquery_manager()
    return mgr.status

@router.post("/connect")
async def bigquery_connect():
    mgr = get_bigquery_manager()
    try:
        return mgr.connect()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/tables")
async def bigquery_list_tables(dataset: Optional[str] = None):
    mgr = get_bigquery_manager()
    try:
        tables = mgr.list_tables(dataset_id=dataset)
        return {"tables": tables}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/table-config")
async def bigquery_update_table(req: TableConfigRequest):
    mgr = get_bigquery_manager()
    mgr.default_table = req.table
    return {
        "message": f"Default table set to {req.table}",
        "default_table": mgr.default_table,
    }
