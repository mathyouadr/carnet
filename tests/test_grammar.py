import json
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from carnet import grammar
from tests.test_ai import ServerCase


class FakeLT(BaseHTTPRequestHandler):
    """Flags every "sui" as a mistake, like LanguageTool would."""
    seen: list = []

    def do_POST(self):
        form = urllib.parse.parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        text = form["text"][0]
        FakeLT.seen.append((text, form["language"][0]))
        matches, i = [], text.find("sui")
        while i >= 0:
            matches.append({"offset": i, "length": 3, "message": "Faute", "replacements": [{"value": "suis"}],
                            "rule": {"id": "JE_SUI", "issueType": "grammar", "category": {"id": "GRAMMAR"}}})
            i = text.find("sui", i + 1)
        body = json.dumps({"matches": matches}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class ChunkTests(unittest.TestCase):
    def test_chunks_cover_the_text_and_cut_at_paragraphs(self):
        text = ("a" * 40 + "\n\n") * 10
        parts = grammar.chunks(text, 100)
        self.assertEqual("".join(p for _, p in parts), text)
        for off, p in parts:
            self.assertEqual(text[off:off + len(p)], p)
            self.assertTrue(p.endswith("\n\n"))


class GrammarOffTests(ServerCase):
    def test_off_by_default(self):
        st, _, body = self.raw("GET", "/api/bootstrap")
        self.assertFalse(json.loads(body)["info"]["grammar"])
        self.assertEqual(self.raw("POST", "/api/grammar", {"text": "x"})[0], 404)


class GrammarTests(ServerCase):
    def make_config(self):
        self.lt = ThreadingHTTPServer(("127.0.0.1", 0), FakeLT)
        threading.Thread(target=self.lt.serve_forever, daemon=True).start()
        return {"grammar_url": f"http://127.0.0.1:{self.lt.server_address[1]}", "grammar_lang": "fr"}

    def tearDown(self):
        super().tearDown()
        if self.lt:
            self.lt.shutdown()
            self.lt.server_close()

    def test_check_and_offsets_across_chunks(self):
        self.assertTrue(json.loads(self.raw("GET", "/api/bootstrap")[2])["info"]["grammar"])
        text = "Je sui là.\n\n" + "b" * (grammar.CHUNK) + "\n\nTu sui"
        st, _, body = self.raw("POST", "/api/grammar", {"text": text})
        self.assertEqual(st, 200)
        ms = json.loads(body)["matches"]
        self.assertEqual([text[m["offset"]:m["offset"] + m["length"]] for m in ms], ["sui", "sui"])
        self.assertEqual(ms[0]["replacements"], ["suis"])
        self.assertEqual(FakeLT.seen[-1][1], "fr")

    def test_bad_requests(self):
        self.assertEqual(self.raw("POST", "/api/grammar", {"text": 3})[0], 400)
        self.assertEqual(self.raw("POST", "/api/grammar", {"text": "x", "language": "zz"})[0], 400)
        self.assertEqual(self.raw("POST", "/api/grammar", {"text": "x" * (grammar.MAX_TEXT + 1)})[0], 413)
        self.assertEqual(self.raw("GET", "/api/grammar")[0], 405)

    def test_server_down(self):
        self.lt.shutdown()
        self.lt.server_close()
        self.lt = None
        self.app.c.grammar_url = "http://127.0.0.1:9"
        self.assertEqual(self.raw("POST", "/api/grammar", {"text": "Je sui"})[0], 502)


if __name__ == "__main__":
    unittest.main()
