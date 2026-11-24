import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from carnet.config import Config
from carnet.server import make_server
from carnet.store import Conflict, Invalid, Store
from carnet import transfer


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.s = Store(":memory:")

    def tearDown(self):
        self.s.close()

    def test_nesting_move_trash_restore(self):
        a = self.s.create({"title": "A"})
        b = self.s.create({"title": "B", "parent_id": a["id"]})
        c = self.s.create({"title": "C", "parent_id": b["id"]})
        self.assertEqual([p["title"] for p in self.s.page(c["id"])["path"]], ["A", "B", "C"])
        with self.assertRaises(Invalid):
            self.s.move(a["id"], c["id"])                     # no cycles
        self.s.trash(a["id"])
        ids = {p["id"] for p in self.s.tree()}
        self.assertNotIn(c["id"], ids)                         # the whole subtree is hidden
        self.s.restore(a["id"])
        self.assertIn(c["id"], {p["id"] for p in self.s.tree()})
        self.s.move(c["id"], None, 0)
        self.assertIsNone(self.s.page(c["id"])["parent_id"])

    def test_database_rows_props_and_new_options(self):
        db = self.s.create({"kind": "database", "title": "Cours", "schema": {"properties": [
            {"id": "mat", "name": "Matière", "type": "select", "options": [{"id": "o1", "name": "SISR"}]},
            {"id": "rev", "name": "Révisé", "type": "checkbox"},
            {"id": "d", "name": "Date", "type": "date"}]}})
        row = self.s.create({"parent_id": db["id"], "title": "Switch", "props": {"Matière": "SISR", "rev": "oui", "d": "2026-11-17"}})
        self.assertEqual(row["props"], {"mat": "o1", "rev": True, "d": {"start": "2026-11-17"}})
        row = self.s.update(row["id"], {"props": {"mat": "SLAM"}})     # unknown name -> new option
        opts = self.s.page(db["id"])["schema"]["properties"][0]["options"]
        self.assertEqual([o["name"] for o in opts], ["SISR", "SLAM"])
        self.assertEqual(row["props"]["mat"], opts[1]["id"])
        self.assertEqual(len(self.s.page(db["id"])["rows"]), 1)

    def test_rev_conflict_and_versions(self):
        p = self.s.create({"title": "T", "markdown": "hello"})
        p2 = self.s.update(p["id"], {"content": [], "rev": p["rev"]})
        with self.assertRaises(Conflict):
            self.s.update(p["id"], {"content": [], "rev": p["rev"]})
        self.assertEqual(len(self.s.versions(p["id"])), 1)        # state before the first edit
        v = self.s.versions(p["id"])[0]
        restored = self.s.restore_version(v["id"])
        self.assertEqual(restored["content"][0]["content"][0]["text"], "hello")
        self.assertGreater(restored["rev"], p2["rev"])

    def test_backlink_snippet(self):
        a = self.s.create({"title": "OSPF"})
        mention = {"type": "pageMention", "props": {"pageId": a["id"], "title": "OSPF"}}
        text = lambda x: {"type": "text", "text": x, "styles": {}}
        self.s.create({"title": "Révisions", "content": [
            {"type": "paragraph", "content": [text("Rien ici")]},
            {"type": "bulletListItem", "content": [text("Voir "), mention, text(" avant le DS " + "x" * 200)], "children": []}]})
        bl = self.s.page(a["id"])["backlinks"]
        self.assertEqual(len(bl), 1)
        self.assertTrue(bl[0]["snippet"].startswith("Voir"))
        self.assertNotIn("Rien ici", bl[0]["snippet"])
        self.assertLessEqual(len(bl[0]["snippet"]), 140)

    def test_search_backlinks_duplicate(self):
        a = self.s.create({"title": "Réseaux", "markdown": "Le protocole OSPF est un protocole de routage"})
        b = self.s.create({"title": "Index", "content": [{"type": "paragraph", "content": [
            {"type": "pageMention", "props": {"pageId": a["id"], "title": "Réseaux"}}]}]})
        self.assertEqual(self.s.search("ospf")[0]["id"], a["id"])
        self.assertEqual(self.s.search("reseaux")[0]["id"], a["id"])             # accents ignored
        self.assertEqual([x["id"] for x in self.s.page(a["id"])["backlinks"]], [b["id"]])
        child = self.s.create({"title": "Sous", "parent_id": b["id"]})
        copy = self.s.duplicate(b["id"])
        kids = [p for p in self.s.tree() if p["parent_id"] == copy["id"]]
        self.assertEqual([k["title"] for k in kids], ["Sous"])
        self.assertNotEqual(kids[0]["id"], child["id"])

    def test_templates(self):
        t = self.s.create({"title": "Modèle cours", "markdown": "## Objectifs", "is_template": True})
        p = self.s.from_template(t["id"], None, "Séance 1")
        self.assertEqual(p["title"], "Séance 1")
        self.assertEqual(p["is_template"], 0)
        self.assertEqual(p["content"][0]["type"], "heading")


