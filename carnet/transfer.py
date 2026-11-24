"""Import (Obsidian vault, Notion Markdown export, any folder of .md files, zip) and export (Markdown zip)."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import mimetypes
import re
import shutil
import tempfile
import unicodedata
import zipfile
from pathlib import Path

from . import markdown as md
from .store import Store, new_id

SKIP_DIRS = {".obsidian", ".trash", ".git", ".github", "node_modules", ".stfolder", "__MACOSX", "_resources", ".joplin"}
TEMPLATE_DIRS = {"templates", "template", "modèles", "modeles", "_gabarits", "gabarits", "_templates"}
NOTION_ID = re.compile(r"\s+[0-9a-f]{32}$")
MAX_ZIP_FILES = 20000
MAX_ZIP_BYTES = 2 * 1024 ** 3


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s).strip().lower()
    return re.sub(r"\s+", " ", s)


def _title(stem: str) -> str:
    return NOTION_ID.sub("", stem).strip() or stem


class Importer:
    """Two passes: allocate an id for every note and folder, then convert with links resolved."""

    def __init__(self, store: Store, files_dir: Path, parent_id: str | None = None, databases: bool = True):
        self.s = store
        self.files_dir = Path(files_dir)
        self.parent_id = parent_id
        self.databases = databases
        self.by_title: dict[str, str] = {}
        self.by_path: dict[str, str] = {}
        self.files: dict[str, Path] = {}
        self.file_urls: dict[str, str] = {}
        self.stats = {"pages": 0, "databases": 0, "files": 0, "templates": 0}

    # ---------------------------------------------------------------- public
    def run(self, root: Path) -> dict:
        root = Path(root)
        self.root = root
        tmpl_dir = self._template_dir(root)
        self._scan(root)
        top = self._folder(root, self.parent_id, root, tmpl_dir, is_root=True)
        return {**self.stats, "root_id": top}

    # ---------------------------------------------------------------- pass 1
    def _template_dir(self, root: Path):
        cfg = root / ".obsidian" / "templates.json"
        try:
            folder = json.loads(cfg.read_text(encoding="utf-8")).get("folder")
            if folder:
                return (root / folder).resolve()
        except (OSError, ValueError):
            pass
        return None

    def _scan(self, root: Path):
        for p in sorted(root.rglob("*")):
            rel = p.relative_to(root)
            if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts):
                continue
            if p.is_file() and p.suffix.lower() == ".md":
                pid = new_id()
                title = _title(p.stem)
                self.by_title.setdefault(_norm(title), pid)
                self.by_path[_norm(str(rel.with_suffix("")))] = pid
                self.by_path[_norm(str(rel))] = pid
            elif p.is_file():
                self.files.setdefault(_norm(p.name), p)
                self.files[_norm(str(rel))] = p

    def resolve(self, target: str):
        if target.startswith("@link:"):
            href = target[6:]
            from urllib.parse import unquote
            href = unquote(href).split("#")[0]
            key = _norm(href.lstrip("./"))
            return self.by_path.get(key) or self.by_path.get(_norm(re.sub(r"\.md$", "", key))) or \
                self.by_title.get(_norm(_title(Path(href).stem)))
        t = _norm(target)
        return self.by_title.get(t) or self.by_path.get(t) or self.by_title.get(_norm(Path(target).name))

    def resolve_file(self, name: str):
        from urllib.parse import unquote
        name = unquote(name)
        key = _norm(name.lstrip("./"))
        p = self.files.get(key) or self.files.get(_norm(Path(name).name))
        if not p:
            return None
        if str(p) in self.file_urls:
            return self.file_urls[str(p)]
        url = save_file(self.s, self.files_dir, p.name, p.read_bytes())
        self.file_urls[str(p)] = url
        self.stats["files"] += 1
        return url

    # ---------------------------------------------------------------- pass 2
    def _folder(self, folder: Path, parent_id, root, tmpl_dir, is_root=False, template=False):
        entries = sorted(folder.iterdir(), key=lambda p: (p.is_file(), _norm(p.name)))
        notes = [p for p in entries if p.is_file() and p.suffix.lower() == ".md"]
        dirs = [p for p in entries if p.is_dir() and p.name not in SKIP_DIRS and not p.name.startswith(".")]
        # folder note: "X/X.md" or a hub "X/00 - X.md" becomes the folder's own page
        folder_note = None
        for n in notes:
            stem = _norm(_title(n.stem))
            if stem == _norm(folder.name) or re.fullmatch(r"0+\s*-\s*" + re.escape(_norm(folder.name)), stem):
                folder_note = n
                break
        is_template = template or (tmpl_dir is not None and folder.resolve() == tmpl_dir) or \
            _norm(folder.name) in TEMPLATE_DIRS
        title = _title(folder.name)
        fm_notes = [(n, md.split_frontmatter(n.read_text(encoding="utf-8", errors="replace"))[0])
                    for n in notes if n is not folder_note]
        if self.databases and not is_template and len(fm_notes) >= 2 and not dirs and \
                sum(1 for _, fm in fm_notes if len(fm) >= 2) >= max(2, int(0.6 * len(fm_notes))):
            return self._database(folder, parent_id, title, fm_notes, folder_note)
        folder_id = self.by_path.get(_norm(str(folder_note.relative_to(root).with_suffix("")))) if folder_note else None
        content, icon, options = [], "📁", {}
        if folder_note:
            fm, body = md.split_frontmatter(folder_note.read_text(encoding="utf-8", errors="replace"))
            content = self._blocks(body)
            icon = str(fm.get("icon") or "") if fm.get("icon") else ""
            if fm:
                options["frontmatter"] = _jsonable(fm)
        data = {"title": title, "parent_id": parent_id, "content": content, "icon": icon, "options": options,
                "is_template": is_template and not is_root}
        # links to the folder note point at the folder page: it takes the note's id
        pid = self._create_with_id(folder_id, data) if folder_id else self.s.create(data)["id"]
        self.stats["pages"] += 1
        for d in dirs:
            self._folder(d, pid, root, tmpl_dir, template=is_template)
        for n in notes:
            if n is folder_note:
                continue
            self._note(n, pid, root, is_template)
        return pid

    def _blocks(self, body):
        return md.to_blocks(body, resolve=self.resolve, resolve_file=self.resolve_file)

    def _note(self, path: Path, parent_id, root, template, props=None):
        text = path.read_text(encoding="utf-8", errors="replace")
        fm, body = md.split_frontmatter(text)
        pid = self.by_path[_norm(str(path.relative_to(root).with_suffix("")))]
        title = _title(path.stem)
        content = self._blocks(body)
        # a note that starts with "# Its own title" doesn't need it twice
        if content and content[0]["type"] == "heading" and _norm(md._plain(content[0].get("content"))) == _norm(title):
            content = content[1:]
        options = {"frontmatter": _jsonable(fm)} if fm and props is None else {}
        data = {"title": title, "parent_id": parent_id, "content": content, "icon": str(fm.get("icon") or ""),
                "is_template": template, "options": options}
        if props is not None:
            data["props"] = props
        self._create_with_id(pid, data)
        self.stats["templates" if template else "pages"] += 1
        return pid

    def _create_with_id(self, pid, data):
        return self.s.create({**data, "id": pid})["id"]

    # ---------------------------------------------------------------- folder -> database
    def _database(self, folder, parent_id, title, fm_notes, folder_note):
        keys: dict[str, list] = {}
        for _, fm in fm_notes:
            for k, v in fm.items():
                if k.lower() in ("icon", "cover", "aliases", "cssclasses", "cssclass", "title"):
                    continue
                keys.setdefault(k, []).append(v)
        props = []
        for k, vals in keys.items():
            props.append({"id": new_id(6), "name": k, **_infer(vals)})
        schema = {"title_name": "Name", "properties": props}
        content = []
        if folder_note:
            content = self._blocks(md.split_frontmatter(folder_note.read_text(encoding="utf-8", errors="replace"))[1])
        db = self.s.create({"kind": "database", "title": title, "parent_id": parent_id, "schema": schema,
                            "icon": "🗂️"})
        self.stats["databases"] += 1
        by_name = {p["name"]: p for p in props}
        for path, fm in fm_notes:
            values = {}
            for k, v in fm.items():
                p = by_name.get(k)
                if p:
                    values[p["id"]] = _value(p, v)
            self._note(path, db["id"], self.root, False, props=values)
        if content:
            self.s.update(db["id"], {"options": {"description": md.to_text(content)[:2000]}})
        return db["id"]


def _jsonable(v):
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return str(v)


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$")


def _infer(vals):
    present = [v for v in vals if v not in (None, "")]
    if present and all(isinstance(v, bool) for v in present):
        return {"type": "checkbox"}
    if present and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
        return {"type": "number"}
    if present and all(isinstance(v, str) and DATE_RE.match(v) for v in present):
        return {"type": "date", "time": any(len(v) > 10 for v in present)}
    if any(isinstance(v, list) for v in present):
        names = sorted({str(x) for v in present for x in (v if isinstance(v, list) else [v])})
        return {"type": "multi_select", "options": [{"name": n} for n in names[:200]]}
    strs = [str(v) for v in present]
    if strs and all(re.match(r"^https?://", s) for s in strs):
        return {"type": "url"}
    distinct = set(strs)
    if strs and len(distinct) <= max(12, len(strs) // 2) and all(len(s) <= 60 for s in strs):
        return {"type": "select", "options": [{"name": n} for n in sorted(distinct)]}
    return {"type": "text"}


def _value(p, v):
    if v is None:
        return None
    t = p["type"]
    if t == "date":
        return {"start": str(v).replace(" ", "T")}
    if t == "multi_select":
        return [str(x) for x in (v if isinstance(v, list) else [v])]
    if t == "select":
        return str(v)
    return v


def save_file(store: Store, files_dir: Path, name: str, data: "bytes | Path", mime: str | None = None,
              page_id=None) -> str:
    """`data`: the bytes, or a file that is copied (an upload streamed to disk)."""
    name = re.sub(r"[\x00-\x1f/\\]", "_", name)[:180] or "file"
    mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"
    size = data.stat().st_size if isinstance(data, Path) else len(data)
    fid = store.add_file(name, mime, size, page_id)
    files_dir.mkdir(parents=True, exist_ok=True)
    if isinstance(data, Path):
        shutil.copyfile(data, files_dir / fid)
    else:
        (files_dir / fid).write_bytes(data)
    from urllib.parse import quote
    return f"/files/{fid}/{quote(name)}"


def safe_extract(data: "bytes | Path", dest: Path):
    """Unzip into dest, refusing absolute paths, '..' and zip bombs. `data`: the archive bytes or its path."""
    with zipfile.ZipFile(data if isinstance(data, Path) else io.BytesIO(data)) as z:
        infos = z.infolist()
        if len(infos) > MAX_ZIP_FILES or sum(i.file_size for i in infos) > MAX_ZIP_BYTES:
            raise ValueError("archive too large")
        base = dest.resolve()
        for info in infos:
            name = info.filename
            try:
                name = name.encode("cp437").decode("utf-8") if not info.flag_bits & 0x800 else name
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
            target = (dest / name).resolve()
            if not str(target).startswith(str(base) + "/") and target != base:
                raise ValueError("unsafe path in archive")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)


def import_path(store: Store, files_dir: Path, path: Path, parent_id=None, databases=True) -> dict:
    path = Path(path)
    imp = Importer(store, files_dir, parent_id, databases)
    if path.is_file() and path.suffix.lower() == ".md":
        tmp = Path(tempfile.mkdtemp(prefix="carnet-"))
        try:
            shutil.copy(path, tmp / path.name)
            for sib in path.parent.iterdir():               # attachments next to the file
                if sib.is_file() and sib.suffix.lower() != ".md":
                    shutil.copy(sib, tmp / sib.name)
            imp._scan(tmp)
            imp.root = tmp
            pid = imp._note(tmp / path.name, parent_id, tmp, False)
            return {**imp.stats, "root_id": pid}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return imp.run(path)


def import_upload(store: Store, files_dir: Path, filename: str, data: "bytes | Path", parent_id=None,
                  databases=True) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="carnet-"))
    try:
        low = filename.lower()
        if low.endswith(".zip"):
            root = tmp / (re.sub(r"\.zip$", "", Path(filename).name, flags=re.I) or "Import")
            root.mkdir()
            safe_extract(data, root)
            kids = [p for p in root.iterdir() if p.name not in SKIP_DIRS and not p.name.startswith(".")]
            if len(kids) == 1 and kids[0].is_dir():          # zip of a single folder
                root = kids[0]
            return Importer(store, files_dir, parent_id, databases).run(root)
        if low.endswith((".md", ".markdown", ".txt")):
            f = tmp / (Path(filename).stem + ".md")
            if isinstance(data, Path):
                shutil.copyfile(data, f)
            else:
                f.write_bytes(data)
            return import_path(store, files_dir, f, parent_id, databases)
        raise ValueError("send a .zip (Obsidian vault, Notion Markdown export, folder of notes) or a .md file")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ====================================================================== export
def _safe_name(s: str) -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", s).strip(" .") or "Untitled"
    return s[:120]


def page_markdown(store: Store, pid: str, with_title=True) -> str:
    page = store.page(pid)
    titles = {r["id"]: r["title"] or "Untitled" for r in store.q("SELECT id, title FROM pages")}
    out = []
    if with_title:
        out.append(f"# {page['icon'] + ' ' if page['icon'] else ''}{page['title'] or 'Untitled'}\n")
    if page.get("database"):
        schema = page["database"]["schema"]
        lines = [f"- **{p['name']}**: {display_value(p, page['props'].get(p['id']), titles)}"
                 for p in schema["properties"] if page["props"].get(p["id"]) not in (None, "", [])]
        if lines:
            out.append("\n".join(lines) + "\n")
    if page["kind"] == "database":
        out.append(database_table(page, titles))
    out.append(md.to_markdown(page["content"], title_of=titles.get))
    return "\n".join(x for x in out if x.strip()).strip() + "\n"


def display_value(p, v, titles=None):
    if v in (None, "", []):
        return ""
    t = p["type"]
    opts = {o["id"]: o["name"] for o in p.get("options", [])}
    if t in ("select", "status"):
        return opts.get(v, "")
    if t == "multi_select":
        return ", ".join(opts.get(x, "") for x in v if opts.get(x))
    if t == "checkbox":
        return "✓" if v else "☐"
    if t == "date":
        return v.get("start", "") + (" → " + v["end"] if v.get("end") else "")
    if t == "relation":
        return ", ".join((titles or {}).get(x, x) for x in v)
    if t == "number":
        return ("%g" % v) if isinstance(v, (int, float)) else str(v)
    return str(v)


def database_table(page, titles) -> str:
    schema = page["schema"]
    cols = [schema["title_name"]] + [p["name"] for p in schema["properties"]]
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for r in page.get("rows", []):
        cells = [f"[[{r['title'] or 'Untitled'}]]"] + [display_value(p, r["props"].get(p["id"]), titles)
                                                         for p in schema["properties"]]
        lines.append("| " + " | ".join(c.replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    return "\n".join(lines) + "\n"


def database_csv(store: Store, pid: str) -> str:
    page = store.page(pid)
    titles = {r["id"]: r["title"] for r in store.q("SELECT id, title FROM pages")}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([page["schema"]["title_name"]] + [p["name"] for p in page["schema"]["properties"]])
    for r in page["rows"]:
        w.writerow([r["title"]] + [display_value(p, r["props"].get(p["id"]), titles) for p in page["schema"]["properties"]])
    return buf.getvalue()


def export_zip(store: Store, files_dir: Path, root_id: str | None = None) -> bytes:
    """Every page as Markdown, sub-pages in folders, attachments in _files/: opens as an Obsidian vault."""
    tree = store.tree()
    kids: dict = {}
    for p in tree:
        kids.setdefault(p["parent_id"], []).append(p)
    alive = {p["id"] for p in tree}
    buf = io.BytesIO()
    used_files: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        def write(p, folder):
            name = _safe_name(p["title"] or "Untitled")
            base, n = name, 2
            while f"{folder}{name}.md" in z.namelist():
                name = f"{base} ({n})"
                n += 1
            text = page_markdown(store, p["id"])
            for fid in re.findall(r"/files/([a-z0-9]{16})/", text):
                used_files.add(fid)
            text = re.sub(r"\(/files/([a-z0-9]{16})/([^)\s]+)\)",
                          lambda m: f"(<{'../' * folder.count('/')}_files/{m.group(1)}-{m.group(2)}>)", text)
            z.writestr(f"{folder}{name}.md", text)
            for c in kids.get(p["id"], []):
                write(c, f"{folder}{name}/")

        roots = [store.summary(store._row(root_id))] if root_id else kids.get(None, [])
        for p in roots:
            if p["id"] in alive:
                write(p, "")
        for fid in used_files:
            try:
                f = store.file(fid)
            except Exception:
                continue
            path = files_dir / fid
            if path.is_file():
                from urllib.parse import quote
                z.write(path, f"_files/{fid}-{quote(f['name'])}")
        z.writestr("README.txt", f"Exported from Carnet on {dt.date.today().isoformat()}.\n"
                                 "Open this folder as an Obsidian vault, or import the zip back into Carnet.\n")
    return buf.getvalue()
