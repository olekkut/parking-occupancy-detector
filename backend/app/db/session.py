from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from typing import AsyncGenerator
from backend.app.config import settings

# Tworzenie asynchronicznego silnika bazy danych
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=True,  # Ustawienie True loguje wszystkie zapytania SQL - bardzo pomocne przy dewelopmencie i prezentacji
    future=True
)

# Fabryka asynchronicznych sesji
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Asynchroniczny generator sesji (używany jako dependency w FastAPI)
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
