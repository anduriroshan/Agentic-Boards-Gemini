import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from src.config import settings
from src.db.models import Base

logger = logging.getLogger(__name__)

# Replace aiosqlite with standard sqlite for sync SQLAlchemy engine 
# (simpler for simple auth, unless we want to use async sessionmaker everywhere)
database_url = settings.database_url.replace("sqlite+aiosqlite", "sqlite")

engine = create_engine(
    database_url, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    logger.info("Initializing database tables...")
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
