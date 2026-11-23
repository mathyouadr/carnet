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


class AICoreTests(unittest.TestCase):
    def build(self, **kw):
        from carnet import ai
        args = dict(command="fix", prompt="", title="Ma page", selection_md="Salut le mond", context_md="",
                    hits=[], history=[], extra_system="")
        args.update(kw)
        return ai.build_messages(**args)

    def test_build_messages_shape(self):
        from carnet import ai
        hist = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
        msgs = self.build(history=hist, extra_system="Tu es Hermes.")
        self.assertEqual(msgs[0]["role"], "system")
        sysmsg = msgs[0]["content"]
        for needle in ("Markdown", "no preamble", "same language", "Tu es Hermes."):
            self.assertIn(needle, sysmsg)
        self.assertEqual(msgs[1:3], hist)
        last = msgs[-1]
        self.assertEqual(last["role"], "user")
        for needle in (ai.COMMANDS["fix"], "Salut le mond", "Ma page"):
            self.assertIn(needle, last["content"])

    def test_unknown_command_and_custom(self):
        with self.assertRaises(ValueError):
            self.build(command="nope")
        with self.assertRaises(ValueError):
            self.build(command="custom", prompt="")
        self.assertIn("Fais un plan", self.build(command="custom", prompt="Fais un plan")[-1]["content"])

    def test_hits_capped(self):
        hits = [{"id": f"p{i}", "title": f"Hit{i}", "snippet": chr(65 + i) * 2000} for i in range(8)]
        last = self.build(command="custom", prompt="x", hits=hits)[-1]["content"]
        self.assertIn("Hit4", last)
        self.assertNotIn("Hit5", last)
        self.assertNotIn("A" * 601, last)
        self.assertIn("A" * 600, last)

    def test_clip_context(self):
        from carnet import ai
        sel = "<<SELECTION>>"
        ctx = "x" * 25000 + sel + "y" * 25000
        out = ai.clip_context(ctx, sel)
        self.assertLessEqual(len(out), 12000)
        self.assertIn(sel, out)
        self.assertEqual(ai.clip_context("short", "s"), "short")
        self.assertEqual(len(ai.clip_selection("z" * 30000)), 20000)

    def test_iter_deltas(self):
        from carnet import ai
        lines = [b'data: {"choices":[{"delta":{"role":"assistant"}}]}', b'', b'event: hermes.tool.progress',
                 b'data: {"tool":"x"}', b'', b'data: {"choices":[{"delta":{"content":"Bon"}}]}', b': keepalive',
                 b'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}',
                 b'data: {"choices":[{"delta":{"content":"jour"}}]}', b'data: [DONE]',
                 b'data: {"choices":[{"delta":{"content":"after"}}]}']
        self.assertEqual(list(ai.iter_deltas(lines)), ["Bon", "jour"])

    def test_iter_deltas_error(self):
        from carnet import ai
        with self.assertRaises(ai.UpstreamError) as cm:
            list(ai.iter_deltas([b'data: {"error":{"message":"boom"}}']))
        self.assertIn("boom", str(cm.exception))

    def test_iter_deltas_needs_done(self):
        from carnet import ai
        with self.assertRaises(ai.UpstreamError):
            list(ai.iter_deltas([b'data: {"choices":[{"delta":{"content":"Bon"}}]}']))


if __name__ == "__main__":
    unittest.main()
