"""Markdown <-> BlockNote blocks, plain text extraction and page references.

The editor stores pages as BlockNote JSON blocks. Markdown is how pages go in and
out: the API accepts ``markdown`` instead of ``content``, imports read Obsidian /
Notion-export / Joplin files, exports write ``.md`` files.

Custom blocks shared with the web app (``web/src/editor/schema.tsx``):

* ``callout``  props ``emoji``, ``color``; inline content
* ``math``     props ``latex``                      (``$$ ... $$``)
* ``pageLink`` props ``pageId``                     (a sub-page)
* ``database`` props ``pageId``                     (an inline database)
* ``embed``    props ``url``
* inline ``pageMention`` props ``pageId``, ``title`` (``[[Title]]``)
* inline ``inlineMath``  props ``latex``             (``$ ... $``)
"""
from __future__ import annotations

import re
import threading
from typing import Callable, Optional

Resolver = Optional[Callable[[str], Optional[str]]]

DEFAULT_PROPS = {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}
CALLOUT_EMOJI = {"note": "📝", "info": "ℹ️", "tip": "💡", "hint": "💡", "important": "❗", "warning": "⚠️",
                 "caution": "⚠️", "danger": "🔥", "error": "⛔", "success": "✅", "check": "✅", "done": "✅",
                 "question": "❓", "faq": "❓", "help": "❓", "example": "🧪", "quote": "💬", "cite": "💬",
                 "abstract": "📋", "summary": "📋", "tldr": "📋", "todo": "☑️", "bug": "🐞", "failure": "❌"}
CALLOUT_COLOR = {"warning": "yellow", "caution": "yellow", "danger": "red", "error": "red", "failure": "red",
                 "bug": "red", "success": "green", "check": "green", "done": "green", "tip": "green",
                 "info": "blue", "note": "blue", "question": "purple", "example": "purple", "important": "orange"}
EMOJI_NAME: dict = {}
for _k, _v in CALLOUT_EMOJI.items():
    EMOJI_NAME.setdefault(_v, _k)


# ====================================================================== frontmatter
def split_frontmatter(text: str) -> tuple[dict, str]:
    """``---\\nkey: value\\n---`` at the top of a file -> (dict, rest). A tiny YAML subset."""
    text = text.lstrip("\ufeff")
    m = re.match(r"^---[ \t]*\r?\n(?:(.*?)\r?\n)?---[ \t]*(?:\r?\n|$)", text, re.S)
    if not m:
        return {}, text
    data: dict = {}
    key = None
    for line in (m.group(1) or "").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s*-\s+(.*)$", line)
        if item and key:
            if not isinstance(data.get(key), list):
                data[key] = []
            data[key].append(_scalar(item.group(1)))
            continue
        kv = re.match(r"^([^:#][^:]*):\s*(.*)$", line)
        if kv:
            key = kv.group(1).strip()
            val = kv.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                data[key] = [_scalar(x) for x in _split_list(val[1:-1])]
            elif val == "":
                data[key] = None
            else:
                data[key] = _scalar(val)
    return data, text[m.end():]


def _split_list(s):
    out, cur, q = [], "", None
    for ch in s:
        if q:
            cur += ch
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
            cur += ch
        elif ch == ",":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return [x.strip() for x in out if x.strip()]


def _scalar(v: str):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    low = v.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if re.fullmatch(r"-?\d+(\.\d+)?", v):
        return float(v) if "." in v else int(v)
    return v


# ====================================================================== inline parsing
#  Every quantifier that can scan far is bounded (or anchored on a run start) so that a long line of unmatched
#  delimiters costs roughly linear time, not quadratic (20 000 x "[a](" used to take 49 s). A span longer than the
#  bound is simply not formatted: it stays literal text.
_HREF = r"(?:[^()\s]|\([^()\s]*\))+"                       # a URL, parentheses balanced one level deep
INLINE_RE = re.compile(
    r"(?<!`)(?P<code>`+)(?!`)(?P<codetext>.{1,1000}?)(?<!`)(?P=code)(?!`)"
    r"|(?P<math>(?<![\\$])\$(?!\s)(?P<mathtext>[^$\n]{1,1000}?)(?<!\s)\$(?!\d))"
    r"|(?P<wiki>!?\[\[(?P<wikitext>[^\]\n]{1,200}?)\]\])"
    r"|(?P<img>!\[(?P<imgalt>[^\]\n]{0,300})\]\((?P<imgsrc>" + _HREF + r")(?:\s+\"[^\"\n]{0,300}\")?\))"
    r"|(?P<link>\[(?P<linktext>[^\]\n]{1,300})\]\((?P<linkhref>" + _HREF + r")(?:\s+\"[^\"\n]{0,300}\")?\))"
    r"|(?P<auto><(?P<autohref>https?://[^>\s]{1,2000})>)"
    r"|(?P<url>(?<![\w(\[<])https?://(?:[^\s<>()\[\]]|\([^\s<>()\[\]]*\))*"
    r"(?:[^\s<>()\[\].,;:!?\"'\s]|\([^\s<>()\[\]]*\)))"
    r"|(?P<bi>\*\*\*(?P<bitext>.{1,400}?)\*\*\*)"
    r"|(?P<b>\*\*(?P<btext>.{1,400}?)\*\*|__(?P<btext2>[^_].{0,400}?)__)"
    r"|(?P<i>(?<![\w*])\*(?![\s*])(?P<itext>.{1,400}?)(?<![\s*])\*(?!\*)|(?<![\w_])_(?![\s_])(?P<itext2>.{1,400}?)(?<![\s_])_(?![\w_]))"
    r"|(?P<s>~~(?P<stext>.{1,400}?)~~)"
    r"|(?P<hl>==(?P<hltext>[^=\n]+?)==)"
    r"|(?P<u><u>(?P<utext>.{1,400}?)</u>)"
    r"|(?P<br><br\s*/?>)"
    r"|(?P<esc>\\(?P<escch>[\\`*_{}\[\]()#+\-.!|$~=<>]))"
)


