"""Configuration, read from environment variables (and an optional ``.env`` file).

Every setting has a sensible default: ``python -m carnet`` just works.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_env_file(path: Path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def _bool(v, default=False):
    if v is None or v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on", "oui")


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 8044
    data_dir: Path = field(default_factory=lambda: Path.home() / ".local/share/carnet")
    base_path: str = ""                 # e.g. "/notes" when served behind a reverse proxy sub-path
    password: str = ""                  # web login; empty = no login (trusted network only)
    tokens: list[str] = field(default_factory=list)   # API tokens (Authorization: Bearer ...)
    lang: str = ""                      # "en" / "fr"; empty = browser language
    title: str = "Carnet"
    extra_head: str = ""                # HTML injected in <head> (theme, analytics...)
    extra_body: str = ""                # HTML injected before </body>
    theme: str = ""                     # force "light" / "dark"; empty = user choice
    secure_cookie: bool = False         # set when served over HTTPS
    trust_proxy: bool = False           # read X-Forwarded-For for logs / rate limit
    allowed_hosts: tuple = ()           # extra host names accepted without a password (anti DNS rebinding)
    max_upload_mb: int = 50
    max_import_mb: int = 200            # size of an import (.zip / .md) in one request
    md_folders: str = ""                # "Name=/path;Other=/path": Markdown folders shown read-only
    ai_url: str = ""                    # OpenAI-compatible base URL (".../v1"); empty = no AI
    ai_key: str = ""                    # bearer for ai_url (never sent to the browser)
    ai_model: str = "hermes-agent"
    ai_name: str = "AI"                 # name shown in the UI
    ai_models: str = ""                 # "Label=model;Other=model": models the chat can use (first = default)
    ai_system: str = ""                 # extra system prompt
    ai_timeout: int = 120
    grammar_url: str = ""               # LanguageTool server ("http://127.0.0.1:8081"); empty = no grammar check
    grammar_lang: str = "auto"          # language sent to LanguageTool ("fr", "en-US", "auto"...)
    offline: bool = False               # service worker: read every page offline (HTTPS or localhost only)

    @property
    def ai_model_list(self) -> list[tuple[str, str]]:
        """[(label, upstream model)] offered by the chat; at least the default model."""
        out = []
        for part in self.ai_models.split(";"):
            label, _, model = part.partition("=")
            if label.strip() and model.strip():
                out.append((label.strip(), model.strip()))
        return out or [(self.ai_name, self.ai_model)]

    @property
    def ai_enabled(self) -> bool:
        return bool(self.ai_url)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "carnet.db"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @classmethod
    def from_env(cls, env_file: str | None = None) -> "Config":
        _load_env_file(Path(env_file or os.environ.get("CARNET_ENV_FILE", ".env")))
        e = os.environ.get

        def read(name):
            v = e("CARNET_" + name, "")
            if v.startswith("@"):                     # CARNET_EXTRA_HEAD=@/path/to/file.html
                p = Path(v[1:]).expanduser()
                return p.read_text(encoding="utf-8") if p.is_file() else ""
            return v

        raw_base = e("CARNET_BASE_PATH", "").strip("/")
        return cls(
            host=e("CARNET_HOST", "127.0.0.1"), port=int(e("CARNET_PORT", "8044")),
            data_dir=Path(e("CARNET_DATA_DIR", "") or Path.home() / ".local/share/carnet").expanduser(),
            base_path="/" + raw_base if raw_base else "", password=e("CARNET_PASSWORD", ""),
            tokens=[t.strip() for t in e("CARNET_TOKENS", "").split(",") if t.strip()],
            lang=e("CARNET_LANG", ""), title=e("CARNET_TITLE", "Carnet"),
            extra_head=read("EXTRA_HEAD"), extra_body=read("EXTRA_BODY"), theme=e("CARNET_THEME", ""),
            secure_cookie=_bool(e("CARNET_SECURE_COOKIE")), trust_proxy=_bool(e("CARNET_TRUST_PROXY")),
            allowed_hosts=tuple(h.strip().lower() for h in e("CARNET_ALLOWED_HOSTS", "").split(",") if h.strip()),
            max_upload_mb=int(e("CARNET_MAX_UPLOAD_MB", "50") or 50),
            max_import_mb=int(e("CARNET_MAX_IMPORT_MB", "200") or 200),
            md_folders=e("CARNET_MD_FOLDERS", ""),
            ai_url=e("CARNET_AI_URL", "").strip().rstrip("/"), ai_key=e("CARNET_AI_KEY", "").strip(),
            ai_model=e("CARNET_AI_MODEL", "") or "hermes-agent", ai_name=e("CARNET_AI_NAME", "") or "AI", ai_models=e("CARNET_AI_MODELS", ""),
            ai_system=read("AI_SYSTEM"), ai_timeout=int(e("CARNET_AI_TIMEOUT", "120") or 120),
            grammar_url=e("CARNET_GRAMMAR_URL", "").strip().rstrip("/"), grammar_lang=e("CARNET_GRAMMAR_LANG", "").strip() or "auto",
            offline=_bool(e("CARNET_OFFLINE")),
        )
