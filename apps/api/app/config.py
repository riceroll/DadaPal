from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "local"
    api_cors_origins: str = "http://localhost:5173"
    database_url: str = "postgresql+psycopg://dadapal:dadapal@localhost:5432/dadapal"
    openrouter_api_key: str = ""
    openrouter_model: str = "openrouter/auto"
    openrouter_fallback_model: str = "google/gemini-2.5-flash"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()