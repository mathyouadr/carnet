"""Regression tests for the backend review of 2026-11-24 (one class per area)."""
import http.client
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from carnet import transfer
from carnet.config import Config
from carnet.server import make_server
from carnet.store import Invalid, NotFound, Store


class ServerCase(unittest.TestCase):
    config_kwargs: dict = {}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.httpd, self.app = make_server(Config(data_dir=self.data, **self.config_kwargs))
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.store.close()
        self.tmp.cleanup()

    def raw(self, method, path, body=b"", headers=None, chunked=False):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            h = dict(headers or {})
            if chunked:
                conn.putrequest(method, path)
                h["Transfer-Encoding"] = "chunked"
                for k, v in h.items():
                    conn.putheader(k, v)
                conn.endheaders()
                for i in range(0, len(body), 1000):
                    piece = body[i:i + 1000]
                    conn.send(b"%x\r\n" % len(piece) + piece + b"\r\n")
                conn.send(b"0\r\n\r\n")
            else:
                conn.request(method, path, body=body, headers=h)
            res = conn.getresponse()
            return res.status, res.getheaders(), res.read()
        finally:
            conn.close()

    def call(self, method, path, obj=None, headers=None):
        body = json.dumps(obj).encode() if obj is not None else b""
        h = {"Content-Type": "application/json", **(headers or {})}
        st, _, data = self.raw(method, path, body, h)
        try:
            return st, json.loads(data)
        except ValueError:
            return st, data


class ChunkedAndLimitTests(ServerCase):
    def test_chunked_upload_is_stored_whole(self):
        blob = os.urandom(300_000)
        st, _, data = self.raw("POST", "/api/files", blob, {
            "X-Carnet-Upload": "1", "X-Filename": "c.bin", "Content-Type": "application/octet-stream"}, chunked=True)
        self.assertEqual(st, 200, data)
        up = json.loads(data)
        self.assertEqual(up["size"], len(blob))
        st, _, got = self.raw("GET", up["url"])
        self.assertEqual(got, blob)

    def test_chunked_json_body_is_decoded(self):
        st, _, data = self.raw("POST", "/api/pages", json.dumps({"title": "Chunked"}).encode(),
                               {"Content-Type": "application/json"}, chunked=True)
        self.assertEqual(st, 200, data)
        self.assertEqual(json.loads(data)["title"], "Chunked")

    def test_json_body_over_32mb_gets_413_not_400(self):
        big = b'{"title":"' + b"a" * (32 * 1024 * 1024 + 10) + b'"}'
        st, _, data = self.raw("POST", "/api/pages", big, {"Content-Type": "application/json"})
        self.assertEqual(st, 413, data[:200])

    def test_import_limit_follows_config(self):
        self.assertEqual(Config.from_env(env_file="/nonexistent").max_import_mb, 200)
        old = os.environ.get("CARNET_MAX_IMPORT_MB")
        os.environ["CARNET_MAX_IMPORT_MB"] = "1"
        try:
            self.assertEqual(Config.from_env(env_file="/nonexistent").max_import_mb, 1)
        finally:
            if old is None:
                os.environ.pop("CARNET_MAX_IMPORT_MB", None)
            else:
                os.environ["CARNET_MAX_IMPORT_MB"] = old
        self.app.c.max_import_mb = 1
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            z.writestr("Vault/Big.md", "x" * (2 * 1024 * 1024))
        st, _, data = self.raw("POST", "/api/import", buf.getvalue(), {
            "X-Carnet-Upload": "1", "X-Filename": "Vault.zip", "Content-Type": "application/zip"})
        self.assertEqual(st, 413, data[:200])


