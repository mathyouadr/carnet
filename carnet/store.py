"""SQLite storage: pages (documents, databases, database rows), versions, files, settings.

Everything is a *page*:

* ``kind='page'``      a document; ``content`` holds BlockNote blocks (JSON list)
* ``kind='database'``  a collection; ``schema`` lists its properties, ``views`` its views
* a page whose parent is a database is a *row*: ``props`` holds its property values

Pages nest without limit (``parent_id``). Trashing a page hides its whole subtree;
it is purged for good after ``TRASH_DAYS``.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import secrets
import sqlite3
import string
import threading
from pathlib import Path

from . import markdown as md

TRASH_DAYS = 30
VERSION_WINDOW = 10 * 60          # one history entry per 10 minutes of editing
MAX_VERSIONS = 200
ALPHABET = string.ascii_lowercase + string.digits

PROP_TYPES = ("text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email",
              "phone", "relation", "created_time", "edited_time")
VIEW_TYPES = ("table", "board", "list", "gallery", "calendar")
COLORS = ("default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red")

SCHEMA = """
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'page',
    title TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '[]',
    props TEXT NOT NULL DEFAULT '{}',
    schema TEXT NOT NULL DEFAULT '{}',
    views TEXT NOT NULL DEFAULT '[]',
    options TEXT NOT NULL DEFAULT '{}',
    position REAL NOT NULL DEFAULT 0,
    favorite REAL,
    is_template INTEGER NOT NULL DEFAULT 0,
    inline INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL DEFAULT '',
    rev INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    trashed_at TEXT
);
CREATE INDEX IF NOT EXISTS pages_parent ON pages(parent_id, position);
CREATE TABLE IF NOT EXISTS links (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst));
CREATE INDEX IF NOT EXISTS links_dst ON links(dst);
CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS versions_page ON versions(page_id, id);
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    page_id TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


class Conflict(Exception):
    def __init__(self, page):
        super().__init__("page changed elsewhere")
        self.page = page


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


def new_id(n=12) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def _loads(s, default):
    try:
        v = json.loads(s) if s else default
    except (ValueError, TypeError):
        return default
    return v if isinstance(v, type(default)) else default


def _parse_ts(s):
    return dt.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)


SUMMARY = ("id", "parent_id", "kind", "title", "icon", "position", "favorite", "is_template", "inline",
           "updated_at", "created_at")


