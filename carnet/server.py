"""The HTTP server: JSON API, uploaded files, web app, login. Python standard library only."""
from __future__ import annotations

import gzip
import hashlib
import hmac
import html
import ipaddress
import json
import logging
import mimetypes
import os
import threading
import time
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import __version__, transfer
from .api import API, dumps
from .config import Config
from .mdfolders import MdFolders, parse_spec
from .store import NotFound, Store

log = logging.getLogger("carnet")
STATIC = Path(__file__).parent / "static"
MAX_JSON = 32 * 1024 * 1024
SESSION_DAYS = 90
SAFE_INLINE = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "application/pdf",
               "video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/ogg", "audio/wav", "audio/mp4",
               "audio/flac", "audio/x-wav", "text/plain"}


class App:
    def __init__(self, config: Config, store: Store | None = None):
        self.c = config
        self.store = store or Store(config.db_path)
        self.folders = MdFolders(parse_spec(config.md_folders))
        self.api = API(self.store, self, self.folders)
        # the password is part of the signing key: changing it logs every session out
        self.secret = hashlib.sha256((self.store.secret("session_key") + "\0" + (config.password or "")).encode()).digest()
        self.failures: dict[str, list[float]] = {}
        self.lock = threading.Lock()
        self.assets = self._asset_version()

    def _asset_version(self):
        h = hashlib.sha1(__version__.encode())
        idx = STATIC / "index.html"
        if idx.is_file():
            h.update(idx.read_bytes())
        return h.hexdigest()[:10]

    @property
    def protected(self) -> bool:
        return bool(self.c.password)

    def info(self):
        return {"version": __version__, "title": self.c.title, "base": self.c.base_path, "protected": self.protected,
                "lang": self.c.lang, "theme": self.c.theme, "max_upload_mb": self.c.max_upload_mb, "ai": self.ai_info()}

    def ai_info(self):
        return {"enabled": self.c.ai_enabled, "name": self.c.ai_name}

    # -- sessions: "expiry.signature"
    def make_session(self) -> str:
        exp = str(int(time.time()) + SESSION_DAYS * 86400)
        return exp + "." + hmac.new(self.secret, exp.encode(), hashlib.sha256).hexdigest()

    def check_session(self, value: str) -> bool:
        try:
            exp, sig = value.split(".", 1)
            good = hmac.new(self.secret, exp.encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(sig, good) and int(exp) > time.time()
        except (ValueError, AttributeError):
            return False

    def check_token(self, tok: str) -> bool:
        return any(hmac.compare_digest(tok.encode(), t.encode()) for t in self.c.tokens)

    def rate_limited(self, ip: str) -> bool:
        with self.lock:
            now = time.time()
            hits = [t for t in self.failures.get(ip, []) if now - t < 300]
            self.failures[ip] = hits
            return len(hits) >= 8

    def fail(self, ip):
        with self.lock:
            if len(self.failures) > 5000:
                now = time.time()
                self.failures = {k: v for k, v in self.failures.items() if v and now - v[-1] < 300}
            self.failures.setdefault(ip, []).append(time.time())

    def host_allowed(self, host: str) -> bool:
        """Without a password, only answer to IP addresses, localhost and CARNET_ALLOWED_HOSTS: a malicious web
        page could point its own domain name at this address (DNS rebinding) and read the notes otherwise."""
        if self.protected:
            return True
        name = (host or "").strip().lower()
        if name.startswith("["):
            name = name[1:].split("]")[0]
        elif name.count(":") == 1:
            name = name.rsplit(":", 1)[0]
        if not name or name == "localhost" or name.endswith(".localhost") or name in self.c.allowed_hosts:
            return True
        try:
            ipaddress.ip_address(name)
            return True
        except ValueError:
            return False


class Handler(BaseHTTPRequestHandler):
    server_version = "Carnet"
    protocol_version = "HTTP/1.1"
    app: App = None

    def log_message(self, fmt, *args):
        log.info("%s %s", self.client_ip(), fmt % args)

    def client_ip(self):
        if self.app.c.trust_proxy and self.headers.get("X-Forwarded-For"):
            return self.headers["X-Forwarded-For"].split(",")[0].strip()
        return self.client_address[0]

    def send(self, status, body=b"", ctype="application/json; charset=utf-8", headers=None, cache="no-store"):
        if isinstance(body, str):
            body = body.encode()
        gz = (len(body) > 1400 and "gzip" in (self.headers.get("Accept-Encoding") or "")
              and ctype.split(";")[0] in ("application/json", "text/html", "text/css", "application/javascript",
                                          "text/javascript", "image/svg+xml", "text/markdown", "text/csv"))
        if gz:
            body = gzip.compress(body, 6)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        hdrs = {"Content-Security-Policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
                **(headers or {})}
        for k, v in hdrs.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, status, obj, headers=None):
        if status >= 400 and (self.headers.get("Content-Length") or "0").strip() != "0" and not getattr(self, "_body_read", False):
            self.close_connection = True
            headers = {**(headers or {}), "Connection": "close"}
        if obj is None:
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            return
        self.send(status, dumps(obj), headers=headers)

    def cookie(self, name):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie") or "")
        except cookies.CookieError:
            return None
        return c[name].value if name in c else None

    def read_raw(self, limit):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("bad Content-Length")
        if n < 0 or n > limit:
            raise ValueError("too large" if n > limit else "bad Content-Length")
        raw = self.rfile.read(n) if n else b""
        self._body_read = True
        return raw

    def read_body(self):
        raw = self.read_raw(MAX_JSON)
        if not raw:
            return {}
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("JSON object expected")
        return data

    def auth(self):
        """-> 'open' | 'session' | 'token' | None."""
        h = self.headers.get("Authorization") or ""
        if h.lower().startswith("bearer ") and self.app.check_token(h[7:].strip()):
            return "token"
        if self.app.check_session(self.cookie("carnet_session") or ""):
            return "session"
        if not self.app.protected:
            return "open"
        return None

    # ------------------------------------------------------------------ routing
    def do_HEAD(self):
        self.dispatch("GET")

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("POST")

    def do_PATCH(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        try:
            self._dispatch(method)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log.exception("error on %s %s", method, self.path)
            try:
                self.json(500, {"error": f"internal error ({type(e).__name__})"})
            except Exception:
                pass

    def cross_site(self) -> bool:
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
            return True
        return self.headers.get("Sec-Fetch-Site") == "cross-site"

    def _dispatch(self, method):
        url = urllib.parse.urlsplit(self.path)
        base = self.app.c.base_path
        path = url.path
        if base:
            if path == base:
                return self.send(301, b"", headers={"Location": base + "/"})
            if not path.startswith(base + "/"):
                return self.json(404, {"error": "not found"})
            path = path[len(base):]
        query = {k: v[-1] for k, v in urllib.parse.parse_qs(url.query).items()}

        if path == "/healthz":
            return self.json(200, {"ok": True, "version": __version__})
        if not self.app.host_allowed(self.headers.get("Host", "")):
            log.warning("refused Host %r: add it to CARNET_ALLOWED_HOSTS or set CARNET_PASSWORD", self.headers.get("Host"))
            return self.json(421, {"error": "unknown host name: add it to CARNET_ALLOWED_HOSTS (or set CARNET_PASSWORD)"})
        if path.startswith("/assets/") or path in ("/favicon.svg", "/icon.svg", "/manifest.webmanifest"):
            return self.static(path)
        if path == "/api/login" and method == "POST":
            return self.login()
        if path == "/api/logout" and method == "POST":
            return self.json(200, {"ok": True}, headers={"Set-Cookie": self.session_cookie("", 0)})

        who = self.auth()
        if path.startswith("/files/"):
            if not who:
                return self.json(401, {"error": "unauthorized"})
            return self.serve_file(path)
        if path.startswith("/api/"):
            if not who:
                return self.json(401, {"error": "unauthorized"})
            if method in ("POST", "DELETE") and who in ("session", "open"):
                # browser-reachable (cookie or no password): refuse what another web site can make the browser send.
                # Forms can't send JSON or custom headers, and browsers mark cross-site requests.
                if self.cross_site():
                    return self.json(403, {"error": "cross-site request refused"})
                ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                upload = path in ("/api/files", "/api/import") and self.headers.get("X-Carnet-Upload") == "1"
                if not upload and ctype in ("application/x-www-form-urlencoded", "multipart/form-data", "text/plain"):
                    return self.json(415, {"error": "JSON required"})
            if path == "/api/files" and method == "POST":
                return self.upload()
            if path == "/api/import" and method == "POST":
                return self.import_upload(query)
            if path == "/api/export.zip" and method == "GET":
                data = transfer.export_zip(self.app.store, self.app.c.files_dir, query.get("root") or None)
                return self.send(200, data, ctype="application/zip",
                                 headers={"Content-Disposition": 'attachment; filename="carnet-export.zip"'})
            if path.startswith("/api/pages/") and path.endswith("/export.md") and method == "GET":
                pid = path.split("/")[3]
                try:
                    text = self.app.api.page_markdown(pid)
                    title = self.app.store.page(pid, with_rows=False)["title"] or "Untitled"
                except NotFound:
                    return self.json(404, {"error": "not found"})
                return self.send(200, text, ctype="text/markdown; charset=utf-8", headers={
                    "Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(title + ".md")})
            if path.startswith("/api/pages/") and path.endswith("/export.csv") and method == "GET":
                pid = path.split("/")[3]
                try:
                    text = transfer.database_csv(self.app.store, pid)
                    title = self.app.store.page(pid, with_rows=False)["title"] or "Database"
                except (NotFound, KeyError):
                    return self.json(404, {"error": "not found"})
                return self.send(200, "\ufeff" + text, ctype="text/csv; charset=utf-8", headers={
                    "Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(title + ".csv")})
            body = {}
            if method in ("POST", "DELETE"):
                try:
                    body = self.read_body()
                except (ValueError, UnicodeDecodeError) as e:
                    return self.json(400, {"error": f"invalid body ({e})"})
            status, out = self.app.api.handle(method, path, query, body)
            return self.json(status, out)

        if method != "GET":
            return self.json(405, {"error": "method not allowed"})
        return self.page(logged_in=bool(who))

    # ------------------------------------------------------------------ uploads & files
    def upload(self):
        name = urllib.parse.unquote(self.headers.get("X-Filename") or "file")
        try:
            data = self.read_raw(self.app.c.max_upload_mb * 1024 * 1024)
        except ValueError as e:
            return self.json(413 if "large" in str(e) else 400, {"error": f"upload refused ({e})"})
        mime = (self.headers.get("Content-Type") or "").split(";")[0].strip() or None
        if mime in ("application/octet-stream", ""):
            mime = None
        url = transfer.save_file(self.app.store, self.app.c.files_dir, name, data, mime,
                                 self.headers.get("X-Page-Id") or None)
        return self.json(200, {"url": url, "name": name, "size": len(data)})

    def import_upload(self, query):
        name = urllib.parse.unquote(self.headers.get("X-Filename") or "import.zip")
        try:
            data = self.read_raw(max(self.app.c.max_upload_mb, 200) * 1024 * 1024)
        except ValueError as e:
            return self.json(413 if "large" in str(e) else 400, {"error": f"import refused ({e})"})
        try:
            stats = transfer.import_upload(self.app.store, self.app.c.files_dir, name, data,
                                           query.get("parent_id") or None, query.get("databases", "1") != "0")
        except (ValueError, OSError) as e:
            return self.json(400, {"error": str(e)})
        except Exception as e:                        # a corrupt zip
            log.exception("import failed")
            return self.json(400, {"error": f"import failed ({type(e).__name__})"})
        return self.json(200, stats)

    def serve_file(self, path):
        parts = path.split("/")
        fid = parts[2] if len(parts) > 2 else ""
        try:
            f = self.app.store.file(fid)
        except NotFound:
            return self.json(404, {"error": "not found"})
        p = self.app.c.files_dir / fid
        if not fid.isalnum() or not p.is_file():
            return self.json(404, {"error": "not found"})
        mime = f["mime"] or "application/octet-stream"
        inline = mime in SAFE_INLINE
        disp = ("inline" if inline else "attachment") + "; filename*=UTF-8''" + urllib.parse.quote(f["name"])
        # uploaded HTML/SVG never runs as this site: served as a download inside a sandbox
        self.send(200, p.read_bytes(), ctype=mime if inline else "application/octet-stream",
                  cache="private, max-age=31536000, immutable",
                  headers={"Content-Disposition": disp, "Content-Security-Policy": "sandbox; default-src 'none'; "
                           "img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"})

    # ------------------------------------------------------------------ pages
    def page(self, logged_in=True):
        c = self.app.c
        idx = STATIC / "index.html"
        if not idx.is_file():
            return self.send(503, "<h1>Carnet: the web app is not built</h1><p>Run <code>cd web && npm ci && "
                             "npm run build</code>.</p>", ctype="text/html; charset=utf-8")
        raw = idx.read_text(encoding="utf-8")
        boot = {"base": c.base_path, "protected": self.app.protected, "loggedIn": logged_in, "version": __version__,
                "title": c.title, "lang": c.lang, "theme": c.theme, "maxUploadMb": c.max_upload_mb,
                "ai": self.app.ai_info()}
        raw = (raw.replace("<!--BASE-->", f'<base href="{html.escape(c.base_path)}/">')
                  .replace("{{TITLE}}", html.escape(c.title))
                  .replace("{{BOOT}}", json.dumps(boot).replace("<", "\\u003c"))
                  .replace("<!--EXTRA_HEAD-->", c.extra_head)
                  .replace("<!--EXTRA_BODY-->", c.extra_body))
        self.send(200, raw, ctype="text/html; charset=utf-8", cache="no-cache")

    def static(self, path):
        c = self.app.c
        if path == "/manifest.webmanifest":
            m = {"name": c.title, "short_name": c.title, "start_url": f"{c.base_path}/", "scope": f"{c.base_path}/",
                 "display": "standalone", "background_color": "#191919", "theme_color": "#191919",
                 "icons": [{"src": f"{c.base_path}/icon.svg", "sizes": "any", "type": "image/svg+xml",
                            "purpose": "any maskable"}]}
            return self.send(200, json.dumps(m), ctype="application/manifest+json", cache="no-cache")
        name = "icon.svg" if path == "/favicon.svg" else path.lstrip("/")
        f = (STATIC / name).resolve()
        if not str(f).startswith(str(STATIC.resolve()) + os.sep) or not f.is_file():
            return self.json(404, {"error": "not found"})
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix == ".js":
            ctype = "text/javascript"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        cache = "public, max-age=31536000, immutable" if path.startswith("/assets/") else "no-cache"
        self.send(200, f.read_bytes(), ctype=ctype, cache=cache)

    def session_cookie(self, value, max_age):
        c = self.app.c
        parts = [f"carnet_session={value}", f"Path={c.base_path or '/'}", f"Max-Age={max_age}", "HttpOnly",
                 "SameSite=Strict"]
        if c.secure_cookie:
            parts.append("Secure")
        return "; ".join(parts)

    def login(self):
        ip = self.client_ip()
        if self.app.rate_limited(ip):
            return self.json(429, {"error": "too many attempts, wait 5 minutes"})
        if self.cross_site():
            return self.json(403, {"error": "cross-site request refused"})
        try:
            body = self.read_body()
        except ValueError:
            return self.json(400, {"error": "invalid body"})
        if not self.app.protected:
            return self.json(200, {"ok": True})
        if not hmac.compare_digest(str(body.get("password") or "").encode(), self.app.c.password.encode()):
            self.app.fail(ip)
            time.sleep(0.6)
            return self.json(401, {"error": "wrong password"})
        return self.json(200, {"ok": True},
                         headers={"Set-Cookie": self.session_cookie(self.app.make_session(), SESSION_DAYS * 86400)})


def _janitor(store: Store):
    while True:
        try:
            n = store.purge_trash()
            if n:
                log.info("trash: %d page(s) older than 30 days deleted", n)
        except Exception:
            log.exception("trash purge failed")
        time.sleep(6 * 3600)


def make_app(config: Config) -> App:
    os.umask(0o077)                     # the database, its WAL files and uploads: owner only
    app = App(config)
    for f in Path(config.data_dir).glob("carnet.db*"):
        f.chmod(0o600)
    return app


def serve(config: Config):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if config.password == "change-me":
        raise SystemExit("CARNET_PASSWORD is still 'change-me' (from .env.example): pick your own password in .env.")
    app = make_app(config)
    threading.Thread(target=_janitor, args=(app.store,), daemon=True).start()
    handler = type("BoundHandler", (Handler,), {"app": app})
    httpd = ThreadingHTTPServer((config.host, config.port), handler)
    httpd.daemon_threads = True
    mode = "password" if app.protected else "open (no login - keep it on a trusted network)"
    if not app.protected and config.host not in ("127.0.0.1", "localhost", "::1"):
        log.warning("No CARNET_PASSWORD is set and Carnet listens on %s: anyone who can reach this port can read "
                    "and change your notes. Set CARNET_PASSWORD unless the network is trusted.", config.host)
    log.info("Carnet %s on http://%s:%s%s/  data=%s  auth=%s", __version__, config.host, config.port,
             config.base_path, config.data_dir, mode)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def make_server(config: Config, port: int = 0):
    """A server on a free port, for tests: returns (httpd, app)."""
    app = make_app(config)
    handler = type("BoundHandler", (Handler,), {"app": app})
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    httpd.daemon_threads = True
    return httpd, app
