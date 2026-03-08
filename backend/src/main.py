import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from src.api.routes_health import router as health_router
from src.api.routes_chat import router as chat_router
from src.api.routes_databricks import router as databricks_router
from src.api.routes_charts import router as charts_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

app = FastAPI(title="Agentic Boards", version="0.1.0")

# Trust Cloudflare Tunnel headers (X-Forwarded-For, X-Forwarded-Proto, etc.)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://localhost:3000",
        "https://agentic-boards.live"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from starlette.middleware.sessions import SessionMiddleware
from src.api.routes_auth import router as auth_router
from src.api.routes_workspace import router as workspace_router
from src.db.session import init_db

# Starlette session middleware is strictly required by Authlib for OAuth callback state tracking
app.add_middleware(SessionMiddleware, secret_key="REPLACE_WITH_SECURE_SECRET_IN_PROD")

app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(databricks_router, prefix="/api")
app.include_router(charts_router, prefix="/api")
app.include_router(workspace_router, prefix="/api")

# Serve frontend static files
frontend_path = os.path.join(os.getcwd(), "frontend_dist")
if os.path.exists(frontend_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_path, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api"):
            return None # Should be handled by routers
        
        file_path = os.path.join(frontend_path, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_path, "index.html"))


def _load_embeddings():
    try:
        from src.metadata.embeddings import embed_query
        embed_query("warmup")
        logging.getLogger(__name__).info("Embedding model pre-warmed.")
    except Exception as e:
        logging.getLogger(__name__).warning("Embedding pre-warm failed: %s", e)


@app.on_event("startup")
async def _startup():
    """Pre-warm the embedding model so the first query is fast and init DB."""
    init_db()
    
    import asyncio
    import concurrent.futures
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        await loop.run_in_executor(pool, _load_embeddings)