def parse_inline(text: str, resolve: Resolver = None, styles: dict | None = None) -> list:
    """Markdown inline syntax -> BlockNote inline content."""
    styles = dict(styles or {})
    out: list = []

    def add_text(t, st=None):
        if not t:
            return
        st = st if st is not None else styles
        if out and out[-1].get("type") == "text" and out[-1]["styles"] == st:
            out[-1]["text"] += t
        else:
            out.append({"type": "text", "text": t, "styles": dict(st)})

    pos = 0
    for m in INLINE_RE.finditer(text):
        add_text(text[pos:m.start()])
        pos = m.end()
        g = m.groupdict()
        if g["code"]:
            # BlockNote's code mark excludes every other mark (bold + code would break the page)
            add_text(g["codetext"].strip(" ") if g["codetext"].strip(" ") else g["codetext"], {"code": True})
        elif g["math"]:
            out.append({"type": "inlineMath", "props": {"latex": g["mathtext"]}})
        elif g["wiki"]:
            target, alias = _split_wiki(g["wikitext"])
            full = _unescape_wiki(target).strip()
            head = _unescape_wiki(re.split(r"(?<!\\)#", target, maxsplit=1)[0]).strip()
            pid, title = (resolve(full), full) if resolve and full else (None, full)
            if not pid and resolve and head and head != full:          # [[Note#Section]]
                pid, title = resolve(head), head
            if pid:
                out.append({"type": "pageMention", "props": {"pageId": pid, "title": alias or title}})
            else:
                add_text(alias or full)
        elif g["img"] and not re.match(r"^(https?:|/|data:image/)", g["imgsrc"]) and re.match(r"^[a-z][a-z0-9+.-]*:", g["imgsrc"], re.I):
            add_text(g["imgalt"])
        elif g["img"]:
            out.append({"type": "link", "href": g["imgsrc"],
                        "content": [{"type": "text", "text": g["imgalt"] or g["imgsrc"], "styles": dict(styles)}]})
        elif g["link"]:
            href = g["linkhref"]
            if re.match(r"^[a-z][a-z0-9+.-]*:", href, re.I) and not re.match(r"^(https?|mailto|tel|obsidian|file):", href, re.I):
                add_text(g["linktext"])                    # javascript:, data:… links are dropped
                continue
            inner = parse_inline(g["linktext"], resolve, styles)
            pid = resolve("@link:" + href) if resolve and not re.match(r"^[a-z]+:", href) else None
            if pid:
                out.append({"type": "pageMention", "props": {"pageId": pid, "title": _plain(inner)}})
            else:
                out.append({"type": "link", "href": href,
                            "content": [x for x in inner if x.get("type") == "text"] or
                            [{"type": "text", "text": href, "styles": {}}]})
        elif g["auto"] or g["url"]:
            href = g["autohref"] or g["url"]
            out.append({"type": "link", "href": href, "content": [{"type": "text", "text": href, "styles": dict(styles)}]})
        elif g["bi"]:
            out.extend(parse_inline(g["bitext"], resolve, {**styles, "bold": True, "italic": True}))
        elif g["b"]:
            out.extend(parse_inline(g["btext"] or g["btext2"], resolve, {**styles, "bold": True}))
        elif g["i"]:
            out.extend(parse_inline(g["itext"] or g["itext2"], resolve, {**styles, "italic": True}))
        elif g["s"]:
            out.extend(parse_inline(g["stext"], resolve, {**styles, "strike": True}))
        elif g["hl"]:
            out.extend(parse_inline(g["hltext"], resolve, {**styles, "backgroundColor": "yellow"}))
        elif g["u"]:
            out.extend(parse_inline(g["utext"], resolve, {**styles, "underline": True}))
        elif g["br"]:
            add_text("\n")
        elif g["esc"]:
            add_text(g["escch"])
    add_text(text[pos:])
    return _merge(out)


