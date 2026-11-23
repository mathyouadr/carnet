# Contributing to Carnet

Thanks for helping! Carnet aims to feel like Notion while staying easy to host and to read.

## Ground rules

- **Standard library only** on the server (`carnet/`): no pip dependency.
- The web app (`web/`) is React + BlockNote, built by Vite into `carnet/static/`. Keep new dependencies rare and
  license-compatible with the AGPL.
- Every user-facing string goes through `t("English text")` with its French translation in `web/src/i18n.ts`.
- Markdown conversion (`carnet/markdown.py`) is pure functions with tests: an import or export bug gets a test first.
- The API keeps accepting Markdown in and out: scripts and assistants rely on it.

## Getting started

```bash
git clone https://github.com/mathyouadr/carnet.git && cd carnet
(cd web && npm ci && npm run build)
CARNET_DATA_DIR=./data python3 -m carnet           # http://127.0.0.1:8044
python3 -m unittest discover -s tests -t . -v      # server tests
(cd web && npm run typecheck)                       # web app types
```

While working on the web app, run the Python server on 8044 and `npx vite` in `web/` (it proxies `/api` and
`/files`).
