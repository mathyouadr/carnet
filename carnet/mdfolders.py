"""Markdown folders shown read-only next to Carnet's own pages (``CARNET_MD_FOLDERS``).

The files stay the source of truth: Carnet only reads them (an Obsidian vault, notes written by scripts or an AI
agent...). Each folder becomes a top-level page, sub-folders and notes become sub-pages; ``[[links]]`` between notes
are resolved like Obsidian (path first, then file name). Changes on disk show up within a few seconds.

Pages from a folder have stable ids (``md`` + hash of folder name and relative path), ``readonly: true`` and a
``source`` {folder, path}. Writes to them are refused by the API.
"""
from __future__ import annotations

import hashlib
import os
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from . import markdown as md

MAX_FILE = 2_000_000
RESCAN_SECONDS = 3.0
SKIP_DIRS = {".git", ".obsidian", ".trash", ".stfolder", "node_modules", "__pycache__"}


def parse_spec(spec: str) -> list[tuple[str, Path]]:
    """``"Name=/path;Other=/other/path"`` (or just paths) -> [(name, path)]."""
    out = []
    for part in (spec or "").replace("\n", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" in part and not part.startswith(("/", "~", ".")):
            name, path = part.split("=", 1)
        else:
            name, path = "", part
        p = Path(path.strip()).expanduser()
        out.append((name.strip() or p.name, p))
    return out


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class MdFolders:
    def __init__(self, specs: list[tuple[str, Path]]):
        self.specs = [(n, p) for n, p in specs if p.is_dir()]
        self.lock = threading.RLock()
        self.pages: dict[str, dict] = {}       # id -> summary (+ _file, _dir)
        self._sig = None
        self._checked = 0.0
        self._blocks: dict[str, tuple[float, list]] = {}
        self._text: dict[str, tuple[float, str]] = {}

    def __bool__(self):
        return bool(self.specs)

    # ------------------------------------------------------------------ scan
    @staticmethod
    def make_id(folder: str, rel: str) -> str:
        return "md" + hashlib.sha1(f"{folder}\0{rel}".encode()).hexdigest()[:14]

    def _walk(self, root: Path):
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if not x.startswith(".") and x not in SKIP_DIRS)
            yield Path(d), sorted(f for f in files if f.lower().endswith(".md") and not f.startswith("."))

    def _signature(self):
        sig = []
        for name, root in self.specs:
            for d, files in self._walk(root):
                sig.append((str(d), d.stat().st_mtime_ns))
                for f in files:
                    try:
                        st = (d / f).stat()
                        sig.append((str(d / f), st.st_mtime_ns, st.st_size))
                    except OSError:
                        pass
        return tuple(sig)

    def refresh(self, force=False):
        with self.lock:
            if not force and time.time() - self._checked < RESCAN_SECONDS:
                return
            self._checked = time.time()
            sig = self._signature()
            if sig == self._sig:
                return
            self._sig = sig
            pages = {}
            for pos, (name, root) in enumerate(self.specs):
                root_real = root.resolve()
                rid = self.make_id(name, "")
                pages[rid] = self._summary(rid, None, name, "📁", 1e6 + pos, root, directory=True, folder=name, rel="")
                dir_ids = {root: rid}
                for d, files in self._walk(root):
                    if d != root:
                        rel = d.relative_to(root).as_posix()
                        did = self.make_id(name, rel + "/")
                        dir_ids[d] = did
                        pages[did] = self._summary(did, dir_ids.get(d.parent, rid), d.name, "", 0, d, directory=True,
                                                   folder=name, rel=rel)
                    for i, f in enumerate(files):
                        p = d / f
                        try:
                            if not p.resolve().is_relative_to(root_real) or p.stat().st_size > MAX_FILE:
                                continue
                        except OSError:
                            continue
                        rel = p.relative_to(root).as_posix()
                        stem = p.stem
                        if d != root and stem == d.name:           # folder note: becomes the folder page itself
                            pages[dir_ids[d]].update(_file=p, updated_at=_iso(p.stat().st_mtime))
                            continue
                        nid = self.make_id(name, rel)
                        pages[nid] = self._summary(nid, dir_ids[d], stem, "", i + 1, p, folder=name, rel=rel)
                # order like a file explorer: folders first, then notes, by name; drop folders without any note
                kids = {}
                for pg in pages.values():
                    kids.setdefault(pg["parent_id"], []).append(pg)

                def has_note(pid):
                    return any(k.get("_file") or (k.get("_dir") and has_note(k["id"])) for k in kids.get(pid, []))
                for pid in [p for p, pg in pages.items() if pg.get("_dir") and pg["parent_id"] and not pg.get("_file")]:
                    if not has_note(pid):
                        pages.pop(pid, None)
                for parent, ks in kids.items():
                    ks = [k for k in ks if k["id"] in pages]
                    ks.sort(key=lambda k: (not k.get("_dir"), _fold(k["title"])))
                    for n, k in enumerate(ks):
                        k["position"] = n if parent else k["position"]
            self.pages = pages
            self._by_name = {}
            self._by_rel = {}
            for pid, pg in pages.items():
                if pg.get("_file"):
                    rel = pg["source"]["path"]
                    self._by_rel[(pg["source"]["folder"], _fold(rel[:-3] if rel.endswith(".md") else rel))] = pid
                    self._by_name.setdefault((pg["source"]["folder"], _fold(Path(rel).stem)), pid)

    def _summary(self, pid, parent, title, icon, position, path: Path, directory=False, folder="", rel=""):
        try:
            mt = path.stat().st_mtime
        except OSError:
            mt = time.time()
        return {"id": pid, "parent_id": parent, "kind": "page", "title": title, "icon": icon, "position": position,
                "favorite": None, "is_template": 0, "inline": 0, "updated_at": _iso(mt), "created_at": _iso(mt),
                "readonly": True, "source": {"folder": folder, "path": rel or ""},
                "_file": None if directory else path, "_dir": path if directory else None}

    # ------------------------------------------------------------------ reading
    def has(self, pid: str) -> bool:
        if not pid or not pid.startswith("md"):
            return False
        self.refresh()
        return pid in self.pages

    def tree(self) -> list[dict]:
        self.refresh()
        return [self._public(p) for p in self.pages.values()]

    @staticmethod
    def _public(p: dict) -> dict:
        return {k: v for k, v in p.items() if not k.startswith("_")}

    def _resolver(self, folder: str, src_rel: str):
        def resolve(target: str):
            t = (target or "").strip()
            if t.startswith("@link:"):
                from urllib.parse import unquote
                t = unquote(t[6:])
            if not t:
                return None
            t = t.split("#")[0].strip().rstrip("/")
            t = t[:-3] if t.lower().endswith(".md") else t
            here = str(Path(src_rel).parent) if src_rel else ""
            for cand in (t, os.path.normpath(os.path.join(here, t)).replace("\\", "/")):
                pid = self._by_rel.get((folder, _fold(cand)))
                if pid:
                    return pid
            return self._by_name.get((folder, _fold(t.split("/")[-1])))
        return resolve

    def _raw(self, pg) -> str:
        f = pg.get("_file")
        if not f:
            return ""
        try:
            return f.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
        except OSError:
            return ""

    def blocks(self, pid: str) -> list:
        pg = self.pages[pid]
        mt = pg["updated_at"]
        hit = self._blocks.get(pid)
        if hit and hit[0] == mt:
            return hit[1]
        fm, body = md.split_frontmatter(self._raw(pg))
        blocks = md.to_blocks(body, resolve=self._resolver(pg["source"]["folder"], pg["source"]["path"]))
        if blocks and blocks[0]["type"] == "heading" and _fold(md._plain(blocks[0].get("content"))) == _fold(pg["title"]):
            blocks = blocks[1:]
        if pg.get("_dir"):     # folder page: list what is inside, like Notion
            kids = sorted((p for p in self.pages.values() if p["parent_id"] == pid),
                          key=lambda p: (p["position"] >= 0, _fold(p["title"])))
            blocks = blocks + [{"type": "pageLink", "props": {"pageId": k["id"]}, "children": []} for k in kids]
        self._blocks[pid] = (mt, blocks)
        return blocks

    def text(self, pid: str) -> str:
        pg = self.pages[pid]
        hit = self._text.get(pid)
        if hit and hit[0] == pg["updated_at"]:
            return hit[1]
        t = md.split_frontmatter(self._raw(pg))[1]
        self._text[pid] = (pg["updated_at"], t)
        return t

    def path(self, pid: str) -> list[dict]:
        out, cur, n = [], self.pages.get(pid), 0
        while cur and n < 50:
            out.append({"id": cur["id"], "title": cur["title"], "icon": cur["icon"], "kind": "page"})
            cur, n = self.pages.get(cur["parent_id"]) if cur["parent_id"] else None, n + 1
        return out[::-1]

    def page(self, pid: str, extra_backlinks: list | None = None) -> dict:
        self.refresh()
        pg = self.pages[pid]
        d = self._public(pg)
        d.update(cover="", content=self.blocks(pid), props={}, options={"locked": True}, rev=0, trashed_at=None,
                 in_trash=False, path=self.path(pid))
        backs = {}
        for oid in self.pages:
            if oid != pid and pid in self.refs(oid):
                backs[oid] = self._public(self.pages[oid])
        for b in extra_backlinks or []:
            backs.setdefault(b["id"], b)
        d["backlinks"] = sorted(backs.values(), key=lambda b: _fold(b["title"]))
        d["children"] = [self._public(p) for p in self.pages.values() if p["parent_id"] == pid]
        return d

    def refs(self, pid: str) -> set:
        if not self.pages[pid].get("_file"):
            return set()
        return md.page_refs(self.blocks(pid), mentions_only=True)

    def markdown(self, pid: str) -> str:
        self.refresh()
        pg = self.pages[pid]
        if pg.get("_dir") and not pg.get("_file"):
            kids = [p["title"] for p in self.pages.values() if p["parent_id"] == pid]
            return f"# {pg['title']}\n\n" + "\n".join(f"- [[{k}]]" for k in sorted(kids, key=_fold)) + "\n"
        body = self.text(pid).strip()
        return body + "\n" if body.startswith("# ") else f"# {pg['title']}\n\n{body}\n"

    def search(self, query: str, limit=30) -> list[dict]:
        self.refresh()
        terms = [_fold(t) for t in re.findall(r"\w+", query or "")]
        if not terms:
            return []
        hits = []
        for pid, pg in self.pages.items():
            title = _fold(pg["title"])
            text = self.text(pid) if pg.get("_file") else ""
            low = _fold(text)
            if not all(t in title or t in low for t in terms):
                continue
            score = sum(3 for t in terms if t in title) + sum(low.count(t) for t in terms) * 0.01
            snip = ""
            i = low.find(terms[0])
            if i >= 0:
                a, b = max(0, i - 60), min(len(text), i + 100)
                frag = text[a:b].replace("\n", " ")
                j = i - a
                snip = ("…" if a else "") + frag[:j] + "\u0002" + frag[j:j + len(terms[0])] + "\u0003" + frag[j + len(terms[0]):] + "…"
            h = self._public(pg)
            h["snippet"] = snip
            h["path"] = [p["title"] for p in self.path(pg["parent_id"])] if pg["parent_id"] else []
            hits.append((score, h))
        hits.sort(key=lambda x: -x[0])
        return [h for _, h in hits[:limit]]
