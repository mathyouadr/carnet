# AI assistant (Notion AI style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an "Ask AI" menu in the editor (✨ toolbar button, `/ai`, Space on an empty line). It streams an answer from an OpenAI-compatible endpoint into a result card with a word diff, and replaces or inserts blocks only when the user accepts.

**Architecture:**
- Two new routes in the stdlib server:
  - `POST /api/ai` turns the selected and nearby blocks into Markdown with `carnet.markdown`, builds the prompt, and relays the upstream `chat/completions` SSE as Carnet's own minimal SSE;
  - `POST /api/ai/blocks` turns the answer's Markdown back into Carnet blocks with the same parser the API uses, so callouts, `$math$` and `[[links]]` survive.
- The web side has a stream client, pure text helpers (SSE parser, word diff, fence strip) and an `AIMenu` React component wired into `Editor.tsx` and `DocsToolbar.tsx`.

**Tech Stack:** Python 3 stdlib (`http.server`, `urllib`), React 19 + TypeScript, BlockNote 0.57, `node --test` (Node 26 strips types natively) for the web helpers.

**Spec:** `docs/superpowers/specs/2026-11-23-ai-assistant-design.md`

**Host deployment** (Hermes API server, site relay, env, final checks) is in `~/.config/carnet/ai-hermes.md`, Task 7. It is not in the repo.

## Global Constraints

- No new runtime dependency: Python stdlib only; no new npm package.
- Generic code only: no personal data, no host paths. "Hermes" appears only as an example in docs.
- AI is enabled iff `CARNET_AI_URL` is set. When it isn't, there is no button, no slash item, Space types a space, and both routes return 404.
- `CARNET_AI_URL` and `CARNET_AI_KEY` never reach the browser: not in bootstrap, page HTML, SSE events, error messages or logs.
- Every route keeps the existing guards: auth, cross-site refusal, JSON-only.
- UI strings: English keys through `t()`, French in the `FR` table of `web/src/i18n.ts`.
- Blocks from the AI go through `sanitize()` before reaching the editor (no `code` combined with another mark).
- The document changes only on Replace / Insert / Insert below, in one `editor.transact`, so one Ctrl+Z reverts it.
- UI checked at 1440 px and 402 px: `scrollWidth` 402, card full width at the bottom on mobile.
- Work in a `git worktree` (another session may touch `~/projects/carnet`; `node_modules` symlinked), rebase on `main`, `merge --ff-only`.
- Tests: `python3 -m unittest discover -s tests -t .` and `cd web && npm test && npm run build`.

## Review Focus

