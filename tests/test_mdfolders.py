import json
import tempfile
import time
import unittest
from pathlib import Path

from carnet.api import API
from carnet.mdfolders import MdFolders, parse_spec
from carnet.store import Store


class MdFoldersTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        root = self.dir / "vault"
        (root / "Homelab").mkdir(parents=True)
        (root / ".obsidian").mkdir()
        (root / "Vide" / "Sous").mkdir(parents=True)      # folders without notes are not shown
        (root / ".obsidian" / "x.md").write_text("hidden")
        (root / "Index.md").write_text("---\ntags: [hub]\n---\n# Index\n\nVoir [[srv-01]] et [[Homelab/Tailscale|le VPN]].\n")
        (root / "Homelab" / "srv-01.md").write_text("# srv-01\n\nProxmox, voir [[Tailscale]].\n")
        (root / "Homelab" / "Tailscale.md").write_text("Le VPN maillé. **Sous-réseau** 192.168.1.0/24.\n")
        (root / "Homelab" / "Homelab.md").write_text("Hub du homelab : [[srv-01]].\n")    # folder note
        self.root = root
        self.f = MdFolders(parse_spec(f"Mes notes={root}"))
        self.store = Store(self.dir / "c.db")
        self.api = API(self.store, None, self.f)

    def tearDown(self):
        self.store.close()

    def by_title(self, title):
        return next(p for p in self.f.tree() if p["title"] == title)

    def test_tree_and_folder_note(self):
        titles = sorted(p["title"] for p in self.f.tree())
        self.assertEqual(titles, ["Homelab", "Index", "Mes notes", "Tailscale", "srv-01"])   # folder note merged
        self.assertTrue(all(p["readonly"] for p in self.f.tree()))
        home = self.by_title("Homelab")
        self.assertEqual(self.by_title("srv-01")["parent_id"], home["id"])
        page = self.f.page(home["id"])
        self.assertIn("Hub du homelab", json.dumps(page["content"], ensure_ascii=False))

    def test_links_backlinks_search(self):
        idx = self.f.page(self.by_title("Index")["id"])
        mentions = [n for b in idx["content"] for n in b.get("content", []) if n.get("type") == "pageMention"]
        self.assertEqual({m["props"]["pageId"] for m in mentions}, {self.by_title("srv-01")["id"], self.by_title("Tailscale")["id"]})
        self.assertEqual(idx["content"][0]["type"], "paragraph")       # "# Index" duplicated title removed
        ts = self.f.page(self.by_title("Tailscale")["id"])
        self.assertEqual(sorted(b["title"] for b in ts["backlinks"]), ["Index", "srv-01"])
        code, res = self.api.handle("GET", "/api/search", {"q": "sous reseau"}, None)
        self.assertEqual(res["results"][0]["title"], "Tailscale")
        self.assertIn("\u0002", res["results"][0]["snippet"])

    def test_read_only(self):
        pid = self.by_title("srv-01")["id"]
        self.assertEqual(self.api.handle("POST", f"/api/pages/{pid}", {}, {"title": "x"})[0], 403)
        self.assertEqual(self.api.handle("DELETE", f"/api/pages/{pid}", {}, None)[0], 403)
        self.assertEqual(self.api.handle("POST", "/api/pages", {}, {"title": "x", "parent_id": pid})[0], 403)
        code, out = self.api.handle("GET", f"/api/pages/{pid}", {"format": "markdown"}, None)
        self.assertEqual(code, 200)
        self.assertTrue(out["markdown"].startswith("# srv-01"))
        self.assertEqual((self.root / "Homelab" / "srv-01.md").read_text(), "# srv-01\n\nProxmox, voir [[Tailscale]].\n")

    def test_changes_on_disk_and_carnet_backlinks(self):
        code, b = self.api.handle("GET", "/api/bootstrap", {}, None)
        self.assertEqual(len(b["tree"]), 5)
        (self.root / "Nouvelle.md").write_text("Nouvelle note")
        self.f._checked = 0
        time.sleep(0.01)
        self.assertIn("Nouvelle", [p["title"] for p in self.f.tree()])
        ts = self.by_title("Tailscale")["id"]
        mine = self.store.create({"title": "Ma page", "content": [{"type": "paragraph", "content": [
            {"type": "pageMention", "props": {"pageId": ts, "title": "Tailscale"}}]}]})
        code, page = self.api.handle("GET", f"/api/pages/{ts}", {}, None)
        self.assertIn(mine["id"], [x["id"] for x in page["backlinks"]])

    def test_spec_parsing(self):
        self.assertEqual(parse_spec("/a/b;Notes d’Hermes=/x/y"), [("b", Path("/a/b")), ("Notes d’Hermes", Path("/x/y"))])


if __name__ == "__main__":
    unittest.main()


class MdIconsTest(unittest.TestCase):
    def test_icons(self):
        root = Path(tempfile.mkdtemp()) / "v"
        (root / "Journal").mkdir(parents=True)
        (root / "Homelab").mkdir()
        (root / "Journal" / "2026-11-23.md").write_text("x")
        (root / "Homelab" / "srv-01.md").write_text("x")
        (root / "Avec icone.md").write_text("---\ntags: [a]\nicon: 🚀\n---\nx")
        (root / ".carnet-icons.json").write_text(json.dumps({"icons": {"Homelab": "🖥️", "Homelab/srv-01": "💻", "": "🤖"}}))
        f = MdFolders(parse_spec(f"V={root}"))
        icons = {p["title"]: p["icon"] for p in f.tree()}
        self.assertEqual(icons, {"V": "🤖", "Journal": "📁", "2026-11-23": "📅", "Homelab": "🖥️", "srv-01": "💻", "Avec icone": "🚀"})
