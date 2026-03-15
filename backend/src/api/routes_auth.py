import logging
from datetime import datetime, timedelta, timezone
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from authlib.integrations.starlette_client import OAuth
from starlette.config import Config
from src.config import settings
from src.db.session import get_db
from src.db.models import User, Session as DBSession

logger = logging.getLogger(__name__)

router = APIRouter()

# Setup OAuth
# We use Starlette's Config to pass environment variables or dictionary configs
config = Config(environ={
    "GOOGLE_CLIENT_ID": getattr(settings, "google_client_id", ""),
    "GOOGLE_CLIENT_SECRET": getattr(settings, "google_client_secret", "")
})

oauth = OAuth(config)

oauth.register(
    name='google',
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile'
    }
)

def create_session_for_user(db: Session, user: User) -> str:
    """Generate a token and store session in DB."""
    token = secrets.token_urlsafe(32)
    # 7 days expiration for instance
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    
    db_session = DBSession(
        token=token,
        user_id=user.id,
        expires_at=expires_at
    )
    db.add(db_session)
    db.commit()
    return token

@router.get("/auth/google/login")
async def login_google(request: Request):
    """Initiate Google OAuth Flow"""
    if not oauth.google.client_id:
        raise HTTPException(status_code=500, detail="Google OAuth is not configured. Missing client ID.")
    
    # Dynamically determine redirect URI based on how the user is accessing the site
    # request.base_url will correctly reflect the domain (either .run.app or .live)
    base_url = str(request.base_url).rstrip("/")
    
    # Ensure HTTPS for production URLs
    if "localhost" not in base_url and "127.0.0.1" not in base_url:
        base_url = base_url.replace("http://", "https://")
        
    redirect_uri = f"{base_url}/api/auth/google/callback"
    logger.info(f"Initiating Google login with redirect_uri: {redirect_uri}")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/google/callback", name="auth_google_callback")
async def auth_google_callback(request: Request, db: Session = Depends(get_db)):
    """Handle Google OAuth Callback"""
    try:
        token_info = await oauth.google.authorize_access_token(request)
        user_info = token_info.get("userinfo")
        if not user_info:
            raise ValueError("No user info in token")
    except Exception as e:
        logger.error(f"OAuth failed: {e}")
        raise HTTPException(status_code=400, detail="Failed to authenticate via Google")

    google_id = user_info.get("sub")
    email = user_info.get("email")
    name = user_info.get("name")
    picture = user_info.get("picture")

    # Check if user exists
    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        # Check by email fallback (if google ID changed for some reason)
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.google_id = google_id
            db.commit()

    if not user:
        # Create new user
        user = User(
            google_id=google_id,
            email=email,
            name=name,
            picture=picture
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Issue Session Token
    token = create_session_for_user(db, user)

    # Dynamically determine where to redirect back to
    base_url = str(request.base_url).rstrip("/")
    if "localhost" not in base_url and "127.0.0.1" not in base_url:
        base_url = base_url.replace("http://", "https://")
    
    # On localhost, frontend might be on a different port (8001)
    if "localhost" in base_url or "127.0.0.1" in base_url:
        frontend_url = settings.frontend_url or "http://localhost:8001"
    else:
        frontend_url = base_url

    response = RedirectResponse(url=frontend_url)
    
    # Determine if we are running on localhost for cookie flags
    is_localhost = "localhost" in frontend_url or "127.0.0.1" in frontend_url
    
    # Set session token cookie
    cookie_kwargs = {
        "key": "session_token",
        "value": token,
        "httponly": False,
        "max_age": 7 * 24 * 3600,
        "path": "/",
        "samesite": "lax",
        "secure": not is_localhost, # Disable secure flag on localhost (http)
    }
    
    # Only set domain if not on localhost
    if not is_localhost and ".live" in frontend_url:
        cookie_kwargs["domain"] = ".agentic-boards.live"
        
    response.set_cookie(**cookie_kwargs)
    return response

@router.get("/auth/me")
async def get_current_user_info(request: Request, db: Session = Depends(get_db)):
    """Return logged in user info"""
    # Debug logging for cookies
    logger.info(f"Cookies received: {request.cookies}")
    token = request.cookies.get("session_token")
    if not token:
        # Fallback to Authorization Bearer token header if cookie not used
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    db_session = db.query(DBSession).filter(DBSession.token == token).first()
    if not db_session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Check expiration (naive timezone aware comparison)
    if db_session.expires_at and db_session.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user = db_session.user
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "picture": user.picture
    }

@router.post("/auth/logout")
async def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Destroy session"""
    token = request.cookies.get("session_token")
    if token:
        db_session = db.query(DBSession).filter(DBSession.token == token).first()
        if db_session:
            db.delete(db_session)
            db.commit()
    
    # delete cookie
    response.delete_cookie(key="session_token")
    return {"status": "ok"}
