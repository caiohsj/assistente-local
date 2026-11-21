from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    llama_base_url: str = "http://127.0.0.1:8081/v1"
    llama_api_key: str = "local"
    llama_model: str = "local-qwen3-4b"
    db_path: str = "./data/assistant.sqlite3"
    max_history_messages: int = 12

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
