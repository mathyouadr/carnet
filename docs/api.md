# API

JSON over HTTP, under `<base>/api/`. Authentication: the session cookie of the web app, or
`Authorization: Bearer <token>` with a token from `CARNET_TOKENS`. Without a password and without tokens
the API is open (trusted networks only).

Browser-reachable writes (cookie or no auth) must be JSON (`Content-Type: application/json`) and same-origin:
anything a foreign web page could forge is refused (415 / 403).

## Pages

Everything is a page. `kind` is `page` (a document) or `database`. A page whose parent is a database is a **row**.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/bootstrap` | | `{info, settings, tree}` — every live page, without contents |
| GET | `/api/pages` | `?parent_id=` `?q=` `?templates=1` | `{results: [summary]}` |
| POST | `/api/pages` | `{title, parent_id, kind, icon, cover, content \| markdown, props, is_template, schema, views}` | the page |
| GET | `/api/pages/{id}` | `?format=markdown` | the page: `content` (BlockNote blocks), `props`, `path`, `backlinks`, `children`; databases add `schema`, `views`, `rows`; rows add `database` |
| GET | `/api/pages/{id}/markdown` | | `{id, markdown}` |
| GET | `/api/pages/{id}/export.md` | | file download |
| POST | `/api/pages/{id}` | any of `title, icon, cover, content, markdown (+ append: true), props (+ merge_props: false), options, favorite, is_template, schema, views, rev` | the page; `409` with the current page when `rev` is stale |
| POST | `/api/pages/{id}/move` | `{parent_id, index}` | the page |
| POST | `/api/pages/{id}/duplicate` | | the copy (sub-pages included) |
| DELETE | `/api/pages/{id}` | `?forever=1` | moves to the trash (or deletes) |
| POST | `/api/pages/{id}/restore` | | back from the trash |
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
| GET | `/api/search?q=&limit=` | full-text search with snippets (`\u0002`/`\u0003` mark the hits) |
| GET | `/api/trash` · POST `/api/trash/empty` | |
| POST | `/api/templates/{id}/use` | `{parent_id, title}` → a copy of the template |
| POST | `/api/favorites/order` | `{ids}` |
| GET / POST | `/api/settings` | free-form key/value settings |
| POST | `/api/files` | raw body, headers `X-Carnet-Upload: 1`, `X-Filename`, `Content-Type` → `{url}` |
| POST | `/api/import?parent_id=&databases=0` | raw `.zip` or `.md`, same headers → `{pages, databases, files, templates, root_id}` |
| GET | `/api/export.zip?root=` | everything (or one subtree) as Markdown |
| GET | `/healthz` | `{ok, version}` |

## Markdown folders (read-only)

With `CARNET_MD_FOLDERS=Name=/path`, the pages of a Markdown folder show up in `/api/bootstrap`, `/api/pages`,
`/api/pages/{id}` (content converted on the fly, `readonly: true`, `source: {folder, path}`), `/api/search` and backlinks.
Their ids start with `md`. `?format=markdown` returns the file itself. Any POST / DELETE on them, or creating a page
inside them, answers **403**: edit the file instead.
