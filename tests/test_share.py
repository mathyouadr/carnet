import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from carnet import share
from carnet.config import Config
from carnet.server import make_server, make_share_server
from carnet.store import NotFound, Store


def para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def text(s, **styles):
    return {"type": "text", "text": s, "styles": styles}


class ShareStoreTests(unittest.TestCase):
    def setUp(self):
        self.s = Store(":memory:")

    def tearDown(self):
        self.s.close()

    def test_share_is_idempotent_and_revocable(self):
        p = self.s.create({"title": "TP VLAN"})
        a = self.s.share_create(p["id"])
        self.assertGreaterEqual(len(a["token"]), 22)
        self.assertEqual(self.s.share_create(p["id"])["token"], a["token"])
        self.assertEqual(self.s.share_root(a["token"]), p["id"])
        self.assertEqual(self.s.page(p["id"])["share"]["token"], a["token"])
        self.s.share_delete(p["id"])
        self.assertIsNone(self.s.share_get(p["id"]))
        with self.assertRaises(NotFound):
            self.s.share_root(a["token"])

    def test_trash_and_delete_stop_the_link(self):
        a = self.s.create({"title": "A"})
        b = self.s.create({"title": "B", "parent_id": a["id"]})
        tok = self.s.share_create(b["id"])["token"]
        self.s.trash(a["id"])                              # an ancestor in the trash hides the shared page
        with self.assertRaises(NotFound):
            self.s.share_root(tok)
        self.s.restore(a["id"])
        self.assertEqual(self.s.share_root(tok), b["id"])
        self.s.delete_forever(a["id"])
        self.assertEqual(self.s.q("SELECT * FROM shares"), [])

    def test_bad_tokens(self):
        for tok in ("", "_", "x" * 200, "../etc", None):
            with self.assertRaises(NotFound):
                self.s.share_root(tok)


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.s = Store(":memory:")
        self.root = self.s.create({"title": "TP <VLAN>", "icon": "🖥️", "content": [
            {"type": "heading", "props": {"level": 1}, "content": [text("Objectif")]},
            para(text("gras", bold=True), text(" et "), text("<script>alert(1)</script>")),
            {"type": "bulletListItem", "content": [text("un")]},
            {"type": "bulletListItem", "content": [text("deux")]},
            {"type": "codeBlock", "props": {"language": "bash"}, "content": [text("show vlan brief")]},
            {"type": "math", "props": {"latex": "x^2"}},
            {"type": "image", "props": {"url": "/files/abc123/schema.png", "caption": "Schéma"}},
            para({"type": "link", "href": "javascript:alert(1)", "content": [text("piège")]}),
            para({"type": "link", "href": "https://cisco.com", "content": [text("cisco")]}),
        ]})
        self.sub = self.s.create({"title": "Annexe", "parent_id": self.root["id"]})
        self.private = self.s.create({"title": "Secret perso"})
        self.s.update(self.root["id"], {"content": self.s.page(self.root["id"])["content"] + [
            {"type": "pageLink", "props": {"pageId": self.sub["id"]}},
            {"type": "pageLink", "props": {"pageId": self.private["id"]}},
            para({"type": "pageMention", "props": {"pageId": self.private["id"], "title": "Secret perso"}}),
        ]})
        self.tok = self.s.share_create(self.root["id"])["token"]
        self.r = share.Renderer(self.s, prefix="/notes", lang="fr")

    def tearDown(self):
        self.s.close()

    def test_root_page(self):
        status, body = self.r.page(self.tok, None)
        self.assertEqual(status, 200)
        self.assertIn("TP &lt;VLAN&gt;", body)
        self.assertIn("<strong>gras</strong>", body)
        self.assertNotIn("<script>alert", body)
        self.assertIn("&lt;script&gt;", body)
        self.assertIn("<ul>", body)
        self.assertIn('class="language-bash"', body)
        self.assertIn(f'src="/notes/s/{self.tok}/files/abc123/schema.png"', body)
        self.assertNotIn("javascript:", body)
        self.assertIn('href="https://cisco.com"', body)
        self.assertIn(f'href="/notes/s/{self.tok}/{self.sub["id"]}"', body)
        self.assertNotIn(self.private["id"], body)
        self.assertNotIn("Secret perso", body.split("<main")[1].split("Page non partagée")[0])
        self.assertIn('data-latex="x^2"', body)
        self.assertIn('name="robots" content="noindex', body)

    def test_sub_page_and_outside_pages(self):
        status, body = self.r.page(self.tok, self.sub["id"])
        self.assertEqual(status, 200)
        self.assertIn("Annexe", body)
        self.assertIn(f'href="/notes/s/{self.tok}"', body)        # breadcrumb back to the shared root
        self.assertEqual(self.r.page(self.tok, self.private["id"])[0], 404)
        self.assertEqual(self.r.page("nope" * 6, None)[0], 404)

    def test_files_only_from_shared_pages(self):
        self.assertTrue(self.r.file_allowed(self.tok, "abc123"))
        self.assertFalse(self.r.file_allowed(self.tok, "zzz999"))
        self.assertFalse(self.r.file_allowed("bad", "abc123"))

    def test_database_rows_and_view_filters(self):
        db = self.s.create({"kind": "database", "title": "Séances", "parent_id": self.root["id"], "schema": {"properties": [
            {"id": "mat", "name": "Matière", "type": "select", "options": [{"id": "o1", "name": "SISR", "color": "blue"},
                                                                             {"id": "o2", "name": "SLAM"}]},
            {"id": "d", "name": "Date", "type": "date"},
            {"id": "ok", "name": "Fait", "type": "checkbox"}]},
            "views": [{"id": "v1", "name": "Tout", "type": "table"},
                      {"id": "v2", "name": "SISR", "type": "table", "embed_only": True,
                       "filters": [{"prop": "mat", "op": "is", "value": "o1"}]}]})
        r1 = self.s.create({"parent_id": db["id"], "title": "OSPF", "props": {"mat": "o1", "d": "2026-11-24", "ok": True}})
        self.s.create({"parent_id": db["id"], "title": "PHP", "props": {"mat": "o2"}})
        status, body = self.r.page(self.tok, db["id"])
        self.assertEqual(status, 200)
        self.assertIn("OSPF", body)
        self.assertIn("PHP", body)
        self.assertIn("24/11/2026", body)
        status, body = self.r.page(self.tok, r1["id"])
        self.assertIn("Matière", body)
        self.assertIn("SISR", body)
        self.s.update(self.sub["id"], {"content": [{"type": "database", "props": {"pageId": db["id"], "viewId": "v2"}}]})
        body = self.r.page(self.tok, self.sub["id"])[1]
        self.assertIn("OSPF", body)
        self.assertNotIn("PHP", body)


class ShareHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        cfg = Config(data_dir=Path(self.tmp.name), password="pw", base_path="/notes", lang="fr")
        cfg.data_dir.mkdir(exist_ok=True)
        self.httpd, self.app = make_server(cfg)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}/notes"
        self.shttpd = make_share_server(self.app, 0)
        threading.Thread(target=self.shttpd.serve_forever, daemon=True).start()
        self.sbase = f"http://127.0.0.1:{self.shttpd.server_address[1]}"
        s = self.app.store
        self.page = s.create({"title": "Partagée", "markdown": "Bonjour ![x](/files/f1/a.txt)"})
        files = self.app.c.files_dir
        files.mkdir(parents=True, exist_ok=True)
        (files / "f1").write_bytes(b"hello")
        s.x("INSERT INTO files (id, name, mime, size, page_id, created_at) VALUES ('f1','a.txt','text/plain',5,?,'x')",
            (self.page["id"],))
        (files / "f2").write_bytes(b"secret")
        s.x("INSERT INTO files (id, name, mime, size, page_id, created_at) VALUES ('f2','b.txt','text/plain',6,NULL,'x')")
        self.tok = s.share_create(self.page["id"])["token"]

    def tearDown(self):
        self.httpd.shutdown()
        self.shttpd.shutdown()
        self.httpd.server_close()
        self.shttpd.server_close()
        self.app.store.close()
        self.tmp.cleanup()

    def get(self, url):
        try:
            with urllib.request.urlopen(url) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_public_server_only_serves_shares(self):
        st, h, body = self.get(f"{self.sbase}/s/{self.tok}")
        self.assertEqual(st, 200)
        self.assertIn("Partagée", body.decode())
        self.assertIn("noindex", h["X-Robots-Tag"])
        self.assertEqual(h["Referrer-Policy"], "no-referrer")
        self.assertIn("default-src 'none'", h["Content-Security-Policy"])
        self.assertEqual(self.get(f"{self.sbase}/s/{self.tok}/files/f1/a.txt")[2], b"hello")
        self.assertEqual(self.get(f"{self.sbase}/s/{self.tok}/files/f2/b.txt")[0], 404)
        self.assertEqual(self.get(f"{self.sbase}/s/_/share.css")[0], 200)
        for path in ("/api/bootstrap", "/notes/api/bootstrap", "/", "/files/f1/a.txt", "/notes/", "/healthz/../api/bootstrap"):
            self.assertEqual(self.get(self.sbase + path)[0], 404, path)
        self.assertIn(b"Disallow: /", self.get(self.sbase + "/robots.txt")[2])

    def test_main_server_share_route_without_login(self):
        self.assertEqual(self.get(f"{self.base}/api/bootstrap")[0], 401)
        st, _, body = self.get(f"{self.base}/s/{self.tok}")
        self.assertEqual(st, 200)
        self.assertIn(f'/notes/s/{self.tok}/files/f1/a.txt', body.decode())

    def test_api_share_routes(self):
        req = urllib.request.Request(f"{self.base}/api/login", data=json.dumps({"password": "pw"}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as r:
            cookie = r.headers["Set-Cookie"].split(";")[0]

        def call(method, path):
            rq = urllib.request.Request(self.base + path, method=method, data=b"{}" if method != "GET" else None,
                                        headers={"Cookie": cookie, "Content-Type": "application/json"})
            with urllib.request.urlopen(rq) as r:
                return json.loads(r.read() or b"null")

        other = self.app.store.create({"title": "Autre"})
        self.assertFalse(call("GET", f"/api/pages/{other['id']}/share")["shared"])
        child = self.app.store.create({"title": "Sous", "parent_id": self.page["id"]})
        self.assertEqual(call("GET", f"/api/pages/{child['id']}/share")["inherited"]["id"], self.page["id"])
        out = call("POST", f"/api/pages/{other['id']}/share")
        self.assertTrue(out["shared"])
        self.assertTrue(out["path"].endswith("/s/" + out["token"]))
        self.assertEqual(self.get(f"{self.sbase}/s/{out['token']}")[0], 200)
        call("DELETE", f"/api/pages/{other['id']}/share")
        self.assertEqual(self.get(f"{self.sbase}/s/{out['token']}")[0], 404)


if __name__ == "__main__":
    unittest.main()
