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

    # HTTP — loopback (Vite) e origens exatas do WebView Tauri. Nunca use `*`.
    cors_origin_regex: str = (
        r"^(?:http://(?:127\.0\.0\.1|localhost):\d+"
        r"|tauri://localhost"
        r"|http://tauri\.localhost)$"
    )

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

    # Abertura de aplicativos e sites (Etapa 3). A família `apps` liga junto com
    # TOOLS_ENABLED; não há chave própria de habilitação.
    tool_open_url_command: str = "xdg-open"
    tool_open_url_domains: str = ""
    tool_open_url_max_chars: int = 2048
    tool_open_app_aliases: str = (
        "terminal=x-terminal-emulator|gnome-terminal|konsole|alacritty|kitty|xterm"
    )
    tool_open_app_deny: str = ""

    # Voz (captura via Web Speech API no frontend). O backend apenas anuncia a
    # disponibilidade e os parâmetros; nenhum áudio trafega por aqui nesta etapa.
    voice_enabled: bool = False
    voice_wake_word: str = "mestre"
    voice_language: str = "pt-BR"

    # STT local (faster-whisper), usado quando a Web Speech API não existe
    # (WebView WebKitGTK do Tauri no Linux). Modelo baixado no primeiro uso.
    voice_stt_model: str = "tiny"
    voice_stt_device: str = "cpu"
    voice_stt_compute_type: str = "int8"
    voice_stt_language: str = "pt"
    voice_max_audio_bytes: int = 10_485_760

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def read_roots_list(self) -> list[str]:
        return [item.strip() for item in self.tool_read_roots.split(",") if item.strip()]

    @property
    def deny_globs_list(self) -> list[str]:
        return [item.strip() for item in self.tool_deny_globs.split(",") if item.strip()]

    @property
    def open_url_domains_list(self) -> list[str]:
        domains: list[str] = []
        for item in self.tool_open_url_domains.split(","):
            domain = item.strip().lower().strip(".")
            if domain:
                domains.append(domain)
        return domains

    @property
    def open_app_deny_list(self) -> list[str]:
        return [item.strip() for item in self.tool_open_app_deny.split(",") if item.strip()]

    @property
    def open_app_aliases_map(self) -> dict[str, list[str]]:
        """Converte `nome=candidato1|candidato2,...` em um mapa."""
        aliases: dict[str, list[str]] = {}
        for item in self.tool_open_app_aliases.split(","):
            entry = item.strip()
            if not entry or "=" not in entry:
                continue
            name, _, raw_candidates = entry.partition("=")
            name = name.strip().casefold()
            candidates = [
                candidate.strip()
                for candidate in raw_candidates.split("|")
                if candidate.strip()
            ]
            if name and candidates:
                aliases[name] = candidates
        return aliases


settings = Settings()
