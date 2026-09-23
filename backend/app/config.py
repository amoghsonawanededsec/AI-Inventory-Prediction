from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Inventory Intelligence API"
    environment: str = "development"
    database_url: str = "sqlite:///./inventory.db"
    secret_key: str = "change-this-before-production"
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    cors_origins: str = "http://localhost:5173"
    llm_api_key: str | None = None
    llm_model: str = "Llama-V3p2-3b-Reasoning"
    llm_base_url: str = "https://api.nugen.in/api/v3"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def require_production_secret(self):
        if self.environment.lower() in {"production", "prod"} and (len(self.secret_key) < 32 or self.secret_key in {"change-this-before-production", "replace-with-a-long-random-secret"}):
            raise ValueError("Set SECRET_KEY to a unique random value of at least 32 characters in production")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

