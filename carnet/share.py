"""Public read-only links: ``/s/<token>`` shows one page and its sub-pages to anyone who has the link.

The page is rendered on the server as plain HTML (no app, no API): what a visitor can reach is exactly the shared
page, the pages under it, and the files those pages show. Links to any other page are dropped, linked databases
from outside the shared tree are not shown, and nothing else of the notes is reachable from a share URL.

URLs (under the base path on the main server, at the root on the share port):
  /s/<token>                    the shared page
  /s/<token>/<page id>          a page under it
  /s/<token>/files/<id>/<name>  a file one of those pages shows
  /s/_/<asset>                  share.css, share.js, KaTeX
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import urllib.parse

from .store import NotFound, Store

ID = re.compile(r"^[a-z0-9]{4,32}$")
INTERNAL = re.compile(r"(?:^|/)p/([a-z0-9]{4,32})(?:[/?#]|$)")
SAFE_HREF = re.compile(r"^(?:https?://|mailto:|tel:|#)", re.I)
ABSOLUTE = re.compile(r"^https?://", re.I)
LOCAL_FILE = re.compile(r"^(?:/[A-Za-z0-9_.-]+)*/?files/([A-Za-z0-9]+)/([^?#\s]*)")
GRADIENT = re.compile(r"^(?:linear-gradient\([#0-9a-zA-Z,.%\s-]+\)|#[0-9a-fA-F]{3,8})$")
COLORS = {"gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"}

T = {
    "fr": {"untitled": "Sans titre", "readonly": "Lecture seule", "private": "Page non partagée",
           "private_db": "Base non partagée", "subpages": "Sous-pages", "footer": "Partagé depuis Carnet",
           "updated": "mis à jour le", "empty": "Aucune ligne", "notfound": "Ce lien de partage n'existe pas ou a été retiré.",
           "nf_title": "Lien introuvable", "toc": "Sommaire", "yes": "Oui", "no": "Non"},
    "en": {"untitled": "Untitled", "readonly": "Read only", "private": "Page not shared",
           "private_db": "Database not shared", "subpages": "Sub-pages", "footer": "Shared from Carnet",
           "updated": "updated", "empty": "No rows", "notfound": "This share link does not exist or was removed.",
           "nf_title": "Link not found", "toc": "Contents", "yes": "Yes", "no": "No"},
}


def esc(s) -> str:
    return html.escape(str(s or ""), quote=True)


class Renderer:
    def __init__(self, store: Store, prefix: str = "", lang: str = "", site_title: str = "Carnet", assets: str = ""):
        self.s = store
        self.prefix = prefix.rstrip("/")
        self.lang = "fr" if (lang or "").startswith("fr") else "en"
        self.t = T[self.lang]
        self.site = site_title
        self.assets = assets                                       # cache-busting version for /s/_/ files

    # ------------------------------------------------------------------ scope
    def scope(self, token) -> tuple[str, set]:
        """(root id, ids of the live pages the token opens). NotFound for a bad or revoked token."""
        root = self.s.share_root(token)
        alive = self.s.alive_ids()
        ids = {root} | {i for i in self.s.descendants(root) if i in alive}
        tmpl = {r["id"] for r in self.s.q("SELECT id FROM pages WHERE is_template=1")}
        return root, ids - (tmpl - {root})

    def file_allowed(self, token, fid) -> bool:
        try:
            _, ids = self.scope(token)
        except NotFound:
            return False
        marks = (f"/files/{fid}/", f"files/{fid}/")
        for pid in ids:
            r = self.s.q1("SELECT content, cover, props FROM pages WHERE id=?", (pid,))
            if r and any(m in (r["content"] or "") or m in (r["cover"] or "") for m in marks):
                return True
        return False

    def url(self, token, pid=None) -> str:
        base = f"{self.prefix}/s/{token}"
        return base if pid is None or pid == self._root else f"{base}/{pid}"

    def file_url(self, url: str) -> str | None:
        """A Carnet file URL -> its share URL; external http(s) URLs unchanged; anything else None."""
        url = url or ""
        if ABSOLUTE.match(url):
            return url
        m = LOCAL_FILE.match(url)
        if m:
            return f"{self.prefix}/s/{self._token}/files/{m.group(1)}/{m.group(2)}"
        return None

    # ------------------------------------------------------------------ pages
    def page(self, token, pid) -> tuple[int, str]:
        try:
            root, ids = self.scope(token)
        except NotFound:
            return 404, self.not_found()
        pid = pid or root
        if pid not in ids:
            return 404, self.not_found()
        self._token, self._root, self._ids = token, root, ids
        self._titles = {r["id"]: (r["title"], r["icon"]) for r in self.s.q("SELECT id, title, icon FROM pages")}
        self._math = False
        p = self.s.page(pid)
        crumbs = []
        for c in p["path"]:
            if c["id"] in ids:
                crumbs.append(f'<a href="{esc(self.url(token, c["id"]))}">{self._icon(c["icon"])}'
                              f'{esc(c["title"] or self.t["untitled"])}</a>')
        body = []
        cover = (p.get("cover") or "").strip()
        if cover:
            if GRADIENT.match(cover):
                body.append(f'<div class="cover" style="background:{esc(cover)}"></div>')
            elif self.file_url(cover):
                body.append(f'<div class="cover"><img src="{esc(self.file_url(cover))}" alt=""></div>')
        body.append(f'<h1 class="title">{self._icon(p["icon"], big=True)}{esc(p["title"] or self.t["untitled"])}</h1>')
        if p.get("database"):
            body.append(self.props_table(p["database"]["schema"], p))
        content = p.get("content") or []
        self._headings = []
        self._collect_headings(content)
        blocks_html = self.blocks(content)
        body.append(f'<article>{blocks_html}</article>')
        if p["kind"] == "database":
            body.append(self.database(p, None))
        else:
            linked = set(re.findall(r'"pageId"\s*:\s*"([a-z0-9]+)"', json.dumps(content)))
            kids = [c for c in p.get("children", []) if c["id"] in ids and c["id"] not in linked]
            if kids:
                body.append(f'<section class="subpages"><h2>{esc(self.t["subpages"])}</h2>' + "".join(
                    f'<a class="pagelink" href="{esc(self.url(token, c["id"]))}">{self._icon(c["icon"] or "📄")}'
                    f'{esc(c["title"] or self.t["untitled"])}</a>' for c in kids) + "</section>")
        updated = _fmt_date(p.get("updated_at"), self.lang)
        return 200, self.doc(p["title"] or self.t["untitled"], crumbs, "".join(body),
                             f'{esc(self.t["footer"])} · {esc(self.t["updated"])} {esc(updated)}')

    def not_found(self) -> str:
        return self.doc(self.t["nf_title"], [], f'<h1 class="title">{esc(self.t["nf_title"])}</h1>'
                        f'<p class="muted">{esc(self.t["notfound"])}</p>', "", math=False)

    def doc(self, title, crumbs, main, footer, math=None) -> str:
        math = self._math if math is None else math
        a = f"{self.prefix}/s/_/"
        v = f"?v={esc(self.assets)}" if self.assets else ""
        head_math = f'<link rel="stylesheet" href="{a}katex/katex.min.css{v}">' if math else ""
        foot_math = (f'<script src="{a}katex/katex.min.js{v}" defer></script>'
                     f'<script src="{a}share.js{v}" defer></script>') if math else ""
        nav = '<span class="sep">/</span>'.join(crumbs)
        return (f'<!doctype html><html lang="{self.lang}"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width, initial-scale=1">'
                f'<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">'
                f'<title>{esc(title)}</title><link rel="icon" href="{a}icon.svg">'
                f'<link rel="stylesheet" href="{a}share.css{v}">{head_math}</head><body>'
                f'<header class="bar"><nav class="crumbs">{nav}</nav>'
                f'<span class="badge">{esc(self.t["readonly"])}</span></header>'
                f'<main>{main}</main><footer>{footer}</footer>{foot_math}</body></html>')

    def _icon(self, icon, big=False):
        if not icon:
            return ""
        return f'<span class="{"icon big" if big else "icon"}">{esc(icon)}</span>'

    # ------------------------------------------------------------------ blocks
    def _collect_headings(self, blocks):
        for b in blocks if isinstance(blocks, list) else []:
            if isinstance(b, dict):
                if b.get("type") == "heading":
                    self._headings.append((b.get("id") or "", int((b.get("props") or {}).get("level") or 1),
                                           _plain(b.get("content"))))
                self._collect_headings(b.get("children") or [])

    def blocks(self, blocks) -> str:
        out, i = [], 0
        blocks = [b for b in blocks if isinstance(b, dict)] if isinstance(blocks, list) else []
        while i < len(blocks):
            t = blocks[i].get("type")
            if t in ("bulletListItem", "numberedListItem", "checkListItem"):
                j = i
                while j < len(blocks) and blocks[j].get("type") == t:
                    j += 1
                items = "".join(self._safe(self.list_item, b) for b in blocks[i:j])
                if t == "numberedListItem":
                    start = int((blocks[i].get("props") or {}).get("start") or 1)
                    out.append(f'<ol{f" start={start}" if start != 1 else ""}>{items}</ol>')
                else:
                    out.append(f'<ul{" class=checks" if t == "checkListItem" else ""}>{items}</ul>')
                i = j
                continue
            out.append(self._safe(self.block, blocks[i]))
            i += 1
        return "".join(out)

    def _safe(self, fn, b):
        try:
            return fn(b)
        except (AttributeError, TypeError, ValueError, KeyError):
            return ""                                   # a malformed block is skipped, never a 500

    def _cls(self, p):
        cls = []
        if p.get("textAlignment") in ("center", "right", "justify"):
            cls.append("al-" + p["textAlignment"])
        if p.get("textColor") in COLORS:
            cls.append("c-" + p["textColor"])
        if p.get("backgroundColor") in COLORS:
            cls.append("bg-" + p["backgroundColor"])
        return f' class="{" ".join(cls)}"' if cls else ""

    def list_item(self, b):
        p = b.get("props") or {}
        inner = self.inline(b.get("content"))
        kids = self.blocks(b.get("children") or [])
        if b.get("type") == "checkListItem":
            box = '<span class="box on">✓</span>' if p.get("checked") else '<span class="box"></span>'
            return f'<li{" class=done" if p.get("checked") else ""}>{box}<span>{inner}</span>{kids}</li>'
        return f"<li{self._cls(p)}>{inner}{kids}</li>"

    def block(self, b) -> str:
        t = b.get("type")
        p = b.get("props") or {}
        c = b.get("content")
        kids = self.blocks(b.get("children") or [])
        inner = self.inline(c) if isinstance(c, list) else ""
        if t == "paragraph":
            return f"<p{self._cls(p)}>{inner or '<br>'}</p>{_nest(kids)}"
        if t == "heading":
            level = max(1, min(int(p.get("level") or 1), 4)) + 1
            hid = f' id="h-{esc(b.get("id"))}"' if b.get("id") else ""
            h = f"<h{level}{hid}{self._cls(p)}>{inner}</h{level}>"
            if p.get("isToggleable"):
                return f"<details open><summary>{h}</summary>{kids}</details>"
            return h + _nest(kids)
        if t == "toggleListItem":
            return f"<details><summary>{inner}</summary>{kids}</details>"
        if t == "quote":
            return f"<blockquote{self._cls(p)}>{inner}{kids}</blockquote>"
        if t == "callout":
            color = p.get("color") if p.get("color") in COLORS else "gray"
            return (f'<div class="callout co-{color}"><span class="emoji">{esc(p.get("emoji") or "💡")}</span>'
                    f"<div>{inner}{kids}</div></div>")
        if t == "codeBlock":
            lang = re.sub(r"[^a-z0-9+#-]", "", str(p.get("language") or "text").lower())
            return f'<pre><code class="language-{lang}">{esc(_plain(c))}</code></pre>'
        if t == "math":
            self._math = True
            return f'<div class="math block" data-latex="{esc(p.get("latex"))}">{esc(p.get("latex"))}</div>'
        if t in ("divider", "pageBreak"):
            return "<hr>"
        if t == "table":
            return self.table(c)
        if t in ("image", "video", "audio", "file"):
            return self.media(t, p)
        if t == "pageLink":
            pid = p.get("pageId") or ""
            if pid in self._ids:
                title, icon = self._titles.get(pid, ("", ""))
                return (f'<a class="pagelink" href="{esc(self.url(self._token, pid))}">{self._icon(icon or "📄")}'
                        f'{esc(title or self.t["untitled"])}</a>')
            return f'<p class="pagelink off">🔒 {esc(self.t["private"])}</p>'
        if t == "database":
            pid = p.get("pageId") or ""
            if pid in self._ids:
                try:
                    db = self.s.page(pid)
                except NotFound:
                    return ""
                title, icon = self._titles.get(pid, ("", ""))
                head = (f'<h3 class="dbtitle"><a href="{esc(self.url(self._token, pid))}">{self._icon(icon)}'
                        f'{esc(title or self.t["untitled"])}</a></h3>')
                return head + self.database(db, p.get("viewId") or None)
            return f'<p class="pagelink off">🔒 {esc(self.t["private_db"])}</p>'
        if t == "embed":
            url = p.get("url") or ""
            return f'<p><a href="{esc(url)}" rel="noopener noreferrer nofollow" target="_blank">{esc(url)}</a></p>' \
                if SAFE_HREF.match(url) else ""
        if t == "toc":
            if not self._headings:
                return ""
            items = "".join(f'<li class="lv{lv}"><a href="#h-{esc(hid)}">{esc(txt)}</a></li>'
                            for hid, lv, txt in self._headings if hid)
            return f'<nav class="toc"><ul>{items}</ul></nav>'
        if t == "columnList":
            cols = [x for x in (b.get("children") or []) if isinstance(x, dict)]
            return '<div class="cols">' + "".join(
                f'<div class="col">{self.blocks(col.get("children") or [])}</div>' for col in cols) + "</div>"
        if t == "column":
            return kids
        return (f"<p>{inner}</p>" if inner else "") + kids

    def table(self, c) -> str:
        rows = (c or {}).get("rows", []) if isinstance(c, dict) else []
        if not rows:
            return ""
        header = int((c or {}).get("headerRows") or 0)
        out = []
        for n, r in enumerate(rows):
            tag = "th" if n < header else "td"
            cells = []
            for cell in r.get("cells", []):
                content = cell.get("content") if isinstance(cell, dict) else cell
                cells.append(f"<{tag}>{self.inline(content)}</{tag}>")
            out.append("<tr>" + "".join(cells) + "</tr>")
        return '<div class="tablewrap"><table>' + "".join(out) + "</table></div>"

    def media(self, t, p) -> str:
        src = self.file_url(p.get("url") or "")
        if not src:
            return ""
        cap = p.get("caption") or ""
        name = p.get("name") or cap or urllib.parse.unquote(src.rsplit("/", 1)[-1])
        if t == "image":
            w = p.get("previewWidth")
            style = f' style="max-width:{int(w)}px"' if isinstance(w, (int, float)) and 40 < w < 4000 else ""
            fig = f'<img src="{esc(src)}" alt="{esc(cap)}" loading="lazy"{style}>'
        elif t == "video":
            fig = f'<video src="{esc(src)}" controls preload="metadata"></video>'
        elif t == "audio":
            fig = f'<audio src="{esc(src)}" controls preload="metadata"></audio>'
        else:
            return f'<p class="file"><a href="{esc(src)}" download>📎 {esc(name)}</a></p>'
        return f"<figure>{fig}{f'<figcaption>{esc(cap)}</figcaption>' if cap else ''}</figure>"

    # ------------------------------------------------------------------ inline
    def inline(self, items) -> str:
        if isinstance(items, str):
            return esc(items).replace("\n", "<br>")
        out = []
        for it in items or []:
            if not isinstance(it, dict):
                continue
            t = it.get("type")
            if t == "text":
                out.append(_styled(it.get("text", ""), it.get("styles") or {}))
            elif t == "link":
                inner = "".join(_styled(x.get("text", ""), x.get("styles") or {}) for x in it.get("content") or []
                                if isinstance(x, dict) and x.get("type") == "text")
                out.append(self.link(it.get("href") or "", inner))
            elif t == "pageMention":
                pr = it.get("props") or {}
                pid = pr.get("pageId") or ""
                if pid in self._ids:
                    title, icon = self._titles.get(pid, (pr.get("title"), ""))
                    out.append(f'<a class="mention" href="{esc(self.url(self._token, pid))}">'
                               f'{esc(icon or "📄")} {esc(title or self.t["untitled"])}</a>')
                else:
                    out.append(f'<span class="mention off">{esc(pr.get("title") or self.t["untitled"])}</span>')
            elif t == "inlineMath":
                self._math = True
                lx = (it.get("props") or {}).get("latex", "")
                out.append(f'<span class="math" data-latex="{esc(lx)}">{esc(lx)}</span>')
        return "".join(out)

    def link(self, href, inner) -> str:
        if ABSOLUTE.match(href):
            m = INTERNAL.search(href)
            if m and m.group(1) in self._titles:          # a full URL to one of these notes
                return self._page_link(m.group(1), inner)
            return f'<a href="{esc(href)}" rel="noopener noreferrer nofollow" target="_blank">{inner}</a>'
        if re.match(r"^(?:mailto|tel):", href, re.I):
            return f'<a href="{esc(href)}">{inner}</a>'
        if href.startswith("#"):
            return f'<a href="{esc(href)}">{inner}</a>'
        m = INTERNAL.search(href)
        if m:
            return self._page_link(m.group(1), inner)
        fu = self.file_url(href)
        return f'<a href="{esc(fu)}">{inner}</a>' if fu else inner

    def _page_link(self, pid, inner):
        if pid in self._ids:
            return f'<a href="{esc(self.url(self._token, pid))}">{inner}</a>'
        return inner                                      # a page that is not shared: text only

    # ------------------------------------------------------------------ databases
    def database(self, db, view_id) -> str:
        schema = db.get("schema") or {"title_name": "Name", "properties": []}
        views = db.get("views") or []
        view = next((v for v in views if v.get("id") == view_id), None) if view_id else None
        view = view or next((v for v in views if not v.get("embed_only")), None) or {}
        rows = [r for r in db.get("rows") or [] if r["id"] in self._ids]
        rows = apply_view(rows, view, schema)
        hidden = set(view.get("hidden") or [])
        props = [p for p in schema["properties"] if p["id"] not in hidden]
        if not rows:
            return f'<p class="muted">{esc(self.t["empty"])}</p>'
        if view.get("type") in ("gallery", "list", "board"):
            cards = []
            for r in rows:
                vals = "".join(f'<span class="cv">{v}</span>' for v in (self.value(p, _value(r, p), links=False) for p in props) if v)
                cards.append(f'<a class="card" href="{esc(self.url(self._token, r["id"]))}"><span class="ct">'
                             f'{self._icon(r.get("icon") or "📄")}{esc(r["title"] or self.t["untitled"])}</span>'
                             f'{f"<span class=cvs>{vals}</span>" if vals else ""}</a>')
            return f'<div class="cards">{"".join(cards)}</div>'
        head = f'<th>{esc(schema.get("title_name") or "Name")}</th>' + "".join(f"<th>{esc(p['name'])}</th>" for p in props)
        body = []
        for r in rows:
            cells = [f'<td class="ttl"><a href="{esc(self.url(self._token, r["id"]))}">{self._icon(r.get("icon"))}'
                     f'{esc(r["title"] or self.t["untitled"])}</a></td>']
            cells += [f"<td>{self.value(p, _value(r, p))}</td>" for p in props]
            body.append("<tr>" + "".join(cells) + "</tr>")
        return f'<div class="tablewrap"><table class="db"><thead><tr>{head}</tr></thead><tbody>{"".join(body)}</tbody></table></div>'

    def props_table(self, schema, page) -> str:
        rows = []
        for p in schema.get("properties") or []:
            v = self.value(p, _value(page, p))
            if v:
                rows.append(f'<div class="prop"><span class="k">{esc(p["name"])}</span><span class="v">{v}</span></div>')
        return f'<div class="props">{"".join(rows)}</div>' if rows else ""

    def value(self, p, v, links=True) -> str:
        if v in (None, "", []) or (isinstance(v, dict) and not v.get("start")):
            return ""
        t = p.get("type")
        opts = {o["id"]: o for o in p.get("options") or []}
        if t in ("select", "status"):
            o = opts.get(v)
            return _tag(o) if o else ""
        if t == "multi_select":
            return " ".join(_tag(opts[x]) for x in v if x in opts) if isinstance(v, list) else ""
        if t == "checkbox":
            return '<span class="box on">✓</span>' if v else '<span class="box"></span>'
        if t in ("date", "created_time", "edited_time"):
            if isinstance(v, dict):
                s = _fmt_date(v.get("start"), self.lang)
                return esc(s + (" → " + _fmt_date(v["end"], self.lang) if v.get("end") else ""))
            return esc(_fmt_date(v, self.lang))
        if t == "relation":
            out = []
            for x in v if isinstance(v, list) else []:
                if x in self._ids:
                    title, icon = self._titles.get(x, ("", ""))
                    label = f'{esc(icon or "📄")} {esc(title or self.t["untitled"])}'
                    out.append(f'<a class="mention" href="{esc(self.url(self._token, x))}">{label}</a>' if links
                               else f'<span class="mention">{label}</span>')
            return " ".join(out)
        if t in ("url", "email") and not links:
            return esc(v)
        if t == "url":
            return f'<a href="{esc(v)}" rel="noopener noreferrer nofollow" target="_blank">{esc(v)}</a>' \
                if SAFE_HREF.match(str(v)) else esc(v)
        if t == "email":
            return f'<a href="mailto:{esc(v)}">{esc(v)}</a>'
        if t == "number":
            if isinstance(v, (int, float)):
                s = ("%g" % v) if abs(v) < 1e15 else str(v)
                if self.lang == "fr":
                    s = s.replace(".", ",")
                return esc(s + (" %" if p.get("format") == "percent" else " €" if p.get("format") == "euro" else ""))
            return esc(v)
        return esc(v).replace("\n", "<br>")


# ---------------------------------------------------------------------- helpers
def _nest(kids):
    return f'<div class="nest">{kids}</div>' if kids else ""


def _plain(items) -> str:
    if isinstance(items, str):
        return items
    out = []
    for it in items or []:
        if isinstance(it, dict):
            if it.get("type") == "text":
                out.append(it.get("text", ""))
            elif it.get("type") == "link":
                out.append(_plain(it.get("content")))
            elif it.get("type") == "pageMention":
                out.append((it.get("props") or {}).get("title", ""))
    return "".join(out)


def _styled(text, st) -> str:
    if not text:
        return ""
    s = esc(text).replace("\n", "<br>")
    if st.get("code"):
        return f"<code>{s}</code>"
    if st.get("bold"):
        s = f"<strong>{s}</strong>"
    if st.get("italic"):
        s = f"<em>{s}</em>"
    if st.get("underline"):
        s = f"<u>{s}</u>"
    if st.get("strike"):
        s = f"<s>{s}</s>"
    if st.get("textColor") in COLORS:
        s = f'<span class="c-{st["textColor"]}">{s}</span>'
    bg = st.get("backgroundColor")
    if bg in COLORS:
        s = f'<mark class="bg-{bg}">{s}</mark>'
    elif bg and bg != "default":
        s = f"<mark>{s}</mark>"
    return s


def _tag(o) -> str:
    color = o.get("color") if o.get("color") in COLORS else "gray"
    return f'<span class="tag t-{color}">{esc(o.get("name"))}</span>'


def _fmt_date(s, lang) -> str:
    if not s or not isinstance(s, str):
        return ""
    try:
        if len(s) <= 10:
            d = dt.date.fromisoformat(s[:10])
            return d.strftime("%d/%m/%Y") if lang == "fr" else d.isoformat()
        x = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if x.tzinfo:
            x = x.astimezone()
        if "T" in s and (s.endswith("Z") or x.hour or x.minute):
            return x.strftime("%d/%m/%Y %H:%M") if lang == "fr" else x.strftime("%Y-%m-%d %H:%M")
        return x.strftime("%d/%m/%Y") if lang == "fr" else x.strftime("%Y-%m-%d")
    except ValueError:
        return s


def _value(row, p):
    if p.get("type") == "created_time":
        return row.get("created_at")
    if p.get("type") == "edited_time":
        return row.get("updated_at")
    return (row.get("props") or {}).get(p["id"])


def _date_key(v) -> str:
    if not v:
        return ""
    if isinstance(v, str):
        if v.endswith("Z"):
            try:
                return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")
            except ValueError:
                return v[:10]
        return v[:10]
    return (v.get("start") or "")[:10] if isinstance(v, dict) else ""


def _empty(v) -> bool:
    return v is None or v == "" or v == [] or v == {}


def _text(row, p) -> str:
    v = _value(row, p)
    if v in (None, ""):
        return ""
    opts = {o["id"]: o.get("name", "") for o in p.get("options") or []}
    t = p.get("type")
    if t in ("select", "status"):
        return opts.get(v, "")
    if t == "multi_select":
        return ", ".join(opts.get(x, "") for x in v) if isinstance(v, list) else ""
    if t == "checkbox":
        return "✓" if v else ""
    if t == "date":
        return v.get("start", "") if isinstance(v, dict) else str(v)
    return str(v)


def match_filter(row, f, schema) -> bool:
    """Same rules as matchFilter() in web/src/db/model.ts."""
    pid = f.get("prop")
    if pid == "__title":
        p, v, typ = None, row.get("title"), "title"
    else:
        p = next((x for x in schema["properties"] if x["id"] == pid), None)
        if p is None:
            return True
        v, typ = _value(row, p), p["type"]
    op, want = f.get("op"), f.get("value")
    if op == "empty":
        return _empty(v)
    if op == "not_empty":
        return not _empty(v)
    if op == "checked":
        return bool(v)
    if op == "unchecked":
        return not v
    if want is None or want == "":
        return True
    if typ == "number":
        try:
            a, b = float(v), float(want)
        except (TypeError, ValueError):
            return op == "ne"
        return {"eq": a == b, "ne": a != b, "gt": a > b, "lt": a < b, "gte": a >= b, "lte": a <= b}.get(op, True)
    if typ in ("select", "status"):
        return v == want if op == "is" else v != want
    if typ in ("multi_select", "relation"):
        has = isinstance(v, list) and want in v
        return has if op == "contains" else not has
    if typ in ("date", "created_time", "edited_time"):
        a = _date_key(v)
        b = dt.date.today().isoformat() if want == "today" else str(want)
        if not a:
            return False
        return {"is": a == b, "before": a < b, "after": a > b, "on_before": a <= b, "on_after": a >= b}.get(op, True)
    s = (str(v or "") if typ == "title" else _text(row, p)).lower()
    w = str(want).lower()
    return {"contains": w in s, "not_contains": w not in s, "is": s == w, "is_not": s != w}.get(op, True)


def apply_view(rows, view, schema):
    filters = view.get("filters") or []
    if filters:
        test = any if view.get("filter_mode") == "or" else all
        rows = [r for r in rows if test(match_filter(r, f, schema) for f in filters)]
    for s in reversed(view.get("sorts") or []):
        pid = s.get("prop")
        p = next((x for x in schema["properties"] if x["id"] == pid), None)

        def key(r, p=p, pid=pid):
            if pid == "__title":
                v = (r.get("title") or "").lower()
            elif p is None:
                return (1, "")
            else:
                v = _value(r, p)
                if _empty(v):
                    return (1, "")
                if p["type"] == "number":
                    try:
                        return (0, float(v))
                    except (TypeError, ValueError):
                        return (1, "")
                if p["type"] in ("select", "status"):
                    ids = [o["id"] for o in p.get("options") or []]
                    return (0, ids.index(v) if v in ids else 0)
                if p["type"] == "checkbox":
                    return (0, 1 if v else 0)
                v = _date_key(v) if p["type"] in ("date", "created_time", "edited_time") else _text(r, p).lower()
            return (0, v)
        desc = s.get("dir") == "desc"
        full = [r for r in rows if key(r)[0] == 0]
        blank = [r for r in rows if key(r)[0] == 1]
        rows = sorted(full, key=lambda r: key(r)[1], reverse=desc) + blank   # empty values last, like the app
    return rows


def valid_id(pid) -> bool:
    return bool(pid and ID.match(pid))
