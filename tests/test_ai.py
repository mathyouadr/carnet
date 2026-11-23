import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from carnet.config import Config
from carnet.server import make_server


class ServerCase(unittest.TestCase):
    """A Carnet server on a free port; subclasses set `config_extra`."""
    config_extra: dict = {}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.httpd, self.app = make_server(Config(data_dir=Path(self.tmp.name), **self.make_config()))
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def make_config(self) -> dict:
        return dict(self.config_extra)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.store.close()
        self.tmp.cleanup()

    def raw(self, method, path, body=None, headers=None, data=None):
        """-> (status, headers, bytes)"""
        if data is None and body is not None:
            data = json.dumps(body).encode()
        h = {"Content-Type": "application/json"} if data is not None else {}
        h.update(headers or {})
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=20) as res:
                return res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()


class AIConfigTests(ServerCase):
    def test_env_parsing(self):
        env = {"CARNET_AI_URL": "http://x:1/v1/", "CARNET_AI_NAME": "Hermes", "CARNET_AI_TIMEOUT": "30"}
        with mock.patch.dict(os.environ, env, clear=False):
            c = Config.from_env("/dev/null")
        self.assertEqual(c.ai_url, "http://x:1/v1")
        self.assertEqual(c.ai_name, "Hermes")
        self.assertEqual(c.ai_timeout, 30)
        self.assertEqual(c.ai_model, "hermes-agent")
        self.assertTrue(c.ai_enabled)
        self.assertFalse(Config().ai_enabled)

    def test_bootstrap_flag_off_by_default(self):
        st, _, body = self.raw("GET", "/api/bootstrap")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(body)["info"]["ai"], {"enabled": False, "name": "AI"})


class AISecretsTests(ServerCase):
    config_extra = {"ai_url": "http://secret-host:9/v1", "ai_key": "sk-TOPSECRET", "ai_name": "Hermes"}

    def test_secrets_never_exposed(self):
        st, _, body = self.raw("GET", "/api/bootstrap")
        self.assertEqual(json.loads(body)["info"]["ai"], {"enabled": True, "name": "Hermes"})
        _, _, page = self.raw("GET", "/")
        for blob in (body, page):
            self.assertNotIn(b"secret-host", blob)
            self.assertNotIn(b"TOPSECRET", blob)


if __name__ == "__main__":
    unittest.main()