def _split_wiki(raw: str) -> tuple[str, str]:
    """``[[target|alias]]`` -> (target, alias); ``\\|`` is a literal pipe in a title (Carnet's own export)."""
    m = re.search(r"(?<!\\)\|", raw)
    if not m:
        return raw, ""
    return raw[:m.start()], raw[m.end():].strip()


def _unescape_wiki(s: str) -> str:
    return s.replace("\\#", "#").replace("\\|", "|")


def _wiki(title: str) -> str:
    """A page title as a ``[[link]]`` target: ``#`` and ``|`` are escaped so that the link reads back whole."""
    return "[[" + re.sub(r"([#|])", r"\\\1", title) + "]]"


def _merge(items):
    out = []
    for it in items:
        if out and it.get("type") == "text" and out[-1].get("type") == "text" and out[-1]["styles"] == it["styles"]:
            out[-1]["text"] += it["text"]
        else:
            out.append(it)
    return out


def _plain(inline) -> str:
    if isinstance(inline, str):
        return inline
    out = []
    for it in inline if isinstance(inline, list) else []:
        if not isinstance(it, dict):
            continue
        t = it.get("type")
        if t == "text":
            out.append(str(it.get("text", "")))
        elif t == "link":
            out.append(_plain(it.get("content")))
        elif t == "pageMention":
            out.append(str((it.get("props") or {}).get("title", "")))
        elif t == "inlineMath":
            out.append(str((it.get("props") or {}).get("latex", "")))
    return "".join(out)


# ====================================================================== block parsing
def _block(type_, content=None, props=None, children=None):
    b = {"type": type_, "props": {**(DEFAULT_PROPS if type_ not in NO_DEFAULT_PROPS else {}), **(props or {})},
         "children": children or []}
    if content is not None:
        b["content"] = content
    return b


NO_DEFAULT_PROPS = {"image", "file", "video", "audio", "math", "pageLink", "database", "embed", "divider", "codeBlock",
                    "table"}

FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$")
BULLET = re.compile(r"^(\s*)([-*+])\s+(.*)$")
ORDERED = re.compile(r"^(\s*)(\d{1,9})[.)]\s+(.*)$")
CHECK = re.compile(r"^\[([ xX])\]\s*(.*)$")
HR = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
IMG_LINE = re.compile(r"^\s*!\[(?P<alt>[^\]]*)\]\((?P<src>[^)\s]+)(?:\s+\"[^\"]*\")?\)\s*$")
EMBED_LINE = re.compile(r"^\s*!\[\[(?P<name>[^\]|]+)(?:\|(?P<size>[^\]]*))?\]\]\s*$")
CALLOUT = re.compile(r"^\[!(\w+)\][+-]?\s*(.*)$")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif")
VIDEO_EXT = (".mp4", ".webm", ".mov", ".ogv")
AUDIO_EXT = (".mp3", ".wav", ".ogg", ".m4a", ".flac")


