"""HTTP API (JSON). Every route lives under ``/api/``.

Pages
  GET    /api/bootstrap                     app info, settings and the page tree (no contents)
  GET    /api/pages?parent_id=&q=           live pages (summaries), optionally under a parent
  POST   /api/pages                         create {title, parent_id, kind, content | markdown, props, icon, ...}
  GET    /api/pages/{id}                    one page with content, props, rows (database), backlinks, path
  GET    /api/pages/{id}?format=markdown    the page as Markdown (also /api/pages/{id}/markdown)
  POST   /api/pages/{id}                    update {title, icon, cover, content | markdown (+append), props, ...}
  POST   /api/pages/{id}/move               {parent_id, index}
  POST   /api/pages/{id}/duplicate          deep copy next to the original
  POST   /api/pages/{id}/restore            back from the trash
  DELETE /api/pages/{id}                    to the trash (?forever=1 deletes for good)
  GET    /api/pages/{id}/versions           history; GET /api/versions/{vid}; POST /api/versions/{vid}/restore
Databases
  GET    /api/databases/{id}/rows?Prop=value  rows (with their property values), simple equality filters
  POST   /api/databases/{id}/rows            add a row {title, props: {"Name or id": value}, markdown}
  GET    /api/pages/{id}/export.csv
Other
  GET    /api/search?q=                      full-text search
  GET    /api/trash ; POST /api/trash/empty
  POST   /api/templates/{id}/use             {parent_id, title}
  POST   /api/favorites/order                {ids: [...]}
  GET    /api/settings ; POST /api/settings
  POST   /api/files      raw body + X-Carnet-Upload: 1 + X-Filename      -> {url}
  POST   /api/import     raw .zip / .md + X-Carnet-Upload: 1 + X-Filename -> stats
  GET    /api/export.zip?root=
Markdown folders (CARNET_MD_FOLDERS) appear in the tree, pages, search and backlinks with ``readonly: true``;
every write to one of their pages answers 403.
"""
from __future__ import annotations

import json
import re

from . import __version__, markdown as md, transfer
from .mdfolders import MdFolders
from .store import Conflict, Invalid, NotFound, Store

ID = r"([a-z0-9]{4,32})"


