import json
import tempfile
import unittest
from pathlib import Path

from carnet import offline
from tests.test_ai import ServerCase


class ManifestTests(unittest.TestCase):
    def test_version_follows_the_asset_files(self):
        with tempfile.TemporaryDirectory() as d:
            s = Path(d)
            (s / "assets").mkdir()
            (s / "assets" / "index-abc.js").write_text("x")
            v1, a1 = offline.manifest(s, "1.0.0")
            self.assertEqual(a1, ["assets/index-abc.js"])
            (s / "assets" / "python-def.js").write_text("y")
            v2, a2 = offline.manifest(s, "1.0.0")
            self.assertNotEqual(v1, v2)
            self.assertEqual(a2, ["assets/index-abc.js", "assets/python-def.js"])
            self.assertNotEqual(offline.manifest(s, "1.0.1")[0], v2)

    def test_render_fills_the_template(self):
        with tempfile.TemporaryDirectory() as d:
            s = Path(d)
            (s / "assets").mkdir()
            (s / "assets" / "a.css").write_text("x")
            js = offline.render_sw(s, "1.0.0", "/notes")
            self.assertNotIn("{{", js)
            self.assertIn('"/notes"', js)
            self.assertIn('"assets/a.css"', js)


class OfflineOffTests(ServerCase):
    def test_sw_404_without_the_option(self):
        self.assertEqual(self.raw("GET", "/sw.js")[0], 404)
        _, _, body = self.raw("GET", "/api/bootstrap")
        self.assertFalse(json.loads(body)["info"]["offline"])


class OfflineOnTests(ServerCase):
    config_extra = {"offline": True}

    def test_sw_served(self):
        st, h, body = self.raw("GET", "/sw.js")
        self.assertEqual(st, 200)
        self.assertIn("javascript", h["Content-Type"])
        self.assertEqual(h["Service-Worker-Allowed"], "/")
        self.assertIn("no-cache", h["Cache-Control"])
        self.assertIn(b"importScripts", body)
        st, _, lib = self.raw("GET", "/sw-lib.js")
        self.assertEqual(st, 200)
        self.assertIn(b"CarnetOffline", lib)
        _, _, boot = self.raw("GET", "/api/bootstrap")
        self.assertTrue(json.loads(boot)["info"]["offline"])
