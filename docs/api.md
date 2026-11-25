# API

JSON over HTTP, under `<base>/api/`. Authentication: the session cookie of the web app, or
`Authorization: Bearer <token>` with a token from `CARNET_TOKENS`. Without a password and without tokens
the API is open (trusted networks only).

Browser-reachable writes (cookie or no auth) must be JSON (`Content-Type: application/json`) and same-origin:
anything a foreign web page could forge is refused (415 / 403). `POST /api/logout` is checked the same way.

Request bodies may be sent with `Content-Length` or `Transfer-Encoding: chunked`. A body over its limit
(32 MB for JSON, `CARNET_MAX_UPLOAD_MB` for files, `CARNET_MAX_IMPORT_MB` for imports) gets **413**.
JSON bodies must be strict JSON: `NaN` and `Infinity` are refused (400).

## Pages

Everything is a page. `kind` is `page` (a document) or `database`. A page whose parent is a database is a **row**.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/bootstrap` | | `{info, settings, tree}` — every live page, without contents |
| GET | `/api/pages` | `?parent_id=` `?q=` `?templates=1` | `{results: [summary]}` |
| POST | `/api/pages` | `{title, parent_id, kind, icon, cover, content \| markdown, props, is_template, schema, views}` | the page; `400` when `parent_id` is in the trash; `content` must be a list of block objects |
| GET | `/api/pages/{id}` | `?format=markdown` | the page: `content` (BlockNote blocks), `props`, `path`, `backlinks`, `children`; databases add `schema`, `views`, `rows`; rows add `database` |
| GET | `/api/pages/{id}/markdown` | | `{id, markdown}` |
| GET | `/api/pages/{id}/export.md` | | file download |
| POST | `/api/pages/{id}` | any of `title, icon, cover, content, markdown (+ append: true), props (+ merge_props: false), options, favorite, is_template, schema, views, rev` | the page; `409` with the current page when `rev` is stale |
| POST | `/api/pages/{id}/move` | `{parent_id, index}` | the page; `400` when the new parent is in the trash |
| POST | `/api/pages/{id}/duplicate` | | the copy (sub-pages included) |
| DELETE | `/api/pages/{id}` | `?forever=1` | moves to the trash (or deletes) |
| POST | `/api/pages/{id}/restore` | | back from the trash; keeps its parent, unless the parent is gone or itself in the trash (then root) |
| GET | `/api/pages/{id}/versions` | | `{results: [{id, created_at, title}]}` |
| GET | `/api/versions/{vid}` | | a version with its content |
| POST | `/api/versions/{vid}/restore` | | the page |

`markdown` accepts GFM plus Obsidian syntax: `[[Page]]` / `[[Page|alias]]` links (resolved by title), `> [!note]`
callouts, `$inline$` and `$$block$$` math, `==highlight==`, `- [ ]` tasks, tables, fenced code.

## Databases

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/databases/{id}/rows` | `?Property=value` (name or id, case-insensitive), `?title=` | `{schema, results}` |
| POST | `/api/databases/{id}/rows` | `{title, props, markdown \| content, icon}` | the row |
| GET | `/api/pages/{id}/export.csv` | | CSV download |

`props` keys may be property **names** or ids. Values:

| Type | Value |
|---|---|
| text, url, email, phone | string |
| number | number |
| checkbox | `true` / `false` (also `"oui"`, `"yes"`, `"1"`) |
| select, status | option id **or name** — unknown names create the option |
| multi_select | list of ids or names (or a comma-separated string) |
| date | `"2026-11-24"`, `"2026-11-24T14:00"` or `{"start": …, "end": …}` |
| relation | list of page ids |

A schema is `{title_name, properties: [{id, name, type, options?, database_id?, format?, time?}]}`; a view is
`{id, name, type: table|board|list|gallery|calendar, filters, filter_mode, sorts, hidden, widths, group_by, date_prop, card_cover, card_size, wrap}`.

## Other