def to_blocks(text: str, resolve: Resolver = None, resolve_file: Resolver = None) -> list:
    """Markdown -> BlockNote blocks.

    ``resolve(title)`` returns a page id for ``[[wiki links]]`` (or ``"@link:" + href`` for relative links),
    ``resolve_file(name)`` returns a URL for ``![[embeds]]`` and relative images.
    """
    _, body = split_frontmatter(text or "")
    lines = _untab(body.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    return _parse_blocks(lines, resolve, resolve_file)


def _untab(lines: list) -> list:
    """Tabs become spaces (list nesting counts spaces), except inside code fences where they are content."""
    out, fence = [], None
    for line in lines:
        if fence is None:
            fm = FENCE.match(line)
            if fm:
                fence = fm.group(2)
            else:
                line = line.replace("\t", "    ")
        elif line.strip().startswith(fence):
            fence = None
        out.append(line)
    return out


MAX_NESTING = 40                 # quotes / lists / toggles nested deeper are kept as plain text
_nesting = threading.local()


def _parse_blocks(lines, resolve, resolve_file) -> list:
    depth = getattr(_nesting, "depth", 0)
    if depth >= MAX_NESTING:
        text = "\n".join(s.strip() for s in lines if s.strip())
        return [_block("paragraph", parse_inline(text, resolve))] if text else []
    _nesting.depth = depth + 1
    try:
        return _parse_blocks_at(lines, resolve, resolve_file)
    finally:
        _nesting.depth = depth


def _parse_blocks_at(lines, resolve, resolve_file) -> list:
    out: list = []
    i, n = 0, len(lines)
    para: list[str] = []

    def flush():
        if para:
            text = "\n".join(s.strip() for s in para)
            out.append(_block("paragraph", parse_inline(text, resolve)))
            para.clear()

    while i < n:
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            flush()
            i += 1
            continue
        fm = FENCE.match(line)
        if fm:
            flush()
            fence, lang = fm.group(2), fm.group(3).lower()
            body = []
            i += 1
            while i < n and not lines[i].strip().startswith(fence):
                body.append(lines[i][len(fm.group(1)):] if lines[i].startswith(fm.group(1)) else lines[i])
                i += 1
            i += 1
            code = "\n".join(body)
            if lang in ("math", "latex", "tex", "katex"):
                out.append(_block("math", None, {"latex": code}))
            elif lang == "mermaid":
                out.append(_block("codeBlock", [{"type": "text", "text": code, "styles": {}}], {"language": "mermaid"}))
            else:
                out.append(_block("codeBlock", [{"type": "text", "text": code, "styles": {}}] if code else [],
                                  {"language": _lang(lang)}))
            continue
        if stripped.startswith("$$"):
            flush()
            rest = stripped[2:]
            close = rest.find("$$")
            if close >= 0:                                  # "$$ x $$" on one line
                out.append(_block("math", None, {"latex": rest[:close].strip()}))
                tail = rest[close + 2:].strip()
                if tail:
                    out.extend(_parse_blocks([tail], resolve, resolve_file))
                i += 1
                continue
            body = [rest] if rest else []
            j = i + 1
            while j < n and "$$" not in lines[j]:
                body.append(lines[j])
                j += 1
            if j >= n:                                      # never closed: plain text, nothing swallowed
                para.append(line)
                i += 1
                continue
            before, _, after = lines[j].partition("$$")
            if before.strip():
                body.append(before)
            out.append(_block("math", None, {"latex": "\n".join(body).strip()}))
            i = j + 1
            if after.strip():
                out.extend(_parse_blocks([after.strip()], resolve, resolve_file))
            continue
        hm = HEADING.match(stripped) if not line.startswith("    ") else None
        if hm:
            flush()
            level = min(len(hm.group(1)), 3)
            out.append(_block("heading", parse_inline(hm.group(2), resolve), {"level": level}))
            i += 1
            continue
        if HR.match(line):
            flush()
            out.append(_block("divider"))
            i += 1
            continue
        if stripped.lower().startswith("<details"):
            flush()
            j = i
            chunk = []
            while j < n:
                chunk.append(lines[j])
                if "</details>" in lines[j].lower():
                    break
                j += 1
            raw = "\n".join(chunk)
            sm = re.search(r"<summary>(.*?)</summary>", raw, re.S | re.I)
            summary = sm.group(1).strip() if sm else "Details"
            inner = re.sub(r"(?is)^.*?</summary>|<details[^>]*>|</details>", "", raw if sm else raw)
            out.append(_block("toggleListItem", parse_inline(summary, resolve),
                              children=_parse_blocks(inner.strip("\n").split("\n"), resolve, resolve_file)))
            i = j + 1
            continue
        if stripped.startswith(">"):
            flush()
            quote = []
            while i < n and lines[i].strip().startswith(">"):
                quote.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            cm = CALLOUT.match(quote[0].strip()) if quote else None
            if cm:
                kind = cm.group(1).lower()
                title = cm.group(2).strip()
                rest = quote[1:]
                mark = _CALLOUT_MARK.match(rest[0].strip()) if rest else None
                props = _mark_props(mark.group(1)) if mark else {}
                if mark:
                    rest = rest[1:]
                inner = _parse_blocks(rest, resolve, resolve_file)
                first = parse_inline(title, resolve, {"bold": True}) if title else []
                children = inner
                if inner and inner[0]["type"] == "paragraph":
                    # "> [!tip] Title" + one paragraph -> one callout: bold title, line break, text (like Notion)
                    head = inner[0].get("content", [])
                    first = _merge(first + [{"type": "text", "text": "\n", "styles": {}}] + head) if first else head
                    children = inner[1:]
                out.append(_block("callout", first, {"emoji": props.get("emoji", CALLOUT_EMOJI.get(kind, "💡")),
                                                     "color": props.get("color", CALLOUT_COLOR.get(kind, "gray"))},
                                  children))
            else:
                em = re.match(r"^(\S{1,8}?)\s+(.*)", quote[0].strip()) if quote else None
                if em and _is_emoji(em.group(1)):
                    inner = _parse_blocks([em.group(2)] + quote[1:], resolve, resolve_file)
                    first = inner[0].get("content", []) if inner and inner[0]["type"] == "paragraph" else []
                    out.append(_block("callout", first, {"emoji": em.group(1), "color": "gray"},
                                      inner[1:] if first else inner))
                else:
                    inner = _parse_blocks(quote, resolve, resolve_file)
                    if len(inner) == 1 and inner[0]["type"] == "paragraph":
                        out.append(_block("quote", inner[0].get("content", [])))
                    else:
                        texts = [b for b in inner if b.get("content") is not None and isinstance(b.get("content"), list)]
                        first = texts[0]["content"] if texts else []
                        out.append(_block("quote", first, children=[b for b in inner if b is not (texts[0] if texts else None)]))
            continue
        if BULLET.match(line) or ORDERED.match(line):
            flush()
            items, i = _parse_list(lines, i, resolve, resolve_file)
            out.extend(items)
            continue
        if "|" in stripped and i + 1 < n and TABLE_SEP.match(lines[i + 1]):
            flush()
            rows = [_cells(stripped)]
            i += 2
            while i < n and "|" in lines[i] and lines[i].strip():
                rows.append(_cells(lines[i].strip()))
                i += 1
            width = max(len(r) for r in rows)
            out.append(_block("table", {
                "type": "tableContent", "columnWidths": [None] * width, "headerRows": 1,
                "rows": [{"cells": [_cell(parse_inline(c, resolve)) for c in r + [""] * (width - len(r))]}
                         for r in rows]}))
            continue
        em = EMBED_LINE.match(line)
        if em:
            flush()
            out.append(_embed_block(em.group("name").strip(), em.group("size"), resolve, resolve_file))
            i += 1
            continue
        im = IMG_LINE.match(line)
        if im:
            flush()
            src = im.group("src")
            url = _safe_src(src, resolve_file)
            if url:
                out.append(_file_block(url, im.group("alt") or src.rsplit("/", 1)[-1], caption=im.group("alt") or ""))
            elif im.group("alt"):
                out.append(_block("paragraph", [{"type": "text", "text": im.group("alt"), "styles": {}}]))
            i += 1
            continue
        para.append(line)
        i += 1
    flush()
    return out


def _safe_src(src: str, resolve_file: Resolver) -> Optional[str]:
    if src.startswith("/files/") or re.match(r"^https?://", src, re.I):
        return src
    if src.startswith("//") or re.match(r"^[a-z][a-z0-9+.-]*:", src, re.I):
        return None
    return (resolve_file(src) if resolve_file else None) or src


def _embed_block(name, size, resolve, resolve_file):
    low = name.lower()
    if low.endswith(IMAGE_EXT + VIDEO_EXT + AUDIO_EXT + (".pdf",)) or "." in low.rsplit("/", 1)[-1][-6:]:
        url = (resolve_file(name) if resolve_file else None)
        if url:
            b = _file_block(url, name.rsplit("/", 1)[-1])
            if size and size.strip().isdigit() and b["type"] == "image":
                b["props"]["previewWidth"] = int(size.strip())
            return b
    pid = resolve(name.split("#")[0]) if resolve else None
    if pid:
        return _block("paragraph", [{"type": "pageMention", "props": {"pageId": pid, "title": name}}])
    return _block("paragraph", [{"type": "text", "text": name, "styles": {}}])


def _file_block(url, name, caption=""):
    low = url.lower().split("?")[0]
    kind = "image" if low.endswith(IMAGE_EXT) or url.startswith("data:image") else \
        "video" if low.endswith(VIDEO_EXT) else "audio" if low.endswith(AUDIO_EXT) else "file"
    props = {"url": url, "name": name, "caption": caption}
    if kind in ("image", "video"):
        props["showPreview"] = True
    if kind == "image":
        props["textAlignment"] = "left"
        props["backgroundColor"] = "default"
    return {"type": kind, "props": props, "children": []}


def _cells(row: str) -> list[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|") and not row.endswith("\\|"):
        row = row[:-1]
    cells, cur, esc = [], "", False
    for ch in row:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
            cur += ch
        elif ch == "|":
            cells.append(cur.strip())
            cur = ""
        else:
            cur += ch
    cells.append(cur.strip())
    return [c.replace("\\|", "|") for c in cells]


def _cell(content):
    return {"type": "tableCell", "content": content,
            "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left",
                      "colspan": 1, "rowspan": 1}}


def _indent(s: str) -> int:
    return len(s) - len(s.lstrip(" "))


def _parse_list(lines, i, resolve, resolve_file):
    """A list starting at line i (any nesting) -> (blocks, next index)."""
    n = len(lines)
    base = _indent(lines[i])
    items: list = []
    while i < n:
        line = lines[i]
        if not line.strip():
            # a blank line inside a list continues it only if the next line is indented or another item
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n and (_indent(lines[j]) > base or (_indent(lines[j]) == base and (BULLET.match(lines[j]) or ORDERED.match(lines[j])))):
                i = j
                continue
            break
        ind = _indent(line)
        bm, om = BULLET.match(line), ORDERED.match(line)
        if ind < base or (ind == base and not (bm or om)):
            break
        if ind > base and items:
            # nested content of the last item
            j = i
            sub = []
            while j < n and (not lines[j].strip() or _indent(lines[j]) > base):
                sub.append(lines[j])
                j += 1
            while sub and not sub[-1].strip():
                sub.pop()
                j -= 1
            cut = min(_indent(s) for s in sub if s.strip())
            items[-1]["children"].extend(_parse_blocks([s[cut:] for s in sub], resolve, resolve_file))
            i = j
            continue
        if bm:
            text = bm.group(3)
            cm = CHECK.match(text)
            if cm:
                items.append(_block("checkListItem", parse_inline(cm.group(2), resolve), {"checked": cm.group(1) != " "}))
            else:
                items.append(_block("bulletListItem", parse_inline(text, resolve)))
        elif om:
            props = {}
            if not items or items[-1]["type"] != "numberedListItem":
                start = int(om.group(2))
                if start != 1:
                    props["start"] = start
            items.append(_block("numberedListItem", parse_inline(om.group(3), resolve), props))
        i += 1
    return items, i


LANGS = {"sh": "shellscript", "bash": "shellscript", "shell": "shellscript", "zsh": "shellscript", "console": "shellscript", "py": "python", "js": "javascript",
         "ts": "typescript", "yml": "yaml", "md": "markdown", "ps1": "powershell", "ps": "powershell",
         "cs": "csharp", "c#": "csharp", "c++": "cpp", "rb": "ruby", "rs": "rust", "kt": "kotlin", "golang": "go",
         "htm": "html", "xml": "xml", "conf": "ini", "cisco": "text", "ios": "text", "txt": "text", "": "text"}


def _lang(lang: str) -> str:
    return LANGS.get(lang, lang or "text")


_EMOJI = re.compile("[\u00a9\u00ae\u203c\u2049\u2122\u2139\u2194-\u2199\u21a9\u21aa\u231a\u231b\u2328"
                    "\u23cf\u23e9-\u23f3\u23f8-\u23fa\u24c2\u25aa\u25ab\u25b6\u25c0\u25fb-\u25fe"
                    "\u2600-\u27bf\u2934\u2935\u2b05-\u2b07\u2b1b\u2b1c\u2b50\u2b55\u3030\u303d\u3297"
                    "\u3299\U0001f000-\U0001faff]")
_EMOJI_JOIN = "\ufe0f\u200d\u20e3"


def _is_emoji(s: str) -> bool:
    """A real emoji (symbol ranges, not every non-ASCII character: '—', '→', '•' open quotes, not callouts)."""
    return bool(s) and bool(_EMOJI.match(s)) and all(_EMOJI.fullmatch(c) or c in _EMOJI_JOIN for c in s)


_CALLOUT_MARK = re.compile(r"^<!--\s*carnet:\s*(.*?)\s*-->$")


def _mark_props(text: str) -> dict:
    props = {}
    for tok in text.split():
        key, _, val = tok.partition("=")
        if key == "emoji" and val and _is_emoji(val):
            props["emoji"] = val
        elif key == "color" and re.fullmatch(r"[a-z]{2,12}", val):
            props["color"] = val
    return props


def _callout_mark(emoji: str, color: str, kind: str) -> str:
    """Only what the Obsidian callout type does not already say: ``<!-- carnet: emoji=… color=… -->``."""
    parts = []
    if emoji != CALLOUT_EMOJI.get(kind):
        parts.append("emoji=" + re.sub(r"[\s<>-]", "", emoji)[:16])
    if color != CALLOUT_COLOR.get(kind, "gray"):
        parts.append("color=" + re.sub(r"[^a-z]", "", color)[:12])
    return f"<!-- carnet: {' '.join(parts)} -->" if parts else ""


# ====================================================================== export
def to_markdown(blocks: list, title_of: Resolver = None, url_of: Resolver = None) -> str:
    """BlockNote blocks -> Markdown (GFM + Obsidian-style callouts, wiki links and math)."""
    return _blocks_md(blocks or [], 0, title_of, url_of).strip("\n") + "\n"


def _blocks_md(blocks, depth, title_of, url_of) -> str:
    parts: list[str] = []
    prev = None
    num = 0
    for b in blocks if isinstance(blocks, list) else []:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        try:
            num = num + 1 if t == "numberedListItem" and prev == "numberedListItem" else \
                (int((b.get("props") or {}).get("start") or 1) if t == "numberedListItem" else 0)
            s = _block_md(b, depth, num, title_of, url_of)
        except (AttributeError, TypeError, ValueError, KeyError):
            s = None                                  # a malformed block (API write) is skipped, never a 500
        if s is None:
            continue
        listy = t in ("bulletListItem", "numberedListItem", "checkListItem")
        sep = "\n" if (listy and prev in ("bulletListItem", "numberedListItem", "checkListItem")) else "\n\n"
        parts.append((sep if parts else "") + s)
        prev = t
    return "".join(parts)


def _indent_block(s, pad):
    return "\n".join((pad + line) if line.strip() else line for line in s.split("\n"))


def _block_md(b, depth, num, title_of, url_of):
    t = b.get("type")
    p = b.get("props") or {}
    c = b.get("content")
    kids = b.get("children") or []
    inline = inline_md(c, title_of) if isinstance(c, list) else ""
    child_md = _blocks_md(kids, depth + 1, title_of, url_of) if kids else ""
    if t == "paragraph":
        s = inline
        return s + ("\n\n" + child_md if child_md else "")
    if t == "heading":
        level = int(p.get("level") or 1)
        s = "#" * max(1, min(level, 6)) + " " + inline
        return s + ("\n\n" + child_md if child_md else "")
    if t == "toggleListItem":
        summary = inline.replace("\n", " ")
        inner = "\n\n" + child_md + "\n\n" if child_md else "\n\n"
        return f"<details>\n<summary>{summary}</summary>{inner}</details>"
    if t in ("bulletListItem", "numberedListItem", "checkListItem"):
        marker = {"bulletListItem": "- ", "numberedListItem": f"{num or 1}. ",
                  "checkListItem": "- [x] " if p.get("checked") else "- [ ] ", "toggleListItem": "- "}[t]
        s = marker + inline.replace("\n", "\n" + " " * len(marker))
        if child_md:
            s += "\n" + _indent_block(child_md, " " * (2 if t != "numberedListItem" else len(marker)))
        return s
    if t == "quote":
        body = inline + ("\n\n" + child_md if child_md else "")
        return "\n".join("> " + line if line else ">" for line in body.split("\n"))
    if t == "callout":
        emoji = p.get("emoji") or "💡"
        kind = EMOJI_NAME.get(emoji, "note")
        items = c if isinstance(c, list) else []
        title, rest = "", items
        if len(items) >= 2 and items[0].get("type") == "text" and (items[0].get("styles") or {}).get("bold") \
                and items[1].get("type") == "text" and items[1].get("text", "").startswith("\n"):
            title = items[0]["text"]
            rest = [{**items[1], "text": items[1]["text"][1:]}] + items[2:]
            inline = inline_md(rest, title_of)
        if title:
            head = f"> [!{kind}] {title}"
            body = inline + ("\n\n" + child_md if child_md else "")
        else:
            head = f"> [!{kind}]" + (f" {inline}" if inline and "\n" not in inline else "")
            body = ("" if inline and "\n" not in inline else inline) + ("\n\n" + child_md if child_md else "")
        mark = _callout_mark(emoji, p.get("color") or "gray", kind)
        if mark:
            body = mark + ("\n" + body.lstrip("\n") if body.strip() else "")
        lines = [head] + [("> " + line if line else ">") for line in body.strip("\n").split("\n")] if body.strip() else [head]
        return "\n".join(lines)
    if t == "codeBlock":
        code = _plain(c) if isinstance(c, list) else ""
        lang = {"shellscript": "bash"}.get(p.get("language") or "", p.get("language") or "")
        fence = "````" if "```" in code else "```"
        return f"{fence}{'' if lang == 'text' else lang}\n{code}\n{fence}"
    if t == "math":
        return "$$\n" + (p.get("latex") or "") + "\n$$"
    if t == "divider":
        return "---"
    if t == "pageBreak":
        return "---"
    if t == "table":
        rows = (c or {}).get("rows", []) if isinstance(c, dict) else []
        if not rows:
            return None
        cells = [[re.sub(r"(?<!\\)\|", r"\\|", inline_md(cell.get("content") if isinstance(cell, dict) else cell, title_of))
                  .replace("\n", "<br>") for cell in r.get("cells", [])] for r in rows]
        width = max(len(r) for r in cells)
        cells = [r + [""] * (width - len(r)) for r in cells]
        head = "| " + " | ".join(cells[0]) + " |"
        sep = "| " + " | ".join(["---"] * width) + " |"
        body = ["| " + " | ".join(r) + " |" for r in cells[1:]]
        return "\n".join([head, sep] + body)
    if t in ("image", "video", "audio", "file"):
        url = p.get("url") or ""
        url = (url_of(url) if url_of else None) or url
        name = p.get("caption") or p.get("name") or ""
        if t == "image":
            return f"![{name}]({_md_url(url)})"
        return f"[{name or url.rsplit('/', 1)[-1]}]({_md_url(url)})"
    if t == "pageLink":
        pid = p.get("pageId") or ""
        title = (title_of(pid) if title_of else None) or "Untitled"
        return _wiki(title)
    if t == "database":
        pid = p.get("pageId") or ""
        title = (title_of(pid) if title_of else None) or "Database"
        return _wiki(title)
    if t == "embed":
        url = p.get("url") or ""
        return f"<{url}>" if url else None
    if t == "columnList":
        return "\n\n".join(_blocks_md(col.get("children") or [], depth, title_of, url_of) for col in kids)
    if t == "column":
        return child_md
    # unknown block: keep its text
    return inline + ("\n\n" + child_md if child_md else "") if inline or child_md else None


def _md_url(url: str) -> str:
    return url.replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def _esc(text: str) -> str:
    return re.sub(r"([\\`*_\[\]<>]|~~|==|\$)", r"\\\1", text)


def _escape_line_starts(s: str) -> str:
    """A line that would read as a list, heading, quote or table row gets a backslash (Markdown unescapes it)."""
    s = re.sub(r"(?m)^([-+#>|])", lambda m: "\\" + m.group(1), s)
    return re.sub(r"(?m)^(\d+)([.)])(?=\s|$)", lambda m: m.group(1) + "\\" + m.group(2), s)


def inline_md(items, title_of: Resolver = None) -> str:
    if isinstance(items, str):
        return _escape_line_starts(_esc(items))
    return _escape_line_starts(_inline_md(items, title_of))


def _inline_md(items, title_of: Resolver = None) -> str:
    out = []
    for it in items or []:
        t = it.get("type")
        if t == "text":
            out.append(_styled(it.get("text", ""), it.get("styles") or {}))
        elif t == "link":
            inner = "".join(_styled(x.get("text", ""), x.get("styles") or {}) for x in it.get("content") or []
                            if x.get("type") == "text")
            href = it.get("href", "")
            out.append(href if inner == _esc(href) and re.match(r"^https?://", href) else f"[{inner}]({_md_url(href)})")
        elif t == "pageMention":
            pr = it.get("props") or {}
            title = (title_of(pr.get("pageId", "")) if title_of else None) or pr.get("title") or "Untitled"
            out.append(_wiki(title))
        elif t == "inlineMath":
            out.append("$" + (it.get("props") or {}).get("latex", "") + "$")
    return "".join(out)


def _styled(text: str, st: dict) -> str:
    if not text:
        return ""
    if st.get("code"):
        tick = "``" if "`" in text else "`"
        return f"{tick}{text}{tick}"
    core = text.strip()
    if not core:
        return text
    lead = text[:len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    s = _esc(core)
    if st.get("bold") and st.get("italic"):
        s = f"***{s}***"
    elif st.get("bold"):
        s = f"**{s}**"
    elif st.get("italic"):
        s = f"*{s}*"
    if st.get("strike"):
        s = f"~~{s}~~"
    if st.get("underline"):
        s = f"<u>{s}</u>"
    if st.get("backgroundColor") and st.get("backgroundColor") != "default":
        s = f"=={s}=="
    return lead + s + trail


# ====================================================================== text & references
def to_text(blocks) -> str:
    """Plain text of a page, for search and previews."""
    out: list[str] = []

    def walk(bs):
        for b in bs or []:
            if not isinstance(b, dict):
                continue
            c = b.get("content")
            p = b.get("props") or {}
            if isinstance(c, list):
                s = _plain(c)
                if s.strip():
                    out.append(s)
            elif isinstance(c, dict):
                rows = c.get("rows")
                for r in rows if isinstance(rows, list) else []:
                    cells = r.get("cells") if isinstance(r, dict) else None
                    out.append(" | ".join(_plain(cell.get("content") if isinstance(cell, dict) else cell)
                                          for cell in (cells if isinstance(cells, list) else [])))
            if b.get("type") == "math" and p.get("latex"):
                out.append(str(p["latex"]))
            if b.get("type") in ("image", "file", "video", "audio") and (p.get("caption") or p.get("name")):
                out.append(str(p.get("caption") or p.get("name")))
            walk(b.get("children") if isinstance(b.get("children"), list) else None)

    walk(blocks)
    return "\n".join(out).strip()


def page_refs(blocks, mentions_only=False) -> set[str]:
    """Ids of pages a page points to: mentions, sub-page blocks, inline databases."""
    refs: set[str] = set()
    kinds = ("pageMention",) if mentions_only else ("pageMention", "pageLink", "database")

    def walk(obj):
        if isinstance(obj, dict):
            if obj.get("type") in kinds:
                pid = (obj.get("props") or {}).get("pageId")
                if pid:
                    refs.add(pid)
            for v in obj.values():
                if isinstance(v, (list, dict)):
                    walk(v)
        elif isinstance(obj, list):
            for x in obj:
                walk(x)

    walk(blocks)
    return refs
