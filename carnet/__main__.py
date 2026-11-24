"""Command line: ``python -m carnet [--env FILE] <command>``.

  serve                         run the web app (default)
  import PATH [--parent ID]     import an Obsidian vault, a Notion Markdown export, a folder or a .md / .zip file
         [--no-databases]       keep folders of notes with front matter as plain pages
  export FILE.zip [--root ID]   every page as Markdown (opens as an Obsidian vault)
  markdown ID                   print one page as Markdown
  reindex                       rebuild search and backlinks
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, transfer
from .config import Config
from .store import Store


def main(argv=None):
    ap = argparse.ArgumentParser(prog="carnet", description="Carnet - self-hosted, Notion-style notes")
    ap.add_argument("--env", help="path to a .env file (default: ./.env)")
    ap.add_argument("--version", action="version", version=f"carnet {__version__}")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("serve")
    p = sub.add_parser("import")
    p.add_argument("path")
    p.add_argument("--parent")
    p.add_argument("--no-databases", action="store_true")
    p = sub.add_parser("export")
    p.add_argument("file")
    p.add_argument("--root")
    p = sub.add_parser("markdown")
    p.add_argument("id")
    sub.add_parser("reindex")
    args = ap.parse_args(argv)
    config = Config.from_env(args.env)
    cmd = args.cmd or "serve"
    if cmd == "serve":
        from .server import serve
        return serve(config)
    store = Store(config.db_path, files_dir=config.files_dir)
    if cmd == "import":
        path = Path(args.path).expanduser()
        if not path.exists():
            sys.exit(f"not found: {path}")
        if path.suffix.lower() == ".zip":
            stats = transfer.import_upload(store, config.files_dir, path.name, path.read_bytes(), args.parent,
                                           not args.no_databases)
        else:
            stats = transfer.import_path(store, config.files_dir, path, args.parent, not args.no_databases)
        print(json.dumps(stats, ensure_ascii=False))
    elif cmd == "export":
        Path(args.file).write_bytes(transfer.export_zip(store, config.files_dir, args.root))
        print(args.file)
    elif cmd == "markdown":
        sys.stdout.write(transfer.page_markdown(store, args.id))
    elif cmd == "reindex":
        store.reindex()
        print("ok")


if __name__ == "__main__":
    main()
