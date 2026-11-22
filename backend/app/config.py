from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Modelo local
    llama_base_url: str = "http://127.0.0.1:8081/v1"
    llama_api_key: str = "local"
    llama_model: str = "local-qwen3-4b"
    llm_timeout_seconds: float = 180.0
    temperature: float = 0.6
    max_tokens: int = 900

    # Persistência
    db_path: str = "./data/assistant.sqlite3"
    max_history_messages: int = 12

    # HTTP
    cors_origin_regex: str = r"^http://(127\.0\.0\.1|localhost):\d+$"

    # Ferramentas (Etapa 2). Listas em CSV para facilitar o uso em .env.
    tools_enabled: bool = False
    tool_read_roots: str = ""
    tool_deny_globs: str = (
        ".env,.git/**,.ssh/**,.gnupg/**,*.pem,id_rsa*,node_modules/**,.venv/**"
    )
    tool_max_file_bytes: int = 262_144
    tool_max_entries: int = 200
    tool_max_results: int = 50
    tool_search_timeout_seconds: float = 5.0
    tool_result_max_chars: int = 4000
    agent_max_tool_rounds: int = 4
    agent_max_tool_calls: int = 6
    process_list_default_limit: int = 15
    process_list_max_limit: int = 50
    gpu_query_timeout_seconds: float = 2.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def read_roots_list(self) -> list[str]:
        return [item.strip() for item in self.tool_read_roots.split(",") if item.strip()]

    @property
    def deny_globs_list(self) -> list[str]:
        return [item.strip() for item in self.tool_deny_globs.split(",") if item.strip()]


settings = Settings()