class ImportExportTests(unittest.TestCase):
    def test_obsidian_vault_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "Vault"
            (root / "Cours" / "SISR").mkdir(parents=True)
            (root / ".obsidian").mkdir()
            (root / "Cours" / "SISR" / "SISR.md").write_text("Hub de la matière, voir [[Switch]]", encoding="utf-8")
            (root / "Cours" / "SISR" / "Switch.md").write_text("---\ntype: cours\nprof: Dupont\n---\n# Switch\n\n![[schema.png]]\n\nRetour [[SISR]]", encoding="utf-8")
            (root / "Cours" / "SISR" / "schema.png").write_bytes(b"\x89PNG fake")
            (root / "Cours" / "Maths").mkdir()
            for i in range(3):
                (root / "Cours" / "Maths" / f"Chap {i}.md").write_text(f"---\nmatiere: Maths\ndate: 2026-11-0{i + 1}\nfait: true\n---\nTexte {i}", encoding="utf-8")
            s = Store(":memory:")
            files = Path(d) / "files"
            stats = transfer.import_path(s, files, root)
            self.assertEqual(stats["databases"], 1)                 # Maths: notes with front matter -> database
            tree = {p["title"]: p for p in s.tree()}
            self.assertNotIn(".obsidian", tree)
            self.assertEqual(tree["SISR"]["parent_id"], tree["Cours"]["id"])   # folder note = folder page
            sw = s.page(tree["Switch"]["id"])
            self.assertEqual(sw["content"][0]["type"], "image")                # title heading dropped, embed kept
            self.assertTrue(sw["content"][0]["props"]["url"].startswith("/files/"))
            self.assertEqual(sw["backlinks"][0]["id"], tree["SISR"]["id"])
            maths = s.page(tree["Maths"]["id"])
            self.assertEqual({p["name"]: p["type"] for p in maths["schema"]["properties"]},
                             {"matiere": "select", "date": "date", "fait": "checkbox"})
            self.assertEqual(len(maths["rows"]), 3)
            data = transfer.export_zip(s, files)
            s.close()
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = z.namelist()
            self.assertIn("Vault/Cours/SISR/Switch.md", names)
            self.assertTrue(any(n.startswith("_files/") for n in names))

    def test_zip_slip_refused(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("../evil.md", "x")
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                transfer.safe_extract(buf.getvalue(), Path(d))


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.httpd, self.app = make_server(Config(data_dir=Path(self.tmp.name)))
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.store.close()
        self.tmp.cleanup()

    def req(self, method, path, body=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        h = {"Content-Type": "application/json"} if body is not None else {}
        h.update(headers or {})
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r) as res:
                txt = res.read()
                return res.status, (json.loads(txt) if res.headers.get_content_type() == "application/json" and txt else txt)
        except urllib.error.HTTPError as e:
            txt = e.read()
            try:
                return e.code, json.loads(txt)
            except ValueError:
                return e.code, txt

    def test_api_flow(self):
        st, p = self.req("POST", "/api/pages", {"title": "Note", "markdown": "# Hello\n\nworld"})
        self.assertEqual(st, 200)
        st, md_out = self.req("GET", f"/api/pages/{p['id']}?format=markdown")
        self.assertIn("world", md_out["markdown"])
        st, db = self.req("POST", "/api/pages", {"kind": "database", "title": "DB", "schema": {"properties": [
            {"id": "s", "name": "Statut", "type": "select"}]}})
        st, row = self.req("POST", f"/api/databases/{db['id']}/rows", {"title": "R1", "props": {"Statut": "Fait"}, "markdown": "corps"})
        self.assertEqual(st, 200)
        st, rows = self.req("GET", f"/api/databases/{db['id']}/rows?Statut=fait")
        self.assertEqual([r["title"] for r in rows["results"]], ["R1"])
        st, res = self.req("GET", "/api/search?q=world")
        self.assertEqual(res["results"][0]["id"], p["id"])
        st, _ = self.req("DELETE", f"/api/pages/{p['id']}")
        self.assertEqual(st, 200)
        st, trash = self.req("GET", "/api/trash")
        self.assertEqual(len(trash["results"]), 1)

    def test_csrf_and_host_checks(self):
        st, _ = self.req("POST", "/api/pages", raw=b"title=x", headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(st, 415)
        st, _ = self.req("POST", "/api/pages", {"title": "x"}, headers={"Origin": "http://evil.example"})
        self.assertEqual(st, 403)
        st, _ = self.req("GET", "/api/bootstrap", headers={"Host": "evil.example"})
        self.assertEqual(st, 421)
        st, _ = self.req("POST", "/api/files", raw=b"data", headers={"Content-Type": "text/plain"})
        self.assertEqual(st, 415)                                        # uploads need the custom header

    def test_upload_and_serve_file(self):
        st, up = self.req("POST", "/api/files", raw=b"<svg onload=alert(1)>", headers={
            "X-Carnet-Upload": "1", "X-Filename": "x.svg", "Content-Type": "image/svg+xml"})
        self.assertEqual(st, 200)
        r = urllib.request.urlopen(f"http://127.0.0.1:{self.port}{up['url']}")
        self.assertEqual(r.headers.get_content_type(), "application/octet-stream")    # never rendered as SVG
        self.assertIn("sandbox", r.headers["Content-Security-Policy"])
        self.assertIn("attachment", r.headers["Content-Disposition"])

    def test_upload_keeps_large_files_intact_and_refuses_oversize(self):
        import os
        blob = os.urandom(3 * 1024 * 1024 + 7)
        st, up = self.req("POST", "/api/files", raw=blob, headers={
            "X-Carnet-Upload": "1", "X-Filename": "b.bin", "Content-Type": "application/octet-stream"})
        self.assertEqual((st, up["size"]), (200, len(blob)))
        self.assertEqual(urllib.request.urlopen(f"http://127.0.0.1:{self.port}{up['url']}").read(), blob)
        self.app.c.max_upload_mb = 1
        st, _ = self.req("POST", "/api/files", raw=blob, headers={
            "X-Carnet-Upload": "1", "X-Filename": "b.bin", "Content-Type": "application/octet-stream"})
        self.assertEqual(st, 413)
        self.assertEqual(list((Path(self.tmp.name) / "tmp").glob("*")) if (Path(self.tmp.name) / "tmp").exists() else [], [])

    def test_web_page_csp_allows_only_own_and_nonced_scripts(self):
        import re
        from carnet import server
        idx = server.STATIC / "index.html"
        if not idx.is_file():
            self.skipTest("web app not built")
        self.app.c.extra_body = '<script>window.x = 1</script><script src="/tabs.js"></script>'
        r = urllib.request.urlopen(f"http://127.0.0.1:{self.port}/")
        csp = r.headers["Content-Security-Policy"]
        html = r.read().decode()
        m = re.search(r"script-src 'self' 'nonce-([A-Za-z0-9_-]{16,})'", csp)
        self.assertTrue(m, csp)
        self.assertNotIn("unsafe-inline", csp.split("script-src")[1].split(";")[0])
        scripts = re.findall(r"<script\b[^>]*>", html)
        self.assertTrue(scripts)
        for tag in scripts:
            self.assertIn(f'nonce="{m.group(1)}"', tag)
        r2 = urllib.request.urlopen(f"http://127.0.0.1:{self.port}/")
        self.assertNotEqual(r2.headers["Content-Security-Policy"], csp)          # a new nonce per page

    def test_data_dir_is_private(self):
        import os
        from carnet.server import make_app
        d = Path(self.tmp.name) / "shared"
        d.mkdir()
        d.chmod(0o775)
        make_app(Config(data_dir=d)).store.close()
        self.assertEqual(os.stat(d).st_mode & 0o777, 0o700)

    def test_import_zip_endpoint(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("Vault/Note.md", "# Note\n\nSee [[Other]]")
            z.writestr("Vault/Other.md", "other")
        st, stats = self.req("POST", "/api/import", raw=buf.getvalue(), headers={
            "X-Carnet-Upload": "1", "X-Filename": "Vault.zip", "Content-Type": "application/zip"})
        self.assertEqual(st, 200, stats)
        self.assertEqual(stats["pages"], 3)
        st, tree = self.req("GET", "/api/bootstrap")
        self.assertEqual(sorted(p["title"] for p in tree["tree"]), ["Note", "Other", "Vault"])

    def test_password_protection(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.store.close()
        self.httpd, self.app = make_server(Config(data_dir=Path(self.tmp.name), password="s3cret", tokens=["tok"]))
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        st, _ = self.req("GET", "/api/bootstrap")
        self.assertEqual(st, 401)
        st, _ = self.req("GET", "/api/bootstrap", headers={"Authorization": "Bearer tok"})
        self.assertEqual(st, 200)
        st, _ = self.req("POST", "/api/login", {"password": "nope"})
        self.assertEqual(st, 401)


if __name__ == "__main__":
    unittest.main()


class WikiLinkApiTest(unittest.TestCase):
    def test_markdown_links_resolve_by_title(self):
        import tempfile
        from pathlib import Path
        from carnet.store import Store
        s = Store(Path(tempfile.mkdtemp()) / "c.db")
        a = s.create({"title": "Tailscale"})
        b = s.create({"title": "Note", "markdown": "Voir [[tailscale]] et [[Inconnue]]."})
        inl = b["content"][0]["content"]
        self.assertTrue(any(n["type"] == "pageMention" and n["props"]["pageId"] == a["id"] for n in inl))
        s.update(b["id"], {"markdown": "- et [[Tailscale|le VPN]]", "append": True})
        self.assertIn(a["id"], json.dumps(s.page(b["id"])["content"]))
        s.close()