class ApiInputTests(ServerCase):
    def test_nan_literal_in_body_is_refused(self):
        st, _, data = self.raw("POST", "/api/pages", b'{"title":"x","props":{"n":NaN}}',
                               {"Content-Type": "application/json"})
        self.assertEqual(st, 400, data)

    def test_favorites_order_rejects_objects_with_400(self):
        st, out = self.call("POST", "/api/favorites/order", {"ids": [{}]})
        self.assertEqual(st, 400, out)

    def test_search_limit_is_clamped(self):
        for t in ("one", "two", "three"):
            self.call("POST", "/api/pages", {"title": t, "markdown": "zebra"})
        st, out = self.call("GET", "/api/search?q=zebra&limit=-1")
        self.assertEqual(st, 200, out)
        self.assertEqual(len(out["results"]), 1)

    def test_logout_refuses_cross_site(self):
        st, _ = self.call("POST", "/api/logout", {}, {"Origin": "http://evil.example"})
        self.assertEqual(st, 403)
        st, _ = self.call("POST", "/api/logout", {})
        self.assertEqual(st, 200)

    def test_range_request_gets_partial_content(self):
        blob = bytes(range(256)) * 400                       # 102400 bytes
        st, _, data = self.raw("POST", "/api/files", blob, {
            "X-Carnet-Upload": "1", "X-Filename": "r.bin", "Content-Type": "application/octet-stream"})
        url = json.loads(data)["url"]
        st, hdrs, got = self.raw("GET", url, headers={"Range": "bytes=10-19"})
        self.assertEqual(st, 206)
        self.assertEqual(dict(hdrs)["Content-Range"], f"bytes 10-19/{len(blob)}")
        self.assertEqual(got, blob[10:20])
        st, hdrs, got = self.raw("GET", url, headers={"Range": "bytes=-5"})
        self.assertEqual((st, got), (206, blob[-5:]))
        st, hdrs, got = self.raw("GET", url, headers={"Range": f"bytes={len(blob)}-"})
        self.assertEqual(st, 416)
        st, _, got = self.raw("GET", url)
        self.assertEqual(got, blob)

    def test_markdown_export_of_folder_page(self):
        folder = self.data / "notes"
        folder.mkdir()
        (folder / "Hello.md").write_text("# Hello\n\nfrom a folder", encoding="utf-8")
        self.httpd.shutdown()
        self.httpd.server_close()
        self.httpd, self.app = make_server(Config(data_dir=self.data, md_folders=f"Notes={folder}"))
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        pid = next(p["id"] for p in self.app.folders.tree() if p["title"] == "Hello")
        st, hdrs, body = self.raw("GET", f"/api/pages/{pid}/export.md")
        self.assertEqual(st, 200, body[:200])
        self.assertIn(b"from a folder", body)

    def test_forwarded_for_uses_the_rightmost_address(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.httpd, self.app = make_server(Config(data_dir=self.data, password="pw", trust_proxy=True))
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        for _ in range(8):
            self.app.fail("1.2.3.4")                         # the address the proxy saw
        st, _ = self.call("POST", "/api/login", {"password": "x"},
                          {"X-Forwarded-For": "6.6.6.6, 1.2.3.4"})   # the client forged the left part
        self.assertEqual(st, 429)


class StoreRegressionTests(unittest.TestCase):
    def setUp(self):
        self.s = Store(":memory:")

    def tearDown(self):
        self.s.close()

    def _db(self, *props):
        return self.s.create({"kind": "database", "title": "DB", "schema": {"properties": list(props)}})

    def test_non_finite_numbers_are_dropped(self):
        db = self._db({"id": "n", "name": "N", "type": "number"})
        row = self.s.create({"parent_id": db["id"], "title": "r", "props": {"n": "nan"}})
        self.assertNotIn("n", row["props"])
        row = self.s.create({"parent_id": db["id"], "title": "r2", "props": {"n": "1e400"}})
        self.assertNotIn("n", row["props"])
        row = self.s.create({"parent_id": db["id"], "title": "r3", "props": {"n": "2.5"}})
        self.assertEqual(row["props"], {"n": 2.5})

    def test_schema_options_survive_concurrent_rows(self):
        db = self._db({"id": "s", "name": "S", "type": "select", "options": []})
        old = sys.getswitchinterval()
        sys.setswitchinterval(1e-6)
        try:
            errors = []

            def add(i):
                try:
                    self.s.create({"parent_id": db["id"], "title": f"row{i}", "props": {"S": f"opt{i}"}})
                except Exception as e:             # pragma: no cover - reported below
                    errors.append(e)

            threads = [threading.Thread(target=add, args=(i,)) for i in range(30)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        finally:
            sys.setswitchinterval(old)
        self.assertEqual(errors, [])
        names = {o["name"] for o in self.s.page(db["id"])["schema"]["properties"][0]["options"]}
        self.assertEqual(names, {f"opt{i}" for i in range(30)})

    def test_purge_of_parent_and_child_completes(self):
        a = self.s.create({"title": "A"})
        b = self.s.create({"title": "B", "parent_id": a["id"]})
        self.s.trash(b["id"])
        self.s.trash(a["id"])
        self.assertEqual(self.s.purge_trash(days=-1), 2)
        self.assertEqual(self.s.trashed(), [])
        with self.assertRaises(NotFound):
            self.s.page(a["id"])

    def test_pages_cannot_be_created_under_a_trashed_parent(self):
        parent = self.s.create({"title": "P"})
        other = self.s.create({"title": "O"})
        child = self.s.create({"title": "C", "parent_id": parent["id"]})
        self.s.trash(parent["id"])
        with self.assertRaises(Invalid):
            self.s.create({"title": "new", "parent_id": parent["id"]})
        with self.assertRaises(Invalid):
            self.s.move(other["id"], parent["id"])
        with self.assertRaises(Invalid):
            self.s.duplicate(other["id"], parent_id=parent["id"])
        with self.assertRaises(Invalid):
            self.s.from_template(other["id"], child["id"])

    def test_restore_keeps_a_parent_that_is_only_hidden_by_an_ancestor(self):
        g = self.s.create({"title": "G"})
        p = self.s.create({"title": "P", "parent_id": g["id"]})
        c = self.s.create({"title": "C", "parent_id": p["id"]})
        self.s.trash(g["id"])
        self.s.trash(c["id"])
        self.assertEqual(self.s.restore(c["id"])["parent_id"], p["id"])
        self.s.restore(g["id"])
        self.assertIn(c["id"], {x["id"] for x in self.s.tree()})

    def test_restore_moves_to_root_when_parent_is_trashed(self):
        p = self.s.create({"title": "P"})
        c = self.s.create({"title": "C", "parent_id": p["id"]})
        self.s.trash(p["id"])
        self.s.trash(c["id"])
        self.assertIsNone(self.s.restore(c["id"])["parent_id"])

    def test_revision_check_happens_inside_the_write(self):
        p = self.s.create({"title": "T", "markdown": "one"})
        rev = p["rev"]
        real_row = self.s._row
        results = {}
        fired = []

        def other_writer(pid):
            # another client saves the same revision while this update is in flight
            try:
                results["other"] = self.s.update(pid, {"content": [], "rev": rev})
            except Exception as e:
                results["other"] = e

        def hooked(pid):
            row = real_row(pid)
            if not fired:
                fired.append(True)
                t = threading.Thread(target=other_writer, args=(pid,))
                results["thread"] = t
                t.start()
                t.join(timeout=1)
            return row

        self.s._row = hooked
        try:
            try:
                results["mine"] = self.s.update(p["id"], {"content": [], "rev": rev})
            except Exception as e:
                results["mine"] = e
        finally:
            self.s._row = real_row
            if "thread" in results:
                results["thread"].join(timeout=5)
        outcomes = [results.get("mine"), results.get("other")]
        conflicts = [o for o in outcomes if type(o).__name__ == "Conflict"]
        self.assertEqual(len(conflicts), 1, outcomes)

    def test_permanent_delete_removes_orphan_files(self):
        s = Store(self.data_path("orphan.db"), files_dir=self.data_path("files"))
        try:
            p = s.create({"title": "P"})
            fid = transfer.save_file(s, self.data_path("files"), "a.txt", b"hi", None, p["id"])
            s.delete_forever(p["id"])
            self.assertFalse((self.data_path("files") / fid).exists())
            with self.assertRaises(NotFound):
                s.file(fid)
        finally:
            s.close()

    def test_permanent_delete_keeps_files_still_referenced(self):
        s = Store(self.data_path("kept.db"), files_dir=self.data_path("files2"))
        try:
            p = s.create({"title": "P"})
            fid = transfer.save_file(s, self.data_path("files2"), "a.txt", b"hi", None, p["id"])
            s.create({"title": "Q", "content": [{"type": "image", "props": {"url": f"/files/{fid}"}}]})
            s.delete_forever(p["id"])
            self.assertTrue((self.data_path("files2") / fid).exists())
            self.assertEqual(s.file(fid)["name"], "a.txt")
        finally:
            s.close()

    def test_content_blocks_must_be_objects(self):
        with self.assertRaises(Invalid):
            self.s.create({"title": "x", "content": [1]})
        p = self.s.create({"title": "ok"})
        with self.assertRaises(Invalid):
            self.s.update(p["id"], {"content": ["text"]})

    def data_path(self, name):
        if not hasattr(self, "_tmp"):
            self._tmp = tempfile.TemporaryDirectory()
            self.addCleanup(self._tmp.cleanup)
        return Path(self._tmp.name) / name


if __name__ == "__main__":
    unittest.main()