class HTTPError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def dumps(obj) -> str:
    # allow_nan=False: a NaN/Infinity must never reach a client as invalid JSON (it raises instead)
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class API:
    def __init__(self, store: Store, app=None, folders: MdFolders | None = None):
        self.s = store
        self.app = app
        self.md = folders if folders else None
        self.routes = []
        r = self.route
        r("GET", "/api/bootstrap", self.bootstrap)
        r("GET", "/api/pages", self.list_pages)
        r("POST", "/api/pages", lambda b, q: self.s.create(b))
        r("GET", f"/api/pages/{ID}", self.get_page)
        r("GET", f"/api/pages/{ID}/markdown", lambda b, q, i: {"id": i, "markdown": self.page_markdown(i)})
        r("POST", f"/api/pages/{ID}", lambda b, q, i: self.s.update(i, b))
        r("POST", f"/api/pages/{ID}/move", lambda b, q, i: self.s.move(i, b.get("parent_id"), b.get("index")))
        r("POST", f"/api/pages/{ID}/duplicate", lambda b, q, i: self.s.duplicate(i))
        r("POST", f"/api/pages/{ID}/restore", lambda b, q, i: self.s.restore(i))
        r("DELETE", f"/api/pages/{ID}", lambda b, q, i: self.s.delete_forever(i) if q.get("forever") else self.s.trash(i))
        r("GET", f"/api/pages/{ID}/versions", lambda b, q, i: {"results": self.s.versions(i)})
        r("GET", r"/api/versions/(\d+)", lambda b, q, v: self.s.version(int(v)))
        r("POST", r"/api/versions/(\d+)/restore", lambda b, q, v: self.s.restore_version(int(v)))
        r("GET", f"/api/databases/{ID}/rows", self.db_rows)
        r("POST", f"/api/databases/{ID}/rows", self.add_row)
        r("GET", "/api/search", self.search)
        r("GET", "/api/trash", lambda b, q: {"results": self.s.trashed()})
        r("POST", "/api/trash/empty", self.empty_trash)
        r("POST", f"/api/templates/{ID}/use", lambda b, q, i: self.s.from_template(i, b.get("parent_id"), b.get("title")))
        r("POST", "/api/favorites/order", lambda b, q: self.s.reorder_favorites(b.get("ids") or []) or {"ok": True})
        r("GET", "/api/settings", lambda b, q: self.s.settings())
        r("POST", "/api/settings", lambda b, q: self.s.set_settings(b))

    def route(self, method, pattern, fn):
        self.routes.append((method, re.compile("^" + pattern + "$"), fn))

    READONLY_WRITE = re.compile(r"^/api/(?:pages|databases|templates)/([a-z0-9]{4,32})(?:/|$)")

    def handle(self, method, path, query, body):
        if method != "GET" and self.md:
            mt = self.READONLY_WRITE.match(path)
            pid = mt.group(1) if mt else None
            if pid and self.md.has(pid) or (isinstance(body, dict) and self.md.has(str(body.get("parent_id") or ""))):
                return 403, {"error": "read-only: this page is a Markdown file, edit the file itself"}
        for m, rx, fn in self.routes:
            if m != method:
                continue
            mt = rx.match(path)
            if mt:
                try:
                    out = fn(body, query, *mt.groups())
                    return (200, out) if out is not None else (204, None)
                except HTTPError as e:
                    return e.status, {"error": e.message}
                except NotFound as e:
                    return 404, {"error": f"not found: {e}"}
                except Conflict as e:
                    return 409, {"error": "this page was changed elsewhere", "page": e.page}
                except Invalid as e:
                    return 400, {"error": str(e)}
                except (ValueError, TypeError, KeyError) as e:
                    return 400, {"error": f"invalid request ({e})"}
        if any(rx.match(path) for _, rx, _ in self.routes):
            return 405, {"error": "method not allowed"}
        return 404, {"error": "not found"}

    # ------------------------------------------------------------------ handlers
    def tree(self):
        return self.s.tree() + (self.md.tree() if self.md else [])

    def bootstrap(self, b, q):
        info = self.app.info() if self.app else {"version": __version__}
        return {"info": info, "settings": self.s.settings(), "tree": self.tree()}

    def list_pages(self, b, q):
        tree = self.tree()
        if "parent_id" in q:
            tree = [p for p in tree if (p["parent_id"] or "") == q["parent_id"]]
        if q.get("q"):
            needle = q["q"].lower()
            tree = [p for p in tree if needle in (p["title"] or "").lower()]
        if q.get("templates"):
            tree = [p for p in tree if p["is_template"]]
        return {"results": tree}

    def get_page(self, b, q, pid):
        if q.get("format") in ("markdown", "md"):
            return {"id": pid, "markdown": self.page_markdown(pid)}
        if self.md and self.md.has(pid):
            return self.md.page(pid, extra_backlinks=self._carnet_backlinks(pid))
        return self.s.page(pid)

    def _carnet_backlinks(self, pid):
        alive = self.s.alive_ids()
        return [self.s.summary(r) for r in self.s.q(
            "SELECT p.* FROM links l JOIN pages p ON p.id = l.src WHERE l.dst=?", (pid,)) if r["id"] in alive]

    def page_markdown(self, pid):
        if self.md and self.md.has(pid):
            return self.md.markdown(pid)
        return transfer.page_markdown(self.s, pid)

    def search(self, b, q):
        limit = int(q.get("limit") or 30)
        res = self.s.search(q.get("q", ""), limit)
        if self.md and q.get("q", "").strip():
            res = (res + self.md.search(q["q"], limit))[:limit]     # Carnet pages first, then Markdown notes
        return {"results": res}

    def db_rows(self, b, q, pid):
        page = self.s.page(pid)
        if page["kind"] != "database":
            raise HTTPError(400, "not a database")
        rows = page["rows"]
        schema = page["schema"]
        for key, val in q.items():
            if key in ("limit", "cursor"):
                continue
            prop = next((p for p in schema["properties"] if p["id"] == key or p["name"].lower() == key.lower()), None)
            if not prop:
                if key.lower() in ("title", schema["title_name"].lower()):
                    rows = [r for r in rows if val.lower() in (r["title"] or "").lower()]
                continue
            rows = [r for r in rows if _matches(prop, r["props"].get(prop["id"]), val)]
        return {"schema": schema, "results": rows}

    def add_row(self, b, q, pid):
        page = self.s._row(pid)
        if page["kind"] != "database":
            raise HTTPError(400, "not a database")
        return self.s.create({**b, "parent_id": pid, "kind": "page"})

    def empty_trash(self, b, q):
        return {"ok": True, "deleted": self.s.empty_trash()}


def _matches(prop, value, wanted: str) -> bool:
    shown = transfer.display_value(prop, value)
    w = wanted.strip().lower()
    if prop["type"] == "checkbox":
        return bool(value) == (w in ("1", "true", "yes", "oui", "x"))
    if prop["type"] == "multi_select":
        return w in [x.strip().lower() for x in shown.split(",")]
    if prop["type"] == "date":
        return (value or {}).get("start", "").startswith(wanted)
    return shown.lower() == w