| Method | Path | |
|---|---|---|
| GET | `/api/search?q=&limit=` | full-text search with snippets (`\u0002`/`\u0003` mark the hits); `limit` is clamped to 1..200 |
| GET | `/api/trash` · POST `/api/trash/empty` | emptying answers `{deleted}` (pages removed, sub-pages included) |
| POST | `/api/templates/{id}/use` | `{parent_id, title}` → a copy of the template |
| POST | `/api/favorites/order` | `{ids: [page id, ...]}`; anything else is `400` |
| GET / POST | `/api/settings` | free-form key/value settings |
| POST | `/api/files` | raw body, headers `X-Carnet-Upload: 1`, `X-Filename`, `Content-Type` → `{url}` |
| POST | `/api/import?parent_id=&databases=0` | raw `.zip` or `.md`, same headers → `{pages, databases, files, templates, root_id}` |
| GET | `/api/export.zip?root=` | everything (or one subtree) as Markdown |
| GET | `/files/{id}/{name}` | an uploaded file; `Range: bytes=a-b` (one range) answers **206**, unsatisfiable ranges **416** |
| GET | `/healthz` | `{ok, version}` |

## Markdown folders (read-only)

With `CARNET_MD_FOLDERS=Name=/path`, the pages of a Markdown folder show up in `/api/bootstrap`, `/api/pages`,
`/api/pages/{id}` (content converted on the fly, `readonly: true`, `source: {folder, path}`), `/api/search` and backlinks.
Their ids start with `md`. `?format=markdown` returns the file itself; `/api/pages/{id}/export.md` works for them too. Any POST / DELETE on them, or creating a page
inside them, answers **403**: edit the file instead.

## AI assistant

Only when `CARNET_AI_URL` is set (otherwise **404**). `/api/bootstrap` → `info.ai = {enabled, name}`; the endpoint URL
and key are never sent to the browser.

| Method | Path | Body → result |
|---|---|---|
| POST | `/api/ai` | `{page_id, command, prompt?, selection: Block[], context: Block[], history?: [{role, content}]}` → `text/event-stream` |
| POST | `/api/ai/blocks` | `{markdown}` → `{blocks}` (same parser as `markdown` on `/api/pages`) |

`command`: `improve`, `fix`, `shorter`, `longer`, `simplify`, `explain`, `translate_fr`, `translate_en`, `summarize`
(about the selection), `continue`, `summarize_page`, `action_items`, `custom` (needs `prompt`). For `custom` and
`continue`, a few related notes found by search are added to the prompt.

Events, in order: `data: {"selection_md": "..."}` (the selection as the AI saw it, for diffs), `data: {"delta": "..."}`
repeated, then `data: {"done": true}` **or** `data: {"error": CODE}` (optionally with `"status"`). Lines starting with `:`
are keepalives, sent every 15 s while the model is silent. The answer is only complete after `done`.

Error codes (English, stable; the UI translates them): `upstream_http` (+ `status`), `unreachable`, `interrupted`
(stream cut), `truncated` (the model stopped at its length limit: not a complete answer), `filtered`, `malformed`
(non-JSON data from the model), `upstream_error`, `deadline` (total time over `CARNET_AI_DEADLINE`). Upstream text is
never sent to the browser.

Errors before the stream starts are plain JSON `{"error": CODE}`: 400 `invalid_request` / `invalid_body`,
403 `read_only` (Markdown-folder page) or `in_trash`, 404 `not_found`, 413 `too_large` (body over 1 MB, or
`selection_too_long`: a rewrite command over 20 000 characters, refused before the model is called; insert-only
commands get the clipped selection), 415 (not JSON), 429 `too_many_requests` (more than `CARNET_AI_MAX_CONCURRENT`
requests running; `Retry-After: 5`).

Limits: the conversation sent is the newest 8 messages, 4 000 characters each. The model's context gets at most 12 000
characters around the selection (60 000 for whole-page commands), and up to 5 related notes for `custom` / `continue`.

Environment: `CARNET_AI_TIMEOUT` (seconds without data from the model, default 120), `CARNET_AI_DEADLINE` (total seconds
for one answer, default 180), `CARNET_AI_MAX_CONCURRENT` (simultaneous answers, default 4).


## Spelling and grammar

Only when `CARNET_GRAMMAR_URL` is set (otherwise **404**); `/api/bootstrap` → `info.grammar = true`.

- `POST /api/grammar` `{text, language?}` → `{matches: [{offset, length, message, short, replacements[], rule, type, category}]}`. Offsets are in `text` (UTF-16, as in JavaScript). `language` defaults to `CARNET_GRAMMAR_LANG` (`auto`). Text over 100 000 characters → **413**; LanguageTool unreachable → **502** `grammar_unavailable`.
