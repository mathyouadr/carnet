import json

from tests.test_ai import ServerCase


class ClientLogTests(ServerCase):
    def test_browser_error_goes_to_the_server_log(self):
        with self.assertLogs("carnet", level="WARNING") as logs:
            st, _, body = self.raw("POST", "/api/client-log", {"kind": "render", "message": "boom\nline", "stack": "at x", "url": "/p/a"})
        self.assertEqual(st, 200)
        self.assertTrue(json.loads(body)["ok"])
        line = "\n".join(logs.output)
        self.assertIn("client error [render] boom line", line)       # one line, newlines folded
        self.assertIn("at /p/a", line)

    def test_long_fields_are_clipped(self):
        with self.assertLogs("carnet", level="WARNING") as logs:
            self.raw("POST", "/api/client-log", {"message": "x" * 5000, "stack": "y" * 9000})
        self.assertLess(len(logs.output[0]), 2000)

    def test_get_is_not_a_route(self):
        self.assertNotEqual(self.raw("GET", "/api/client-log")[0], 200)
