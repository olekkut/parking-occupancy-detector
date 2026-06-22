from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
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