class Store:
    def __init__(self, path: str | Path):
        self.db_file = str(path)
        if self.db_file != ":memory:":
            Path(self.db_file).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.db_file, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA foreign_keys=OFF")
            self.db.executescript(SCHEMA)
            try:
                self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, title, body, "
                                "tokenize='unicode61 remove_diacritics 2')")
                self.fts = True
            except sqlite3.OperationalError:          # SQLite built without FTS5: fall back to LIKE
                self.fts = False

    def close(self):
        with self.lock:
            self.db.close()

    # ------------------------------------------------------------------ low level
    def q(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def q1(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchone()

    def x(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args)

    def tx(self):
        return _Tx(self)

    def secret(self, key: str) -> str:
        row = self.q1("SELECT value FROM settings WHERE key=?", ("secret:" + key,))
        if row:
            return row["value"]
        v = secrets.token_urlsafe(32)
        self.x("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", ("secret:" + key, v))
        return self.q1("SELECT value FROM settings WHERE key=?", ("secret:" + key,))["value"]

    def settings(self) -> dict:
        return {r["key"]: _loads(r["value"], None) if r["value"][:1] in "[{\"tfn0123456789-" else r["value"]
                for r in self.q("SELECT key, value FROM settings WHERE key NOT LIKE 'secret:%'")}

    def set_settings(self, values: dict):
        for k, v in values.items():
            if not isinstance(k, str) or k.startswith("secret:") or len(k) > 64:
                raise Invalid("invalid setting")
            self.x("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (k, json.dumps(v)))
        return self.settings()

    # ------------------------------------------------------------------ reading
    def _row(self, pid):
        row = self.q1("SELECT * FROM pages WHERE id=?", (pid,))
        if not row:
            raise NotFound(pid)
        return row

    def resolve_title(self, title):
        """Page id for a ``[[Title]]`` written through the API (live pages, case-insensitive, most recent first)."""
        t = str(title or "").strip()
        if not t or t.startswith("@link:"):
            return None
        r = self.q1("SELECT id FROM pages WHERE trashed_at IS NULL AND is_template=0 AND lower(title)=lower(?) "
                    "ORDER BY updated_at DESC LIMIT 1", (t,))
        return r["id"] if r else None

    def all_rows(self):
        return self.q("SELECT " + ", ".join(SUMMARY) + ", trashed_at FROM pages ORDER BY position, created_at")

    def alive_ids(self, rows=None) -> set:
        """Ids of pages not in the trash (a page is trashed when it or one of its ancestors is)."""
        rows = rows if rows is not None else self.all_rows()
        by_id = {r["id"]: r for r in rows}
        memo: dict[str, bool] = {}

        def alive(pid, depth=0):
            if pid in memo:
                return memo[pid]
            r = by_id.get(pid)
            if r is None or r["trashed_at"] or depth > 200:
                ok = False
            elif r["parent_id"] is None:
                ok = True
            else:
                ok = alive(r["parent_id"], depth + 1)
            memo[pid] = ok
            return ok

        return {pid for pid in by_id if alive(pid)}

    def tree(self) -> list[dict]:
        """Every live page, without contents: the sidebar, links and search palette are built from it."""
        rows = self.all_rows()
        alive = self.alive_ids(rows)
        kinds = {r["id"]: r["kind"] for r in rows}
        out = []
        for r in rows:
            if r["id"] in alive:
                d = {k: r[k] for k in SUMMARY}
                d["is_row"] = bool(r["parent_id"] and kinds.get(r["parent_id"]) == "database")
                out.append(d)
        return out

    def summary(self, row) -> dict:
        return {k: row[k] for k in SUMMARY}

    def path(self, pid) -> list[dict]:
        out, seen = [], set()
        cur = self.q1("SELECT id, parent_id, title, icon, kind FROM pages WHERE id=?", (pid,))
        while cur and cur["id"] not in seen and len(out) < 50:
            seen.add(cur["id"])
            out.append({"id": cur["id"], "title": cur["title"], "icon": cur["icon"], "kind": cur["kind"]})
            cur = self.q1("SELECT id, parent_id, title, icon, kind FROM pages WHERE id=?", (cur["parent_id"],)) \
                if cur["parent_id"] else None
        return out[::-1]

    def page(self, pid, with_rows=True) -> dict:
        r = self._row(pid)
        d = self.summary(r)
        d.update(cover=r["cover"], content=_loads(r["content"], []), props=_loads(r["props"], {}),
                 options=_loads(r["options"], {}), rev=r["rev"], trashed_at=r["trashed_at"])
        d["path"] = self.path(pid)
        d["in_trash"] = pid not in self.alive_ids() if not r["trashed_at"] else True
        alive = None
        if r["kind"] == "database":
            d["schema"] = self.schema_of(r)
            d["views"] = _loads(r["views"], [])
            if with_rows:
                d["rows"] = self.rows(pid)
        parent = self.q1("SELECT * FROM pages WHERE id=?", (r["parent_id"],)) if r["parent_id"] else None
        if parent is not None and parent["kind"] == "database":
            d["database"] = {"id": parent["id"], "title": parent["title"], "icon": parent["icon"],
                             "schema": self.schema_of(parent)}
        alive = self.alive_ids()
        d["backlinks"] = [self.summary(b) for b in self.q(
            "SELECT p.* FROM links l JOIN pages p ON p.id = l.src WHERE l.dst=? AND l.src<>? ORDER BY p.title",
            (pid, pid)) if b["id"] in alive]
        d["children"] = [dict(self.summary(c)) for c in self.q(
            "SELECT * FROM pages WHERE parent_id=? AND trashed_at IS NULL ORDER BY position, created_at", (pid,))]
        return d

    def schema_of(self, row) -> dict:
        s = _loads(row["schema"], {})
        s.setdefault("title_name", "Name")
        s.setdefault("properties", [])
        return s

    def rows(self, db_id) -> list[dict]:
        out = []
        for r in self.q("SELECT * FROM pages WHERE parent_id=? AND trashed_at IS NULL ORDER BY position, created_at",
                        (db_id,)):
            d = self.summary(r)
            d["props"] = _loads(r["props"], {})
            d["cover"] = r["cover"]
            d["has_content"] = r["text"] != ""
            d["preview"] = r["text"][:240]
            out.append(d)
        return out

    # ------------------------------------------------------------------ writing
    def _next_position(self, parent_id):
        row = self.q1("SELECT MAX(position) AS m FROM pages WHERE parent_id IS ?", (parent_id,))
        return (row["m"] if row and row["m"] is not None else -1) + 1

    def _in_trash(self, pid) -> bool:
        """True when the page or one of its ancestors is in the trash."""
        cur, seen = pid, set()
        while cur and cur not in seen and len(seen) < 200:
            seen.add(cur)
            r = self.q1("SELECT parent_id, trashed_at FROM pages WHERE id=?", (cur,))
            if r is None:
                return False
            if r["trashed_at"]:
                return True
            cur = r["parent_id"]
        return False

    def _check_parent(self, parent_id, pid=None):
        if parent_id is None:
            return None
        p = self._row(parent_id)
        if self._in_trash(parent_id):             # a page there would be invisible: refuse it
            raise Invalid("the parent page is in the trash")
        if pid:                                   # refuse cycles: the new parent can't be inside the page
            cur, seen = p, set()
            while cur is not None:
                if cur["id"] == pid:
                    raise Invalid("a page can't be moved inside itself")
                if cur["id"] in seen:
                    break
                seen.add(cur["id"])
                cur = self.q1("SELECT id, parent_id FROM pages WHERE id=?", (cur["parent_id"],)) \
                    if cur["parent_id"] else None
        return p

    def create(self, data: dict) -> dict:
        kind = data.get("kind") or "page"
        if kind not in ("page", "database"):
            raise Invalid("kind must be page or database")
        parent_id = data.get("parent_id") or None
        parent = self._check_parent(parent_id)
        ts = now()
        pid = data.get("id") if isinstance(data.get("id"), str) and re.fullmatch(r"[a-z0-9]{8,32}", data["id"]) \
            and not self.q1("SELECT 1 FROM pages WHERE id=?", (data["id"],)) else new_id()
        content = data.get("content")
        if content is None and data.get("markdown") is not None:
            content = md.to_blocks(str(data["markdown"]), resolve=self.resolve_title)
        content = self._clean_content(content or [])
        schema = data.get("schema") or {}
        views = data.get("views") or []
        if kind == "database":
            schema = self._clean_schema(schema or {"title_name": data.get("title_name") or "Name", "properties": []})
            views = self._clean_views(views or [{"id": new_id(8), "name": data.get("view_name") or "Table",
                                                 "type": "table"}], schema)
        props = {}
        if parent is not None and parent["kind"] == "database":
            props = self._props_for(parent_id, data.get("props") or {})
        position = data.get("position")
        if not isinstance(position, (int, float)):
            position = self._next_position(parent_id)
        options = data.get("options") if isinstance(data.get("options"), dict) else {}
        with self.tx():
            self.x("INSERT INTO pages(id, parent_id, kind, title, icon, cover, content, props, schema, views, options, "
                   "position, is_template, inline, text, created_at, updated_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (pid, parent_id, kind, str(data.get("title") or "")[:2000], str(data.get("icon") or "")[:200],
                    str(data.get("cover") or "")[:2000], json.dumps(content), json.dumps(props), json.dumps(schema),
                    json.dumps(views), json.dumps(options), position, 1 if data.get("is_template") else 0,
                    1 if data.get("inline") else 0, md.to_text(content), ts, ts))
            self._index(pid)
        return self.page(pid)

    def update(self, pid, data: dict) -> dict:
        # the revision check and the write share one transaction, under the store lock: a save made in between
        # can't be overwritten silently
        with self.tx():
            return self._update(pid, data)

    def _update(self, pid, data: dict) -> dict:
        r = self._row(pid)
        if "rev" in data and data["rev"] is not None and "content" in data and int(data["rev"]) != r["rev"]:
            raise Conflict(self.page(pid))
        sets, args = [], []

        def put(col, val):
            sets.append(f"{col}=?")
            args.append(val)

        for col, limit in (("title", 2000), ("icon", 200), ("cover", 2000)):
            if col in data:
                put(col, str(data[col] or "")[:limit])
        content_changed = False
        if "content" in data or "markdown" in data:
            content = data["content"] if "content" in data else \
                md.to_blocks(str(data.get("markdown") or ""), resolve=self.resolve_title)
            if data.get("append") and "markdown" in data:
                content = _loads(r["content"], []) + content
            content = self._clean_content(content)
            put("content", json.dumps(content))
            put("text", md.to_text(content))
            content_changed = True
        if "props" in data:
            parent = self.q1("SELECT * FROM pages WHERE id=?", (r["parent_id"],)) if r["parent_id"] else None
            if parent is None or parent["kind"] != "database":
                raise Invalid("only database rows have properties")
            merged = {**_loads(r["props"], {}), **(data["props"] or {})} if data.get("merge_props", True) \
                else (data["props"] or {})
            put("props", json.dumps(self._props_for(r["parent_id"], merged)))
        if "schema" in data and r["kind"] == "database":
            put("schema", json.dumps(self._clean_schema(data["schema"])))
        if "views" in data and r["kind"] == "database":
            schema = self._clean_schema(data["schema"]) if "schema" in data else self.schema_of(r)
            put("views", json.dumps(self._clean_views(data["views"], schema)))
        if "options" in data and isinstance(data["options"], dict):
            put("options", json.dumps({**_loads(r["options"], {}), **data["options"]}))
        if "favorite" in data:
            if data["favorite"]:
                m = self.q1("SELECT MAX(favorite) AS m FROM pages")["m"]
                put("favorite", (m or 0) + 1 if not r["favorite"] else r["favorite"])
            else:
                put("favorite", None)
        if "is_template" in data:
            put("is_template", 1 if data["is_template"] else 0)
        if not sets:
            return self.page(pid)
        ts = now()
        put("updated_at", ts)
        sets.append("rev=rev+1")
        with self.tx():
            if content_changed or "title" in data or "props" in data:
                self._snapshot(r)
            self.x(f"UPDATE pages SET {', '.join(sets)} WHERE id=?", (*args, pid))
            self._index(pid)
        return self.page(pid)

    def move(self, pid, parent_id, index=None) -> dict:
        r = self._row(pid)
        parent_id = parent_id or None
        parent = self._check_parent(parent_id, pid)
        if parent is not None and parent["kind"] == "database" and r["kind"] == "database":
            raise Invalid("a database can't be a row of another database")
        siblings = [s["id"] for s in self.q("SELECT id FROM pages WHERE parent_id IS ? AND id<>? "
                                            "ORDER BY position, created_at", (parent_id, pid))]
        index = len(siblings) if index is None else max(0, min(int(index), len(siblings)))
        siblings.insert(index, pid)
        with self.tx():
            for i, sid in enumerate(siblings):
                self.x("UPDATE pages SET position=? WHERE id=?", (i, sid))
            if parent_id != r["parent_id"]:
                self.x("UPDATE pages SET parent_id=?, inline=0, updated_at=? WHERE id=?", (parent_id, now(), pid))
        return self.page(pid)

    def reorder_favorites(self, ids):
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise Invalid("ids must be a list of page ids")
        with self.tx():
            for i, pid in enumerate(ids):
                self.x("UPDATE pages SET favorite=? WHERE id=? AND favorite IS NOT NULL", (i + 1, pid))

    def trash(self, pid) -> dict:
        self._row(pid)
        self.x("UPDATE pages SET trashed_at=? WHERE id=?", (now(), pid))
        return {"ok": True}

    def restore(self, pid) -> dict:
        r = self._row(pid)
        self.x("UPDATE pages SET trashed_at=NULL WHERE id=?", (pid,))
        if r["parent_id"]:
            # keep the parent, unless it is gone or is itself in the trash: then the page goes back to the root
            parent = self.q1("SELECT trashed_at FROM pages WHERE id=?", (r["parent_id"],))
            if parent is None or parent["trashed_at"]:
                self.x("UPDATE pages SET parent_id=NULL, inline=0 WHERE id=?", (pid,))
        return self.page(pid)

    def trashed(self) -> list[dict]:
        out = []
        for r in self.q("SELECT * FROM pages WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC"):
            d = self.summary(r)
            d["trashed_at"] = r["trashed_at"]
            d["path"] = self.path(r["parent_id"]) if r["parent_id"] else []
            out.append(d)
        return out

    def descendants(self, pid) -> list[str]:
        out, todo = [], [pid]
        while todo:
            cur = todo.pop()
            for c in self.q("SELECT id FROM pages WHERE parent_id=?", (cur,)):
                if c["id"] not in out and c["id"] != pid:
                    out.append(c["id"])
                    todo.append(c["id"])
        return out

    def delete_forever(self, pid):
        self._row(pid)
        return {"ok": True, "deleted": self._purge([pid])}

    def _purge(self, roots) -> int:
        """Delete pages and everything under them, in one transaction. A root already removed by an ancestor
        (trashed parent and child) is skipped, so a purge can't stop half way. Returns the number of pages."""
        ids = []
        with self.tx():
            for root in roots:
                if self.q1("SELECT 1 FROM pages WHERE id=?", (root,)) is None:
                    continue
                for i in [root] + self.descendants(root):
                    if i not in ids:
                        ids.append(i)
            for i in ids:
                self.x("DELETE FROM pages WHERE id=?", (i,))
                self.x("DELETE FROM versions WHERE page_id=?", (i,))
                self.x("DELETE FROM links WHERE src=? OR dst=?", (i, i))
                if self.fts:
                    self.x("DELETE FROM search WHERE id=?", (i,))
        return len(ids)

    def empty_trash(self) -> int:
        return self._purge([r["id"] for r in self.q("SELECT id FROM pages WHERE trashed_at IS NOT NULL")])

    def purge_trash(self, days=TRASH_DAYS):
        limit = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
        return self._purge([r["id"] for r in self.q(
            "SELECT id FROM pages WHERE trashed_at IS NOT NULL AND trashed_at < ?", (limit,))])

    def duplicate(self, pid, parent_id="__same__", as_template=None, title=None) -> dict:
        """Deep copy of a page and everything under it. Links inside the copied subtree follow the copy."""
        r = self._row(pid)
        ids = [pid] + self.descendants(pid)
        mapping = {i: new_id() for i in ids}
        target_parent = r["parent_id"] if parent_id == "__same__" else (parent_id or None)
        if target_parent is not None:
            self._check_parent(target_parent)
        ts = now()
        raw = json.dumps
        with self.tx():
            for i in ids:
                src = self._row(i)
                content = _remap(_loads(src["content"], []), mapping)
                props = _remap(_loads(src["props"], {}), mapping)
                if i == pid:
                    parent, pos = target_parent, (src["position"] + 0.5 if target_parent == r["parent_id"]
                                                  else self._next_position(target_parent))
                    t = title if title is not None else src["title"]
                    tmpl = (1 if as_template else 0) if as_template is not None else src["is_template"]
                else:
                    parent, pos, t, tmpl = mapping.get(src["parent_id"], src["parent_id"]), src["position"], \
                        src["title"], src["is_template"]
                self.x("INSERT INTO pages(id, parent_id, kind, title, icon, cover, content, props, schema, views, "
                       "options, position, is_template, inline, text, created_at, updated_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (mapping[i], parent, src["kind"], t, src["icon"], src["cover"], raw(content), raw(props),
                        src["schema"], src["views"], src["options"], pos, tmpl, src["inline"], src["text"], ts, ts))
            for i in ids:
                self._index(mapping[i])
        if target_parent == r["parent_id"]:
            sib = [s["id"] for s in self.q("SELECT id FROM pages WHERE parent_id IS ? ORDER BY position, created_at",
                                           (target_parent,))]
            with self.tx():
                for n, sid in enumerate(sib):
                    self.x("UPDATE pages SET position=? WHERE id=?", (n, sid))
        return self.page(mapping[pid])

    def from_template(self, template_id, parent_id, title=None) -> dict:
        return self.duplicate(template_id, parent_id=parent_id, as_template=False, title=title)

    # ------------------------------------------------------------------ versions
    def _snapshot(self, r):
        """Keep the state *before* an edit: one entry per editing window of VERSION_WINDOW seconds."""
        last = self.q1("SELECT id, created_at FROM versions WHERE page_id=? ORDER BY id DESC LIMIT 1", (r["id"],))
        if last and (dt.datetime.now(dt.timezone.utc) - _parse_ts(last["created_at"])).total_seconds() < VERSION_WINDOW:
            return
        self.x("INSERT INTO versions(page_id, created_at, title, icon, content, props) VALUES (?,?,?,?,?,?)",
               (r["id"], r["updated_at"], r["title"], r["icon"], r["content"], r["props"]))
        extra = self.q("SELECT id FROM versions WHERE page_id=? ORDER BY id DESC LIMIT -1 OFFSET ?",
                       (r["id"], MAX_VERSIONS))
        for e in extra:
            self.x("DELETE FROM versions WHERE id=?", (e["id"],))

    def versions(self, pid) -> list[dict]:
        self._row(pid)
        return [{"id": v["id"], "created_at": v["created_at"], "title": v["title"], "words": len(v["content"]) // 6}
                for v in self.q("SELECT id, created_at, title, content FROM versions WHERE page_id=? ORDER BY id DESC",
                                (pid,))]

    def version(self, vid) -> dict:
        v = self.q1("SELECT * FROM versions WHERE id=?", (vid,))
        if not v:
            raise NotFound(vid)
        return {"id": v["id"], "page_id": v["page_id"], "created_at": v["created_at"], "title": v["title"],
                "icon": v["icon"], "content": _loads(v["content"], []), "props": _loads(v["props"], {})}

    def restore_version(self, vid) -> dict:
        v = self.version(vid)
        r = self._row(v["page_id"])
        # force a snapshot of the current state so the restore itself can be undone
        self.x("INSERT INTO versions(page_id, created_at, title, icon, content, props) VALUES (?,?,?,?,?,?)",
               (r["id"], r["updated_at"], r["title"], r["icon"], r["content"], r["props"]))
        data = {"title": v["title"], "icon": v["icon"], "content": v["content"]}
        page = self.update(r["id"], data)
        if v["props"] and page.get("database"):
            page = self.update(r["id"], {"props": v["props"], "merge_props": False})
        return page

    # ------------------------------------------------------------------ search / links
    def _index(self, pid):
        r = self.q1("SELECT id, title, content, text FROM pages WHERE id=?", (pid,))
        if not r:
            return
        content = _loads(r["content"], [])
        self.x("DELETE FROM links WHERE src=?", (pid,))
        mentions = md.page_refs(content, mentions_only=True)
        for dst in md.page_refs(content):
            if dst == pid:
                continue
            # a sub-page block pointing at one's own child is structure, not a backlink (like Notion)
            if dst not in mentions:
                child = self.q1("SELECT 1 FROM pages WHERE id=? AND parent_id=?", (dst, pid))
                if child:
                    continue
            self.x("INSERT OR IGNORE INTO links(src, dst) VALUES (?, ?)", (pid, dst))
        if self.fts:
            self.x("DELETE FROM search WHERE id=?", (pid,))
            self.x("INSERT INTO search(id, title, body) VALUES (?, ?, ?)", (pid, r["title"], r["text"]))

    def reindex(self):
        for r in self.q("SELECT id, content FROM pages"):
            self.x("UPDATE pages SET text=? WHERE id=?", (md.to_text(_loads(r["content"], [])), r["id"]))
            self._index(r["id"])

    def search(self, query: str, limit=30) -> list[dict]:
        query = (query or "").strip()
        alive = self.alive_ids()
        rows = []
        if not query:
            rows = self.q("SELECT * FROM pages WHERE trashed_at IS NULL ORDER BY updated_at DESC LIMIT ?", (limit * 2,))
            return [self._hit(r, "") for r in rows if r["id"] in alive][:limit]
        if self.fts:
            terms = [t for t in "".join(c if c.isalnum() else " " for c in query).split() if t]
            if terms:
                fts_q = " ".join('"' + t.replace('"', "") + '"*' for t in terms)
                try:
                    rows = self.q("SELECT p.*, snippet(search, 2, '\u0002', '\u0003', '…', 12) AS snip, "
                                  "bm25(search, 0, 8.0, 1.0) AS score FROM search JOIN pages p ON p.id = search.id "
                                  "WHERE search MATCH ? ORDER BY score LIMIT ?", (fts_q, limit * 3))
                except sqlite3.OperationalError:
                    rows = []
        if not rows:
            like = "%" + query.replace("%", "").replace("_", "") + "%"
            rows = self.q("SELECT *, '' AS snip FROM pages WHERE title LIKE ? OR text LIKE ? ORDER BY updated_at DESC "
                          "LIMIT ?", (like, like, limit * 3))
        return [self._hit(r, r["snip"]) for r in rows if r["id"] in alive][:limit]

    def _hit(self, r, snip):
        d = self.summary(r)
        d["snippet"] = snip or ""
        d["path"] = [p["title"] for p in self.path(r["parent_id"])] if r["parent_id"] else []
        return d

    # ------------------------------------------------------------------ files
    def add_file(self, name, mime, size, page_id=None) -> str:
        fid = new_id(16)
        self.x("INSERT INTO files(id, name, mime, size, page_id, created_at) VALUES (?,?,?,?,?,?)",
               (fid, name[:200], mime[:100], size, page_id, now()))
        return fid

    def file(self, fid):
        r = self.q1("SELECT * FROM files WHERE id=?", (fid,))
        if not r:
            raise NotFound(fid)
        return dict(r)

    # ------------------------------------------------------------------ validation
    def _clean_content(self, content):
        if not isinstance(content, list):
            raise Invalid("content must be a list of blocks")
        if not all(isinstance(b, dict) for b in content):
            raise Invalid("each block must be an object")
        if len(json.dumps(content)) > 20_000_000:
            raise Invalid("page too large")
        return content

    def _clean_schema(self, schema):
        if not isinstance(schema, dict):
            raise Invalid("schema must be an object")
        props, seen = [], set()
        for p in schema.get("properties") or []:
            if not isinstance(p, dict):
                continue
            t = p.get("type") if p.get("type") in PROP_TYPES else "text"
            pid = str(p.get("id") or new_id(6))[:32]
            if pid in seen:
                continue
            seen.add(pid)
            q = {"id": pid, "name": str(p.get("name") or "Property")[:200], "type": t}
            if t in ("select", "multi_select", "status"):
                q["options"] = [{"id": str(o.get("id") or new_id(6))[:32], "name": str(o.get("name") or "")[:200],
                                 "color": o.get("color") if o.get("color") in COLORS else "default",
                                 **({"group": o["group"]} if o.get("group") in ("todo", "doing", "done") else {})}
                                for o in (p.get("options") or []) if isinstance(o, dict) and o.get("name")]
            if t == "relation":
                q["database_id"] = str(p.get("database_id") or "")[:32]
            if t == "number":
                q["format"] = p.get("format") if p.get("format") in ("number", "percent", "euro", "dollar") else "number"
            if t == "date":
                q["time"] = bool(p.get("time"))
            props.append(q)
        return {"title_name": str(schema.get("title_name") or "Name")[:200], "properties": props}

    def _clean_views(self, views, schema):
        if not isinstance(views, list) or not views:
            raise Invalid("a database needs at least one view")
        out = []
        for v in views[:50]:
            if not isinstance(v, dict):
                continue
            w = {k: v[k] for k in ("filters", "sorts", "hidden", "widths", "group_by", "date_prop", "card_cover",
                                   "card_size", "wrap", "order", "filter_mode", "collapsed", "show_empty", "embed_only")
                 if k in v}
            w.update(id=str(v.get("id") or new_id(8))[:32], name=str(v.get("name") or "View")[:200],
                     type=v.get("type") if v.get("type") in VIEW_TYPES else "table")
            out.append(w)
        return out

    def _props_for(self, db_id, props):
        """Clean row values against the database schema; option names never seen before are added to it.
        The schema is read, extended and saved in one transaction: concurrent rows must not overwrite each
        other's new options."""
        with self.tx():
            db_row = self._row(db_id)
            schema = self.schema_of(db_row)
            before = json.dumps(schema, sort_keys=True)
            out = self._clean_props(props, schema)
            if json.dumps(schema, sort_keys=True) != before:
                self.x("UPDATE pages SET schema=?, updated_at=? WHERE id=?", (json.dumps(schema), now(), db_id))
        return out

    def _clean_props(self, props, schema):
        if not isinstance(props, dict):
            raise Invalid("props must be an object")
        types = {p["id"]: p for p in schema.get("properties", [])}
        # accept property names as keys too (handy for scripts): {"Matière": "SISR"}
        by_name = {p["name"].lower(): p for p in schema.get("properties", [])}
        out = {}
        for k, v in props.items():
            p = types.get(k) or by_name.get(str(k).lower())
            if not p:
                continue
            out[p["id"]] = self._clean_value(p, v)
        return {k: v for k, v in out.items() if v is not None}

    def _clean_value(self, p, v):
        t = p["type"]
        if v is None or v == "" or v == []:
            return None
        if t == "number":
            try:
                f = float(v) if not isinstance(v, bool) else None
            except (TypeError, ValueError):
                return None
            # NaN / Infinity are not JSON: a non-finite number is treated like any other invalid number
            return f if f is not None and math.isfinite(f) else None
        if t == "checkbox":
            return bool(v) if not isinstance(v, str) else v.lower() in ("1", "true", "yes", "oui", "x", "✓")
        if t in ("select", "status"):
            return self._option(p, v)
        if t == "multi_select":
            vals = v if isinstance(v, list) else [x.strip() for x in str(v).split(",")]
            ids = [self._option(p, x) for x in vals]
            return [i for i in dict.fromkeys(ids) if i] or None
        if t == "relation":
            vals = v if isinstance(v, list) else [v]
            return [str(x)[:32] for x in vals if x][:200] or None
        if t == "date":
            if isinstance(v, str):
                return {"start": v[:25]}
            if isinstance(v, dict) and v.get("start"):
                d = {"start": str(v["start"])[:25]}
                if v.get("end"):
                    d["end"] = str(v["end"])[:25]
                return d
            return None
        if t in ("created_time", "edited_time"):
            return None
        return str(v)[:10000]

    def _option(self, p, v):
        """Option id for a value given as id or as name (unknown names become new options)."""
        opts = p.setdefault("options", [])
        v = str(v).strip()
        if not v:
            return None
        for o in opts:
            if o["id"] == v:
                return v
        for o in opts:
            if o["name"].lower() == v.lower():
                return o["id"]
        o = {"id": new_id(6), "name": v[:200], "color": COLORS[1 + len(opts) % (len(COLORS) - 1)]}
        opts.append(o)
        return o["id"]


def _remap(obj, mapping):
    """Replace page ids inside blocks / props when a subtree is copied."""
    if isinstance(obj, dict):
        return {k: (mapping.get(v, v) if k in ("pageId", "page_id") and isinstance(v, str) else _remap(v, mapping))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [_remap(x, mapping) for x in obj]
    return obj


class _Tx:
    def __init__(self, store):
        self.s = store

    def __enter__(self):
        self.s.lock.acquire()
        self.depth = getattr(self.s, "_tx_depth", 0)
        if self.depth == 0:
            self.s.db.execute("BEGIN")
        self.s._tx_depth = self.depth + 1
        return self

    def __exit__(self, et, ev, tb):
        self.s._tx_depth = self.depth
        try:
            if self.depth == 0:
                self.s.db.execute("ROLLBACK" if et else "COMMIT")
        finally:
            self.s.lock.release()
        return False
