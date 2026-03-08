import logging
from typing import List, Any, Dict
from datetime import datetime, timezone
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.db.session import get_db
from src.db.models import SavedWorkspace, Session as DBSession, User

logger = logging.getLogger(__name__)

router = APIRouter()

# Dependency to get current user from token
async def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    db_session = db.query(DBSession).filter(DBSession.token == token).first()
    if not db_session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    if db_session.expires_at and db_session.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    return db_session.user


class WorkspaceSavePayload(BaseModel):
    id: str  # Frontend generated UUID
    name: str
    dashboard: Dict[str, Any]
    chat: Dict[str, Any]
    tileCount: int
    savedAt: int

@router.get("/workspaces")
async def list_workspaces(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all saved workspaces for the authenticated user."""
    workspaces = db.query(SavedWorkspace).filter(SavedWorkspace.user_id == current_user.id).all()
    
    # Return exactly matching the SavedSession interface from the frontend
    results = []
    for w in workspaces:
        try:
            state = json.loads(w.state_json)
            # Ensure shape matches exactly what listSessions() used to return
            results.append({
                "id": w.id,
                "name": w.name,
                "dashboard": state.get("dashboard", {"tiles": []}),
                "chat": state.get("chat", {"messages": [], "sessionId": None}),
                "tileCount": state.get("tileCount", 0),
                "savedAt": int(w.created_at.timestamp() * 1000)
            })
        except Exception as e:
            logger.error(f"Failed to parse workspace {w.id}: {e}")
            continue
            
    # Sort descending by savedAt
    results.sort(key=lambda x: x["savedAt"], reverse=True)
    return results

@router.post("/workspaces")
async def save_workspace(payload: WorkspaceSavePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create or update a saved workspace for the user."""
    # Serialize the dynamic stuff dict
    state_json = json.dumps({
        "dashboard": payload.dashboard,
        "chat": payload.chat,
        "tileCount": payload.tileCount
    })
    
    workspace = db.query(SavedWorkspace).filter(
        SavedWorkspace.id == payload.id, 
        SavedWorkspace.user_id == current_user.id
    ).first()
    
    if workspace:
        # Update existing
        workspace.name = payload.name
        workspace.state_json = state_json
    else:
        # Create new
        workspace = SavedWorkspace(
            id=payload.id,
            user_id=current_user.id,
            name=payload.name,
            state_json=state_json
        )
        db.add(workspace)
        
    db.commit()
    return {"status": "ok"}

@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete a workspace."""
    workspace = db.query(SavedWorkspace).filter(
        SavedWorkspace.id == workspace_id, 
        SavedWorkspace.user_id == current_user.id
    ).first()
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found or access denied")
        
    db.delete(workspace)
    db.commit()
    return {"status": "deleted"}
