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

    def test_whole_page_commands_get_the_whole_page(self):
        page = "début " + "x" * 50000 + " FIN-DE-PAGE"
        for cmd in ("summarize_page", "action_items"):
            last = self.build(command=cmd, selection_md="", context_md=page)[-1]["content"]
            self.assertIn("FIN-DE-PAGE", last)
        huge = "y" * 100000 + "TAIL"
        last = self.build(command="summarize_page", selection_md="", context_md=huge)[-1]["content"]
        self.assertNotIn("TAIL", last)
        self.assertIn("truncated", last)

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


class FakeUpstream:
    """OpenAI-compatible SSE server. `script` = list of content deltas, or an int HTTP status."""

    def __init__(self):
        import http.server
        self.script = ["Bon", "jour"]
        self.done = True
        self.hang = 0.0
        self.chunked_cut = False          # chunked body cut mid-stream (http.client.IncompleteRead)
        self.requests = []
        self.closed = threading.Event()
        up = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                up.requests.append({"headers": dict(self.headers), "body": json.loads(self.rfile.read(n))})
                if isinstance(up.script, int):
                    self.send_response(up.script)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if up.chunked_cut:
                    self.protocol_version = "HTTP/1.1"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    part = b'data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n'
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(part), part))
                    self.wfile.write(b"100\r\nshort")          # announces 256 bytes, sends 5, then closes
                    self.wfile.flush()
                    self.close_connection = True
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                try:
                    self.wfile.write(b'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
                    for d in up.script:
                        self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": {"content": d}}]}).encode() + b"\n\n")
                        self.wfile.flush()
                    if up.hang:
                        import time
                        end = time.time() + up.hang
                        while time.time() < end:          # keep writing keepalives until the reader goes away
                            time.sleep(0.1)
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                    if up.done:
                        self.wfile.write(b"data: [DONE]\n\n")
                except (BrokenPipeError, ConnectionResetError):
                    up.closed.set()

        from http.server import ThreadingHTTPServer
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def sse_events(blob: bytes) -> list:
    return [json.loads(line[5:]) for line in blob.decode().splitlines() if line.startswith("data:")]


PARA = [{"type": "paragraph", "content": [{"type": "text", "text": "Salut", "styles": {}}]}]


class AIHTTPTests(ServerCase):
    def make_config(self):
        self.up = FakeUpstream()
        self.mdtmp = tempfile.TemporaryDirectory()
        Path(self.mdtmp.name, "Note.md").write_text("# Note\n\nhello", encoding="utf-8")
        return {"ai_url": f"http://127.0.0.1:{self.up.port}/v1", "ai_key": "sk-TOPSECRET",
                "md_folders": f"N={self.mdtmp.name}"}

    def tearDown(self):
        super().tearDown()
        self.up.stop()
        self.mdtmp.cleanup()

    def page_id(self):
        _, _, b = self.raw("POST", "/api/pages", {"title": "P", "markdown": "Salut"})
        return json.loads(b)["id"]

    def ask(self, **kw):
        body = {"page_id": self.page_id(), "command": "fix", "selection": PARA, "context": PARA}
        body.update(kw)
        st, hdrs, blob = self.raw("POST", "/api/ai", body)
        self.all_bytes = getattr(self, "all_bytes", b"") + blob
        return st, hdrs, blob

    def test_stream_relay(self):
        st, hdrs, blob = self.ask()
        self.assertEqual(st, 200)
        self.assertTrue(hdrs.get("Content-Type", "").startswith("text/event-stream"))
        self.assertEqual(sse_events(blob), [{"selection_md": "Salut"}, {"delta": "Bon"}, {"delta": "jour"}, {"done": True}])
        self.ask()
        r1, r2 = self.up.requests
        self.assertEqual(r1["headers"].get("Authorization"), "Bearer sk-TOPSECRET")
        self.assertTrue(r1["body"]["stream"])
        self.assertEqual(r1["body"]["model"], "hermes-agent")
        self.assertTrue(r1["headers"].get("X-Hermes-Session-Id"))
        self.assertNotEqual(r1["headers"]["X-Hermes-Session-Id"], r2["headers"]["X-Hermes-Session-Id"])

    def test_secret_not_in_response(self):
        self.ask()
        self.up.script = 500
        self.ask()
        for blob in (self.all_bytes, self.raw("GET", "/api/bootstrap")[2]):
            self.assertNotIn(b"TOPSECRET", blob)
            self.assertNotIn(str(self.up.port).encode(), blob)

    def test_upstream_errors(self):
        self.up.script = 500
        self.assertEqual(sse_events(self.ask()[2])[-1], {"error": "AI server error (500)"})
        self.up.script, self.up.done = ["Bon"], False
        ev = sse_events(self.ask()[2])
        self.assertIn("error", ev[-1])
        self.assertNotIn({"done": True}, ev)
        self.up.stop()
        self.assertEqual(sse_events(self.ask()[2])[-1], {"error": "AI server unreachable"})
        self.up = FakeUpstream()                     # for tearDown

    def test_custom_prompt_gets_related_notes(self):
        self.raw("POST", "/api/pages", {"title": "Réseau OSPF", "markdown": "Le protocole ospfv2 utilise des areas."})
        trashed = json.loads(self.raw("POST", "/api/pages", {"title": "Vieux ospfv2", "markdown": "ospfv2 obsolète"})[2])
        self.raw("DELETE", f"/api/pages/{trashed['id']}")
        self.ask(command="custom", prompt="Explique ospfv2 simplement", selection=[])
        last = self.up.requests[-1]["body"]["messages"][-1]["content"]
        self.assertIn("Réseau OSPF", last)
        self.assertIn("utilise des areas", last)
        self.assertNotIn("Vieux ospfv2", last)

    def test_oversized_body_gets_413_not_a_broken_pipe(self):
        big = {"page_id": self.page_id(), "command": "fix", "selection": [],
               "context": [{"type": "paragraph", "content": [{"type": "text", "text": "x" * 4_000_000}]}]}
        for _ in range(3):
            self.assertEqual(self.raw("POST", "/api/ai", big)[0], 413)

    def test_chunked_cut_mid_stream(self):
        self.up.chunked_cut = True
        st, _, blob = self.ask()
        self.assertEqual(st, 200)
        ev = sse_events(blob)
        self.assertEqual(ev[1], {"delta": "Bon"})
        self.assertEqual(ev[-1], {"error": "AI answer interrupted"})
        self.assertNotIn(b"HTTP/1.1 500", blob)

    def test_guards(self):
        pid = self.page_id()
        body = {"page_id": pid, "command": "fix", "selection": PARA, "context": []}
        self.assertEqual(self.raw("POST", "/api/ai", body, headers={"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.raw("POST", "/api/ai", {**body, "page_id": "zzzz9999"})[0], 404)
        md_id = next(p["id"] for p in json.loads(self.raw("GET", "/api/bootstrap")[2])["tree"] if p.get("readonly"))
        self.assertEqual(self.raw("POST", "/api/ai", {**body, "page_id": md_id})[0], 403)
        self.assertEqual(self.raw("POST", "/api/ai", data=json.dumps(body).encode(),
                                  headers={"Content-Type": "text/plain"})[0], 415)
        big = {**body, "context": [{"type": "paragraph", "content": [{"type": "text", "text": "x" * 1100000}]}]}
        self.assertEqual(self.raw("POST", "/api/ai", big)[0], 413)
        self.assertEqual(self.raw("POST", "/api/ai", {**body, "command": "nope"})[0], 400)
        self.assertEqual(len(self.up.requests), 0)

    def test_client_disconnect(self):
        import socket
        self.up.script, self.up.hang = ["Bon"], 8
        payload = json.dumps({"page_id": self.page_id(), "command": "fix", "selection": PARA, "context": []}).encode()
        s = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        s.sendall(b"POST /api/ai HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
                  b"Content-Length: " + str(len(payload)).encode() + b"\r\n\r\n" + payload)
        got = b""
        while b'"delta"' not in got:
            got += s.recv(4096)
        s.close()
        self.assertTrue(self.up.closed.wait(4), "upstream still open after the client left")

    def test_blocks_roundtrip(self):
        self.raw("POST", "/api/pages", {"title": "Some page"})
        st, _, b = self.raw("POST", "/api/ai/blocks", {"markdown": "> [!note] Hi\n\n$$x^2$$\n\n[[Some page]]"})
        self.assertEqual(st, 200)
        blocks = json.loads(b)["blocks"]
        types = [x["type"] for x in blocks]
        self.assertIn("callout", types)
        self.assertIn("math", types)
        self.assertIn("pageMention", json.dumps(blocks))


class AIDisabledTests(ServerCase):
    def test_disabled_404(self):
        _, _, b = self.raw("POST", "/api/pages", {"title": "P"})
        pid = json.loads(b)["id"]
        self.assertEqual(self.raw("POST", "/api/ai", {"page_id": pid, "command": "fix", "selection": [], "context": []})[0], 404)
        self.assertEqual(self.raw("POST", "/api/ai/blocks", {"markdown": "x"})[0], 404)


if __name__ == "__main__":
    unittest.main()
