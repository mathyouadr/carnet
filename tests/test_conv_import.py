"""Import / mdfolders regressions (bug-review 2026-11-24)."""
import io
import os
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from carnet import markdown as md
from carnet import transfer
from carnet.mdfolders import MdFolders, parse_spec
from carnet.store import Store



class ImportDotfiles(unittest.TestCase):
    def test_hidden_files_are_skipped_without_crash(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "vault"
            (root / ".cache").mkdir(parents=True)
            (root / ".cache" / "x.md").write_text("x")
            (root / "Note.md").write_text("Texte")
            (root / "._Note.md").write_bytes(b"\x00\x05\x16\x07 mac metadata")
            (root / ".brouillon.md").write_text("brouillon")
            s = Store(":memory:")
            stats = transfer.import_path(s, Path(d) / "files", root)
            titles = sorted(p["title"] for p in s.tree())
            s.close()
            self.assertEqual(titles, ["Note", "vault"])
            self.assertEqual(stats["pages"], 2)

    def test_zip_with_hidden_macos_entries_imports(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("vault/Note.md", "Texte")
            z.writestr("vault/._Note.md", b"\x00junk")
            z.writestr("vault/__MACOSX/a.md", "x")
        s = Store(":memory:")
        with tempfile.TemporaryDirectory() as d:
            transfer.import_upload(s, Path(d) / "files", "vault.zip", buf.getvalue())
        titles = sorted(p["title"] for p in s.tree())
        s.close()
        self.assertIn("Note", titles)
        self.assertNotIn("_Note", titles)


class ImportZipCollisions(unittest.TestCase):
    def test_file_and_folder_with_same_name_do_not_crash(self):
        for order in (("dossier", "dossier/a.md"), ("dossier/a.md", "dossier")):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                for name in order:
                    if name.endswith(".md"):
                        z.writestr(f"vault/{name}", "contenu")
                    else:
                        z.writestr(f"vault/{name}", "fichier")
                z.writestr("vault/autre.md", "ok")
            s = Store(":memory:")
            with tempfile.TemporaryDirectory() as d:
                transfer.import_upload(s, Path(d) / "files", "vault.zip", buf.getvalue())
            titles = {p["title"] for p in s.tree()}
            s.close()
            self.assertIn("autre", titles)


class ImportFolderDatabaseLinks(unittest.TestCase):
    def test_link_to_folder_turned_database_resolves(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "vault"
            (root / "Projets").mkdir(parents=True)
            (root / "Projets" / "Projets.md").write_text("Description du projet")
            (root / "Projets" / "a.md").write_text("---\nstatut: en cours\ntags: [x]\n---\nA")
            (root / "Projets" / "b.md").write_text("---\nstatut: fini\ntags: [y]\n---\nB")
            (root / "Accueil.md").write_text("Voir [[Projets]]")
            s = Store(":memory:")
            transfer.import_path(s, Path(d) / "files", root)
            tree = {p["title"]: p for p in s.tree()}
            self.assertEqual(s.page(tree["Projets"]["id"])["kind"], "database")
            acc = s.page(tree["Accueil"]["id"])
            mention = acc["content"][0]["content"][1]
            self.assertEqual(mention["type"], "pageMention")
            target = mention["props"]["pageId"]
            ids = {p["id"] for p in s.tree()}
            s.close()
            self.assertIn(target, ids)
            self.assertEqual(target, tree["Projets"]["id"])


class MdFoldersRegressions(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def test_cache_detects_change_within_the_same_second(self):
        root = self.dir / "v"
        root.mkdir()
        p = root / "Court.md"
        p.write_text("aaaa")
        os.utime(p, ns=(10 ** 18, 10 ** 18))
        f = MdFolders(parse_spec(f"V={root}"))
        pid = next(x["id"] for x in f.tree() if x["title"] == "Court")
        self.assertEqual(f.text(pid), "aaaa")
        p.write_text("bbbbbbbbbbbb")
        os.utime(p, ns=(10 ** 18 + 1, 10 ** 18 + 1))
        f.refresh(force=True)
        self.assertEqual(f.text(pid), "bbbbbbbbbbbb")
        self.assertEqual(f.blocks(pid)[0]["content"][0]["text"], "bbbbbbbbbbbb")

    def test_same_name_specs_are_not_merged(self):
        d1, d2 = self.dir / "a" / "Notes", self.dir / "b" / "Notes"
        d1.mkdir(parents=True)
        d2.mkdir(parents=True)
        (d1 / "Un.md").write_text("contenu un")
        (d2 / "Deux.md").write_text("contenu deux")
        f = MdFolders(parse_spec(f"Notes={d1};Notes={d2}"))
        roots = [p for p in f.tree() if p["title"] == "Notes"]
        self.assertEqual(len(roots), 2)
        self.assertNotEqual(roots[0]["id"], roots[1]["id"])
        self.assertEqual(roots[0]["id"], MdFolders.make_id("Notes", ""))  # the first one keeps its id
        un = next(p for p in f.tree() if p["title"] == "Un")
        deux = next(p for p in f.tree() if p["title"] == "Deux")
        self.assertEqual(un["parent_id"], roots[0]["id"])
        self.assertEqual(deux["parent_id"], roots[1]["id"])
        self.assertIn("contenu deux", f.text(deux["id"]))
        self.assertIn("contenu un", f.text(un["id"]))

    def test_bom_front_matter_icon(self):
        root = self.dir / "v"
        root.mkdir()
        (root / "Avec BOM.md").write_bytes("\ufeff---\nicon: 🚀\n---\nx".encode("utf-8"))
        f = MdFolders(parse_spec(f"V={root}"))
        page = next(p for p in f.tree() if p["title"] == "Avec BOM")
        self.assertEqual(page["icon"], "🚀")
        self.assertNotIn("---", f.text(page["id"]))


if __name__ == "__main__":
    unittest.main()
