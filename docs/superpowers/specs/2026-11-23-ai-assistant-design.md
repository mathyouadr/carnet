# AI assistant in the editor (Notion AI style) — design

Date: 23/11/2026 · Status: draft, awaiting approval

## Intent

Bring an AI into Carnet the way Notion AI works: select text (or open a menu on an empty line), ask, see the answer under the text, then replace / insert / discard. On the owner's instance the AI is **Hermes Agent** (it knows him: memory, profile, past conversations), reached through Hermes' OpenAI-compatible API server. In the generic public code, the AI is **any OpenAI-compatible chat endpoint** (Hermes, OpenAI, Ollama, OpenRouter…).

## Goals

- Entry points, like Notion:
  - ✨ **"Ask AI"** button in the formatting toolbar (text selected);
  - **`/ai`** slash item (also matches "ia", "ai", "assistant");
  - **Space on an empty paragraph** opens the menu (Notion behaviour), as long as the AI is configured.
- AI menu: a prompt field plus ready-made commands.
  - With a selection: Improve writing, Fix spelling & grammar, Make shorter, Make longer, Simplify, Explain, Translate (French / English), Summarize.
  - Without a selection: Continue writing, Summarize the page, Action items from the page, plus free prompt ("Write anything…").
  - These generative commands are available everywhere, including course pages (owner's choice, 23/11/2026).
- The answer **streams** into a result card anchored under the selection / cursor.
  - Rewrite commands show a word-level diff: removed text struck through in red, added text in green.
  - Actions: **Replace** (rewrite) or **Insert** (generation), **Insert below**, **Retry**, **Discard**. A follow-up field allows refining ("shorter", "more formal"); it continues the same AI conversation.
  - `Esc` / click outside = discard. Nothing touches the document until Replace / Insert.
  - **Undo** (Ctrl+Z) reverts an accepted change in one step.
- The answer is Markdown, converted to blocks with BlockNote's Markdown parser, then cleaned by the existing `sanitize()` so bad marks (bold + code) never break the page.
- Context sent with each request: page title, the selected text (Markdown), the surrounding page (Markdown, truncated around the cursor to a size cap), plus, for free prompts, the top hits of Carnet's own search for the prompt words (title + excerpt + page id) so the AI can draw on the other notes **read-only**.
- Works at 1440 px and 402 px (iPhone): on narrow screens the menu and card take full width at the bottom of the viewport.
- French and English strings through `i18n.ts`.

## Non-goals

- No chat side panel (maybe later).
- The AI never writes to the database or to other pages. It only returns text; the browser applies it to the open page after the user accepts.
- No AI on read-only pages (`md*` Markdown folder pages, trash, read-only views).
- No inline "suggest changes" marks inside the document (BlockNote `xl-ai` style). The diff is shown in the result card.

## Anti-goals

- An API key reaching the browser.
- An open proxy: the server only ever talks to the one configured endpoint and only exposes one route.
- A site the user visits being able to drive the AI (CSRF): the AI route refuses `Sec-Fetch-Site: cross-site`, like every other write.
- A broken page or a lost edit after an AI action.
- Any visible sign of the AI when it is not configured: no button, no slash item, Space behaves normally.

## Approaches considered

1. **BlockNote's official `@blocknote/xl-ai` extension.** It has the best Notion look (suggested changes inline, accept / reject). But it needs the model to call the editor's client-side tools (document operations) through the Vercel AI SDK. Hermes runs its own agent tools and does not forward client tools, so it can't drive it. It also adds a heavy dependency that follows each BlockNote release. *Rejected.*
2. **Carnet spawns `hermes -z` per request.** Nothing to configure on the Hermes side, but the answer arrives in one block (no streaming, 3–10 s of waiting with nothing on screen). The code would also be tied to one CLI. *Rejected.*
3. **Own AI menu + streaming relay to an OpenAI-compatible endpoint (Hermes API server on this host).** Streaming like Notion, generic for the public repo, the key stays on the server. It costs a one-time Hermes API server setup and building the menu / result card ourselves. **Chosen** by the owner on 23/11/2026.

Earlier in the discussion, a direct model call (no Hermes) was also considered. The owner chose Hermes itself ("Toi"), for its memory and knowledge of him.

## Decided

- Hermes is the AI (via API server, streaming), not a bare model call.
- From Carnet, Hermes may **read** (its memory, plus the note context Carnet sends) and **modify only the open page**, through accept / reject. **No terminal**, and no file, browser, code, cron, delegation or messaging tools. Reason: Carnet has no password on the LAN / tailnet, so anyone reaching it reaches the AI.
- Generative commands are kept everywhere.

## Server side (generic Carnet code)

- Config (env, documented in README and `docs/api.md`):
  - `CARNET_AI_URL`: base URL of an OpenAI-compatible API, e.g. `http://127.0.0.1:8642/v1`;
  - `CARNET_AI_KEY`: bearer, optional;
  - `CARNET_AI_MODEL`: default `hermes-agent`;
  - `CARNET_AI_NAME`: name shown in the UI, default "AI", e.g. "Hermes";
  - `CARNET_AI_SYSTEM`: optional extra system prompt;
  - `CARNET_AI_TIMEOUT`: default 120 s.
  - AI is enabled when `CARNET_AI_URL` is set. `bootstrap` exposes `ai: {enabled, name}`, never the URL or the key.
- `POST /api/ai`, body `{page_id, command, prompt, selection_md, context_md, history}`:
  - builds the messages: a system prompt (Carnet's rules: answer in Markdown only, no preamble, keep the language of the text, the format Carnet accepts — callouts, `$math$`, `[[links]]` — plus `CARNET_AI_SYSTEM`), the context, then the command and prompt;
  - calls `{CARNET_AI_URL}/chat/completions` with `stream: true`;
  - relays the text deltas to the browser as SSE (`data: {"delta": "..."}` … `data: {"done": true}` / `{"error": "..."}`). The stdlib server writes chunks and flushes; the request thread is held for the stream.
  - Refuses: AI not configured (404), read-only page (403), cross-site (403), body over size cap (413). Upstream errors become a short message, never a stack or the key.
  - Follow-ups (*builder's call*): the client sends the full `history` of the current menu interaction, and Carnet stays stateless. Each request carries a fresh random `X-Hermes-Session-Id`, so menus never share or reuse a stored transcript. This is because Hermes otherwise derives a persistent id from the system prompt plus the first message.
  - The relay forwards **text deltas only**. Tool or reasoning frames are dropped, and the card shows "Hermes is thinking…" until the first delta arrives (*builder's call*).
  - README warns that page content, the selection and search excerpts are sent to `CARNET_AI_URL`. Use a local or trusted endpoint (*builder's call*).
- Search hits for context come from the existing `Store` search (same as `/api/search`), capped (e.g. 5 hits, about 600 characters each).
- Tests (stdlib `unittest`, fake upstream server): disabled → 404; streaming relay; cross-site refused; read-only page refused; key never in any response; upstream error message; size cap.

## Web side

- New `web/src/editor/ai/` (menu, result card, diff, stream client). It is wired in `Editor.tsx` (slash item, Space handler) and in the formatting toolbar (✨ button).
- Word-level diff computed in the browser (small LCS on words, no new dependency unless one is tiny).
- After Replace / Insert: blocks are parsed from Markdown, sanitized, and `replaceBlocks` / `insertBlocks` run as one transaction, so one undo reverts them. The page then saves through the normal path.

## Example deployment: Hermes Agent

The AI can be Hermes Agent's API server (`platforms.api_server`, `127.0.0.1:8642/v1`, `API_SERVER_KEY`) with `platform_toolsets.api_server: [no_mcp]` (an empty list would still merge the default MCP servers). With no tools, Hermes still answers with its memory and profile in context, and a note can't make it act. Set `CARNET_AI_URL=http://127.0.0.1:8642/v1`, `CARNET_AI_KEY=<API_SERVER_KEY>` and `CARNET_AI_NAME=Hermes`.

## Open

- Carnet without a password exposes the AI, and what it knows about its owner, to anyone who reaches the instance. The owner accepted this for now (23/11/2026, "on verra ça plus tard"); revisit before adding tools or exposing Carnet further.

## Left to the builder

- Exact visual design of the menu / card (follow Notion and Carnet's existing styles, Mantine components already in use).
- Context truncation sizes and the system prompt wording.
- Keyboard details (↑/↓ in the command list, Enter to send).
