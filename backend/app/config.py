from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/parking_db"
    
    class Config:
        env_file = ".env"

settings = Settings()
