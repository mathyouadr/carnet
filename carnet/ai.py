"""AI assistant: prompt building and streaming from an OpenAI-compatible ``chat/completions`` endpoint.

Pure stdlib. The browser never talks to the endpoint: the server relays text deltas (see ``Handler.ai_stream``),
so the URL and the key stay on the server.
"""
from __future__ import annotations

import http.client
import json
import urllib.error
import urllib.request
from typing import Generator, Iterable, Iterator

COMMANDS: dict[str, str] = {
    "improve": "Improve the writing of the selected text: clearer, better flow, same meaning.",
    "fix": "Fix the spelling and grammar of the selected text. Change nothing else.",
    "shorter": "Make the selected text shorter, keeping the key points.",
    "longer": "Make the selected text longer, developing the ideas already there.",
    "simplify": "Rewrite the selected text in simpler words.",
    "explain": "Explain the selected text simply, as to a student.",
    "translate_fr": "Translate the selected text into French.",
    "translate_en": "Translate the selected text into English.",
    "summarize": "Summarize the selected text.",
    "continue": "Continue writing from the end of the selected text (or the page), in the same style.",
    "summarize_page": "Summarize the page.",
    "action_items": "List the action items found in the page, as a to-do list (- [ ] ...).",
    "custom": "Do what the user asks below.",
}

# commands whose answer replaces the selection (the others are inserted)
REWRITE = {"improve", "fix", "shorter", "longer", "simplify", "translate_fr", "translate_en"}

CONTEXT_LIMIT = 12000
PAGE_LIMIT = 60000          # whole-page commands (summary, action items) read the page from the top
WHOLE_PAGE = {"summarize_page", "action_items"}
SELECTION_LIMIT = 20000
MAX_HITS = 5
HIT_CHARS = 600

SYSTEM = """You are the writing assistant inside Carnet, a Notion-like notes app.
Rules:
- Answer with the result only, in Markdown: no preamble, no explanation of what you did, no closing remark.
- Never wrap the whole answer in a code fence.
- Write in the same language as the text, unless the command is a translation.
- Carnet Markdown: headings, lists, - [ ] to-dos, tables, callouts "> [!note] text", math $x^2$ and $$...$$,
  ==highlight==, links to other pages [[Page title]].
- Notes from other pages are given for reference only: never copy them unless asked."""


class UpstreamError(Exception):
    """Short message, safe to show to the user (never the URL or the key)."""


def clip_selection(selection_md: str) -> str:
    return selection_md[:SELECTION_LIMIT]


def clip_context(context_md: str, selection_md: str, limit: int = CONTEXT_LIMIT) -> str:
    """Cut the context to `limit` characters, centred on the selection when it is found."""
    if len(context_md) <= limit:
        return context_md
    anchor = selection_md[:200]
    pos = context_md.find(anchor) if anchor else -1
    if pos < 0:
        return context_md[:limit]
    centre = pos + min(len(selection_md), limit) // 2
    start = max(0, min(centre - limit // 2, len(context_md) - limit))
    return context_md[start:start + limit]


def build_messages(*, command: str, prompt: str, title: str, selection_md: str, context_md: str,
                   hits: list[dict], history: list[dict], extra_system: str = "") -> list[dict]:
    if command not in COMMANDS:
        raise ValueError(f"unknown command {command!r}")
    prompt = (prompt or "").strip()
    if command == "custom" and not prompt:
        raise ValueError("empty prompt")
    system = SYSTEM + ("\n\n" + extra_system.strip() if extra_system and extra_system.strip() else "")
    selection_md = clip_selection(selection_md or "")
    parts = [f"Page title: {title or 'Untitled'}"]
    if context_md and command in WHOLE_PAGE:
        page = context_md if len(context_md) <= PAGE_LIMIT else context_md[:PAGE_LIMIT] + "\n[… page truncated …]"
        parts.append("Page content:\n<page>\n" + page + "\n</page>")
    elif context_md:
        parts.append("Page content (around the selection):\n<page>\n" + clip_context(context_md, selection_md) + "\n</page>")
    if hits:
        notes = [f"## {h.get('title') or 'Untitled'}\n{str(h.get('snippet') or '')[:HIT_CHARS]}" for h in hits[:MAX_HITS]]
        parts.append("Related notes (read-only):\n<notes>\n" + "\n\n".join(notes) + "\n</notes>")
    if selection_md:
        parts.append("Selected text:\n<selection>\n" + selection_md + "\n</selection>")
    parts.append("Command: " + COMMANDS[command])
    if prompt:
        parts.append("User request: " + prompt)
    msgs = [{"role": "system", "content": system}]
    for m in history or []:
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
            msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": "\n\n".join(parts)})
    return msgs


def iter_deltas(lines: Iterable[bytes], heartbeats: bool = False) -> Iterator[str]:
    """Text deltas of an OpenAI-style SSE stream. Other events (tool progress, reasoning, keepalives) are dropped,
    or yielded as "" with `heartbeats` (so the relay writes something and notices a client that left).
    A stream that ends without ``[DONE]`` is an error: the answer may be cut."""
    for raw in lines:
        line = raw.decode("utf-8", "replace").strip() if isinstance(raw, bytes) else str(raw).strip()
        if not line.startswith("data:"):
            if heartbeats and line:
                yield ""
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            obj = json.loads(data)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        if obj.get("error"):
            err = obj["error"]
            msg = err.get("message") if isinstance(err, dict) else str(err)
            raise UpstreamError(f"AI error: {str(msg)[:200]}")
        for ch in obj.get("choices") or []:
            text = ((ch or {}).get("delta") or {}).get("content")
            if isinstance(text, str) and text:
                yield text
            elif heartbeats:
                yield ""
    raise UpstreamError("AI answer interrupted")


def stream_chat(cfg, messages: list[dict], session_id: str) -> Generator[str, None, None]:
    """Text deltas from the endpoint; "" = keepalive (no text, but the relay should write to detect a gone client)."""
    body = json.dumps({"model": cfg.ai_model, "messages": messages, "stream": True}).encode()
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream", "X-Hermes-Session-Id": session_id}
    if cfg.ai_key:
        headers["Authorization"] = "Bearer " + cfg.ai_key
    req = urllib.request.Request(cfg.ai_url + "/chat/completions", data=body, method="POST", headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=cfg.ai_timeout)
    except urllib.error.HTTPError as e:
        e.close()
        raise UpstreamError(f"AI server error ({e.code})") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise UpstreamError("AI server unreachable") from None
    try:
        try:
            yield from iter_deltas(resp, heartbeats=True)
        except (OSError, ValueError, http.client.HTTPException):    # e.g. IncompleteRead: chunked body cut
            raise UpstreamError("AI answer interrupted") from None
    finally:
        resp.close()
