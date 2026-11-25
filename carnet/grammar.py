"""Spelling and grammar check through a LanguageTool server (self-hosted or public), no AI involved.

`check()` sends the text in chunks cut at paragraph breaks and returns the matches with offsets
in the whole text."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

MAX_TEXT = 100_000          # characters accepted in one request from the browser
CHUNK = 15_000              # characters sent to LanguageTool at a time
LANGS = {"auto", "fr", "fr-FR", "en", "en-US", "en-GB", "de-DE", "es", "it", "pt-PT", "nl"}


def chunks(text: str, size: int = CHUNK) -> list[tuple[int, str]]:
    """[(offset, piece)] covering `text`, cut after a blank line when possible."""
    out, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            cut = text.rfind("\n\n", start, end)
            if cut > start:
                end = cut + 2
        out.append((start, text[start:end]))
        start = end
    return out


def simplify(m: dict, base: int) -> dict:
    rule = m.get("rule") or {}
    return {
        "offset": base + int(m.get("offset", 0)), "length": int(m.get("length", 0)),
        "message": str(m.get("message") or ""), "short": str(m.get("shortMessage") or ""),
        "replacements": [str(r.get("value", "")) for r in (m.get("replacements") or [])[:6]],
        "rule": str(rule.get("id") or ""), "type": str(rule.get("issueType") or ""),
        "category": str((rule.get("category") or {}).get("id") or ""),
    }


def check(url: str, text: str, language: str = "auto", timeout: int = 30) -> list[dict]:
    out = []
    for base, piece in chunks(text):
        if not piece.strip():
            continue
        form = {"text": piece, "language": language}
        if language == "auto":
            form["preferredVariants"] = "fr-FR,en-GB,de-DE,pt-PT"
        req = urllib.request.Request(url.rstrip("/") + "/v2/check", data=urllib.parse.urlencode(form).encode(),
                                     method="POST", headers={"Content-Type": "application/x-www-form-urlencoded",
                                                             "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        out += [simplify(m, base) for m in data.get("matches") or []]
    return out