1. **Cancel while streaming** (Esc, Discard, closing the page): the fetch aborts. The server stops reading upstream and closes it on `BrokenPipeError`, with no stack in the log. *Test in Task 3.*
2. **Answer wrapped in a fence or a preamble** ("Voici le texte corrigé :" plus a ```` ```markdown ```` block): the system prompt forbids it, and `stripFence()` removes one wrapping fence. *Tests in Task 2 (prompt) and Task 4.*
3. **Upstream fails mid-answer or answers nothing**: the card shows the error and Retry, and the document stays untouched. The server sends `{"error": …}` and never a half-"done". *Test in Task 3.*
4. **The selected blocks changed or vanished before Replace** (another tab, typing during the stream): Replace targets the block ids captured when the menu opened. If any is gone, show "The text changed in the meantime" and offer Insert below only. *Check in Task 5.*
5. **A huge page or a huge selection**: the context is cut to 12,000 characters around the selection (selection kept whole up to 20,000), and a body over 1 MB gets 413. *Tests in Tasks 2 and 3.*

---

### Task 1: Configuration and the bootstrap flag

**Files:**
- Modify: `carnet/config.py`: `Config` fields and `from_env`
- Modify: `carnet/server.py`: `App.info()` (line ~57) and the `boot` dict in `page()` (line ~378)
- Modify: `web/src/api.ts`: `BOOT` type (line 3)
- Test: `tests/test_ai.py` (new)

**Interfaces:**
- Produces:
  - `Config.ai_url: str = ""`, `ai_key: str = ""`, `ai_model: str = "hermes-agent"`, `ai_name: str = "AI"`, `ai_system: str = ""`, `ai_timeout: int = 120`, read from `CARNET_AI_URL`, `CARNET_AI_KEY`, `CARNET_AI_MODEL`, `CARNET_AI_NAME`, `CARNET_AI_SYSTEM`, `CARNET_AI_TIMEOUT`. `ai_url` is right-stripped of `/`.
  - `Config.ai_enabled` property.
  - `info()["ai"]` and `window.CARNET.ai` = `{"enabled": bool, "name": str}`.
  - TS: `BOOT.ai?: { enabled: boolean; name: string }`.

- [ ] **Step 1: Write the failing tests** in `tests/test_ai.py`, class `AIConfigTests`:
  - `test_env_parsing`: with env `CARNET_AI_URL=http://x:1/v1/`, `CARNET_AI_NAME=Hermes`, `CARNET_AI_TIMEOUT=30`, `Config.from_env("/dev/null")` gives `ai_url == "http://x:1/v1"`, `ai_name == "Hermes"`, `ai_timeout == 30`, `ai_enabled`. Use `unittest.mock.patch.dict(os.environ, …)`.
  - `test_bootstrap_flag_off_by_default`: `GET /api/bootstrap` on a default `make_server` gives `info.ai == {"enabled": False, "name": "AI"}`.
  - `test_secrets_never_exposed`: with `ai_url="http://secret-host:9/v1"` and `ai_key="sk-TOPSECRET"`, `info.ai.enabled is True`, and neither `secret-host` nor `TOPSECRET` appears in the bootstrap JSON or in `GET /` (page HTML).
- [ ] **Step 2: Run them**: `python3 -m unittest tests.test_ai -v`. Expected: FAIL (`AttributeError` / `KeyError: 'ai'`).
- [ ] **Step 3: Implement** the fields, the property, and the `ai` entry in `info()` and in the `boot` dict. Add `ai?` to the `BOOT` type.
- [ ] **Step 4: Run** the full Python suite. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(ai): CARNET_AI_* settings and bootstrap flag`.

### Task 2: Prompt building and upstream streaming (`carnet/ai.py`)

**Files:**
- Create: `carnet/ai.py`
- Test: `tests/test_ai.py`, class `AICoreTests`

**Interfaces:**
- Produces:
  - `COMMANDS: dict[str, str]`: command id → instruction. Ids: `improve`, `fix`, `shorter`, `longer`, `simplify`, `explain`, `translate_fr`, `translate_en`, `summarize`, `continue`, `summarize_page`, `action_items`, `custom`. `REWRITE = {"improve","fix","shorter","longer","simplify","translate_fr","translate_en"}`: the commands whose answer replaces the selection.
  - `class UpstreamError(Exception)`: message is short and safe to show.
  - `build_messages(*, command: str, prompt: str, title: str, selection_md: str, context_md: str, hits: list[dict], history: list[dict], extra_system: str = "") -> list[dict]`
  - `clip_context(context_md: str, selection_md: str, limit: int = 12000) -> str`
  - `iter_deltas(lines: Iterable[bytes]) -> Iterator[str]`
  - `stream_chat(cfg: Config, messages: list[dict], session_id: str) -> Iterator[str]`

- [ ] **Step 1: Write the failing tests:**
  - `test_build_messages_shape`:
    - `messages[0]["role"] == "system"`, and it contains "Markdown", "no preamble", "same language", plus `extra_system` when given;
    - the last message is `user` and contains `COMMANDS["fix"]`, the selection text and the page title;
    - `history=[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]` sits between them, in order.
  - `test_unknown_command_and_custom`: `command="nope"` raises `ValueError`; `command="custom", prompt=""` raises `ValueError`; `command="custom", prompt="Fais un plan"` gives a last message containing "Fais un plan".
  - `test_hits_capped`: 8 hits of 2,000 characters each → at most 5 hits in the prompt, each cut to 600 characters.
  - `test_clip_context`:
    - 50,000 characters of context with the selection in the middle → result ≤ 12,000 characters and contains the selection;
    - a short context comes back unchanged;
    - a selection over 20,000 characters is cut to 20,000.
  - `test_iter_deltas`: feed these lines and get exactly `["Bon", "jour"]`:
    - `b'data: {"choices":[{"delta":{"role":"assistant"}}]}'`
    - `b'event: hermes.tool.progress'`
    - `b'data: {"tool":"x"}'`
    - `b'data: {"choices":[{"delta":{"content":"Bon"}}]}'`
    - `b': keepalive'`
    - `b'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}'`
    - `b'data: {"choices":[{"delta":{"content":"jour"}}]}'`
    - `b'data: [DONE]'`
    - `b'data: {"choices":[{"delta":{"content":"after"}}]}'`
  - `test_iter_deltas_error`: `b'data: {"error":{"message":"boom"}}'` raises `UpstreamError` containing "boom".
- [ ] **Step 2: Run them**: `python3 -m unittest tests.test_ai -v`. Expected: FAIL (`ModuleNotFoundError: carnet.ai`).
- [ ] **Step 3: Implement.**
  - System prompt rules: answer with the result only, in Carnet Markdown (callouts `> [!note]`, `$math$`, `[[Page]]`, `==highlight==`, tables); no preamble, no code fence around the answer; keep the language of the text unless the command is a translation; then `extra_system`.
  - `stream_chat` POSTs `{"model": cfg.ai_model, "messages": …, "stream": true}` to `cfg.ai_url + "/chat/completions"`, with `Authorization: Bearer <key>` only when `ai_key` is set, `X-Hermes-Session-Id: <session_id>`, `Accept: text/event-stream` and `timeout=cfg.ai_timeout`.
  - It yields from `iter_deltas(resp)` and closes `resp` in `finally`.
  - Errors map to `UpstreamError`: `HTTPError` → `f"AI server error ({code})"`; `URLError` / timeout / `OSError` → `"AI server unreachable"`. Never include the URL or the key.
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(ai): prompt building and OpenAI-compatible stream reader`.

### Task 3: `POST /api/ai` (SSE relay) and `POST /api/ai/blocks`

**Files:**
- Modify: `carnet/server.py`: in `_dispatch`, inside the `/api/` branch after the generic guards and before `read_body` (line ~297), route both paths to new `Handler.ai_stream()` and `Handler.ai_blocks()`
- Modify: `docs/api.md`: document both routes and the event format
- Test: `tests/test_ai.py`, class `AIHTTPTests`, with a fake upstream: a `ThreadingHTTPServer` on port 0 whose handler records request headers and body and replies with a scripted SSE list or a status code

**Interfaces:**
- Consumes: Task 1 `Config.ai_*` and `ai_enabled`; Task 2 `build_messages`, `clip_context`, `stream_chat`, `UpstreamError`, `REWRITE`.
- Produces (used by Task 4):
  - `POST api/ai`, body `{page_id: str, command: str, prompt?: str, selection: Block[], context: Block[], history?: {role, content}[]}`.
  - Response `text/event-stream`, events in order: `data: {"selection_md": "..."}`, then `data: {"delta": "..."}`×n, then exactly one of `data: {"done": true}` or `data: {"error": "..."}`.
  - `POST api/ai/blocks`, body `{markdown: str}` → `{"blocks": Block[]}`.

- [ ] **Step 1: Write the failing tests:**
  - `test_disabled_404`: on a default server, both routes → 404.
  - `test_stream_relay`: the upstream sends `Bon`, `jour`, `[DONE]`. The parsed events are `[{"selection_md": "Salut"}, {"delta": "Bon"}, {"delta": "jour"}, {"done": True}]` for a selection of one paragraph "Salut". The upstream received `Authorization: Bearer sk-TOPSECRET`, `"stream": true`, `model == "hermes-agent"`, and a non-empty `X-Hermes-Session-Id` that differs between two calls.
  - `test_secret_not_in_response`: no response byte of any test contains `TOPSECRET` or the upstream host and port.
  - `test_upstream_500` → events end with `{"error": "AI server error (500)"}`. With the upstream stopped → `{"error": "AI server unreachable"}`. Mid-stream drop (the upstream closes after one delta, without `[DONE]`) → the last event is `error`, never `done`.
  - `test_guards`:
    - `Origin: http://evil.example` → 403;
    - unknown `page_id` → 404;
    - an md-folder page id (create `Config(md_folders=f"N={tmpdir}")` with one `.md` file) → 403;
    - `Content-Type: text/plain` → 415;
    - a body over 1 MB → 413.
  - `test_client_disconnect`: the upstream sends one delta then waits 5 s. The test reads the first event, closes the socket, and checks that the upstream connection is closed within 2 s (the fake handler sees `BrokenPipe` / a closed socket).
  - `test_blocks_roundtrip`: `{"markdown": "> [!note] Hi\n\n$x^2$\n\n[[Some page]]"}` gives a `callout` block, a math block and a `pageMention` for an existing page titled "Some page" (same types as `Store.create` with `markdown`).
- [ ] **Step 2: Run them**. Expected: FAIL (404 on the enabled server).
- [ ] **Step 3: Implement.**
  - `ai_stream()`: read the body with a 1 MB cap; `ValueError("too large")` → 413.
    - Load the page (`NotFound` → 404); `app.folders.has(pid)` → 403.
    - `titles = {id: title}` as in `transfer.page_markdown`; `selection_md = md.to_markdown(selection, title_of=titles.get)`; same for `context`.
    - `hits`: only for `custom` and `continue`, `store.search(prompt or selection_md[:200], 5)` plus `folders.search(…)`, dropping the current page.
    - Validate with `build_messages` (`ValueError` → 400 JSON, before any SSE byte).
    - Then `send_response(200)`, headers `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, `Connection: close`; `self.close_connection = True`; no Content-Length.
    - Write each event as `data: <json>\n\n` and flush. `session_id = "carnet-" + secrets.token_hex(8)`.
    - Catch `UpstreamError` → error event. Catch `BrokenPipeError` / `ConnectionResetError` → close the generator and return quietly.
  - `ai_blocks()`: `md.to_blocks(markdown, resolve=store.resolve_title)`, with a 200,000-character cap → 413.
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(ai): /api/ai streaming relay and /api/ai/blocks`.

### Task 4: Web stream client and pure text helpers

**Files:**
- Create: `web/src/editor/ai/text.ts` (no imports)
- Create: `web/src/editor/ai/stream.ts`
- Create: `web/tests/ai-text.test.ts`
- Modify: `web/package.json`: script `"test": "node --test tests/"`
- Modify: `.github/workflows/ci.yml`: `npm test` before `npm run build`

**Interfaces:**
- Consumes: Task 3 event format.
- Produces:
  - `class SSEParser { feed(chunk: string): any[] }`: buffers partial lines, returns the parsed JSON of each complete `data:` event.
  - `type DiffPart = { op: "eq" | "del" | "ins"; text: string }`; `wordDiff(a: string, b: string): DiffPart[]`.
  - `stripFence(s: string): string`.
  - `type AIRequest = { page_id: string; command: string; prompt?: string; selection: any[]; context: any[]; history?: { role: "user" | "assistant"; content: string }[] }`.
  - `aiStream(req: AIRequest, h: { onSelection(md: string): void; onDelta(text: string): void }, signal: AbortSignal): Promise<void>`: resolves on `done`, rejects with `Error(message)` on `error` or an HTTP error.
  - `aiBlocks(markdown: string): Promise<any[]>`.

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert`, import `../src/editor/ai/text.ts`):
  - `SSEParser` fed `'data: {"delta":"Bo'` then `'n"}\n\ndata: {"done":true}\n\n'` returns `[]` then `[{delta:"Bon"},{done:true}]`.
  - `wordDiff("le chat noir", "le chien noir")` is `[{eq:"le "},{del:"chat"},{ins:"chien"},{eq:" noir"}]` (adjacent same-op parts merged). The concatenation of eq+del parts equals `a`, and eq+ins equals `b`, for 3 random pairs. Inputs over 4,000 tokens each give `[{del:a},{ins:b}]`.
  - `stripFence("```markdown\nHi\n```")` → `"Hi"`; `"```\nHi\n```\n"` → `"Hi"`; a text with an inner code block is unchanged.
- [ ] **Step 2: Run**: `cd web && npm test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `text.ts` (token split `/(\s+)/`, LCS table) and `stream.ts`. `stream.ts` uses `fetch(BASE + "/api/ai", {method: "POST", headers: {"Content-Type": "application/json"}, body, signal})` like the other calls in `api.ts`, and reads `res.body.getReader()` into `SSEParser`.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit**: `feat(ai): web stream client, SSE parser, word diff`.

### Task 5: The AI menu and result card

**Files:**
- Create: `web/src/editor/ai/AIMenu.tsx`
- Create: `web/src/editor/sanitize.ts`: move `cleanInline` / `cleanContent` / `sanitize` out of `Editor.tsx` unchanged, re-import them there
- Modify: `web/src/styles.css`: `.cn-ai-*` classes
- Modify: `web/src/i18n.ts`: FR strings

**Interfaces:**
- Consumes: Task 4 `aiStream`, `aiBlocks`, `wordDiff`, `stripFence`; `sanitize` from `editor/sanitize.ts`; `BOOT.ai.name`; `useApp().mobile`.
- Produces: `AIMenu(props: { editor: any; pageId: string; blockIds: string[]; hasSelection: boolean; onClose: () => void })`. It is mounted only while open, and anchored under the DOM element of the last block in `blockIds` (desktop) or as a bottom sheet (mobile).

- [ ] **Step 1: Implement the states**: `choose` → `stream` → `done` | `error`.
  - **choose**: a prompt input (placeholder `Ask ${name} anything…`) and the command list. With a selection: Improve writing, Fix spelling & grammar, Make shorter, Make longer, Simplify, Explain, Translate to French, Translate to English, Summarize. Without: Continue writing, Summarize the page, Action items from the page. Typing filters the list; Enter with free text = `custom`; ↑/↓ move.
  - **stream**: "${name} is thinking…" until the first delta, then the live text and a Stop button (abort).
  - **done**:
    - For commands in REWRITE, the card shows `wordDiff(selection_md, stripFence(answer))` (`del` struck through in red, `ins` in green) with **Replace**, **Insert below**, **Retry**, **Discard**.
    - Otherwise it shows the answer as plain text with **Insert** (= after the last block), **Retry**, **Discard**.
    - A follow-up input ("Tell ${name} what to change…") sends the same request with `history` += the previous user instruction and answer, and command `custom`.
  - **error**: the message plus Retry and Discard.
- [ ] **Step 2: Implement the request and apply.**
  - At open: `selection = blockIds.map(id => editor.getBlock(id))`; `context` = up to 30 blocks before and after them from `editor.document`, or the whole document for `summarize_page` / `action_items`.
  - Apply:
    - `blocks = sanitize(await aiBlocks(stripFence(answer)))`;
    - if any id in `blockIds` is gone from `editor.getBlock` → error "The text changed in the meantime", leaving only Insert below (after the cursor block);
    - otherwise `editor.transact(() => editor.replaceBlocks(blockIds, blocks))` or `insertBlocks(blocks, lastId, "after")`;
    - then `onClose()`.
  - `Esc`, an outside mousedown, Discard and unmount → `controller.abort()` + `onClose()`.
- [ ] **Step 3: Style.**
  - Desktop: card 520 px max width, under the anchor, Carnet's `--cn-*` colours (same look as `.cn-popover`).
  - Mobile: `position: fixed; left: 0; right: 0; bottom: var(--cn-bottom)`, 60vh max with internal scroll, above the docked toolbar.
- [ ] **Step 4: Add FR strings** for every new `t()` key ("Ask AI" → "Demander à l'IA", "Replace" → "Remplacer", "Insert below" → "Insérer dessous", "Retry" → "Réessayer", "Discard" → "Annuler", "is thinking…" → "réfléchit…", "The text changed in the meantime" → "Le texte a changé entre-temps", the commands…). The name is interpolated, never translated.
- [ ] **Step 5: Run** `npm run build`. Expected: PASS.
- [ ] **Step 6: Commit**: `feat(ai): AI menu with streamed answer, diff and accept/discard`.

### Task 6: Entry points and README

**Files:**
- Modify: `web/src/editor/Editor.tsx`: `ai` state, slash item, Space handler, desktop formatting toolbar
- Modify: `web/src/editor/DocsToolbar.tsx`: ✨ button (prop `onAI?: () => void`)
- Modify: `README.md`: "AI assistant" section

**Interfaces:**
- Consumes: Task 5 `AIMenu`; `BOOT.ai`.
- Produces: `openAI()` in `EditorInner`. It computes `blockIds` from `editor.getSelection()?.blocks`, or else `[editor.getTextCursorPosition().block.id]`, sets `hasSelection`, and mounts `AIMenu`.

- [ ] **Step 1:** Define `const aiOn = !!BOOT.ai?.enabled && editable && !page.readonly`. Everything below exists only when `aiOn`.
- [ ] **Step 2: Slash item** "Ask AI" (title uses the name: `Ask ${name}`), group `t("AI")`, aliases `["ai", "ia", "assistant", "hermes", name.toLowerCase()]`, icon lucide `Sparkles`. Clicking it removes the `/query` text (`insertOrUpdateBlockForSlashMenu`-style clear of the trigger) and calls `openAI()`.
- [ ] **Step 3: Space handler**: a `keydown` capture listener on `host`. On `" "` without modifiers, when the cursor block is an empty `paragraph` and no composition is in progress: `preventDefault()` + `openAI()`.
- [ ] **Step 4: Desktop formatting toolbar**: set `formattingToolbar={false}` and render `<FormattingToolbarController formattingToolbar={() => <FormattingToolbar>{...getFormattingToolbarItems()}{aiOn && <AIToolbarButton/>}</FormattingToolbar>} />` when `!app.mobile`. This keeps today's default toolbar when the AI is off. **DocsToolbar**: a ✨ `B` button after Redo when `onAI` is passed (desktop slot and mobile dock).
- [ ] **Step 5: README**:
  - the env table for `CARNET_AI_*`;
  - "works with any OpenAI-compatible endpoint (OpenAI, Ollama, OpenRouter, Hermes Agent API server)";
  - the privacy warning: page content, the selection and search excerpts are sent to `CARNET_AI_URL`, so use a local or trusted endpoint;
  - the Hermes example from the spec.
- [ ] **Step 6: Run** the full Python suite, `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 7: Bench check** at port 8099 (`CARNET_DATA_DIR=<scratch> CARNET_PORT=8099 CARNET_AI_URL=http://127.0.0.1:<fake>/v1 python3 -m carnet --env /dev/null serve`, with a 20-line fake upstream script in scratch; stop both by PID).
  - In Chromium at 1440 and 402 px: ✨ in both toolbars, `/ai`, Space on an empty line, stream visible, Replace with Ctrl+Z, Insert below, Discard with Esc, follow-up, error card (fake returns 500).
  - Without `CARNET_AI_URL`: no ✨, no slash item, Space types a space.
- [ ] **Step 8: Commit**: `feat(ai): Ask AI entry points (toolbar, /ai, Space) and README`.

### Task 7: Host deployment

See `~/.config/carnet/ai-hermes.md`: Hermes API server, site relay streaming, env, owner's gateway restart, live checks, merge, push, CI, skill and memory notes.
