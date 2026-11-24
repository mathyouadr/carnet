"""Markdown conversion regressions (bug-review 2026-11-24)."""
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



def _texts(blocks):
    return md.to_text(blocks)


class MathBlocks(unittest.TestCase):
    def test_same_line_closing_keeps_following_text(self):
        b = md.to_blocks("$$ x^2 $$ suite du texte")
        self.assertEqual([x["type"] for x in b], ["math", "paragraph"])
        self.assertEqual(b[0]["props"]["latex"], "x^2")
        self.assertEqual(_texts([b[1]]), "suite du texte")

    def test_closing_line_keeps_text_after_delimiter(self):
        b = md.to_blocks("$$\na\n$$ apres\n\nfin\n")
        self.assertEqual([x["type"] for x in b], ["math", "paragraph", "paragraph"])
        self.assertEqual(b[0]["props"]["latex"], "a")
        self.assertEqual(_texts([b[1]]), "apres")

    def test_unclosed_delimiter_is_plain_text(self):
        b = md.to_blocks("$$\nfoo\n\nbar\n")
        self.assertNotIn("math", [x["type"] for x in b])
        text = _texts(b)
        self.assertIn("foo", text)
        self.assertIn("bar", text)
        self.assertIn("$$", text)


class InlineParsingPerformance(unittest.TestCase):
    def test_pathological_lines_are_linear(self):
        for pattern in ("[a](" * 20000, "![a](" * 20000, "[" * 20000, "<https://" * 5000,
                        "`" * 20000, "$" * 20000):
            start = time.perf_counter()
            md.to_blocks(pattern)
            self.assertLess(time.perf_counter() - start, 2.0, pattern[:10])


class Headings(unittest.TestCase):
    def test_hash_inside_title_is_kept(self):
        self.assertEqual(_texts(md.to_blocks("# Learn C#")), "Learn C#")
        self.assertEqual(md.to_blocks("# Learn C#")[0]["content"][0]["text"], "Learn C#")

    def test_only_closing_hashes_are_removed(self):
        self.assertEqual(md.to_blocks("## Note #1 #")[0]["content"][0]["text"], "Note #1")
        self.assertEqual(md.to_blocks("# Titre ##")[0]["content"][0]["text"], "Titre")


class WikiLinksWithSymbols(unittest.TestCase):
    def test_hash_in_title_resolves_as_a_whole(self):
        b = md.to_blocks("[[C# notes]]", resolve=lambda t: "p1" if t == "C# notes" else None)
        self.assertEqual(b[0]["content"][0]["type"], "pageMention")
        self.assertEqual(b[0]["content"][0]["props"], {"pageId": "p1", "title": "C# notes"})

    def test_section_and_alias_still_work_like_obsidian(self):
        resolve = lambda t: "p1" if t == "Note" else None
        b = md.to_blocks("[[Note#Section]] et [[Note|alias]]", resolve=resolve)
        mentions = [c for c in b[0]["content"] if c["type"] == "pageMention"]
        self.assertEqual([m["props"]["pageId"] for m in mentions], ["p1", "p1"])
        self.assertEqual(mentions[1]["props"]["title"], "alias")

    def test_pipe_in_title_round_trips(self):
        blocks = [{"type": "paragraph", "content": [{"type": "pageMention",
                                                     "props": {"pageId": "p9", "title": "A | B"}}]}]
        once = md.to_markdown(blocks)
        self.assertNotIn("[[A | B]]", once)
        back = md.to_blocks(once, resolve=lambda t: "p9" if t == "A | B" else None)
        self.assertEqual(back[0]["content"][0]["props"], {"pageId": "p9", "title": "A | B"})

    def test_hash_in_title_round_trips(self):
        blocks = [{"type": "paragraph", "content": [{"type": "pageMention",
                                                     "props": {"pageId": "p8", "title": "C# notes"}}]}]
        once = md.to_markdown(blocks)
        back = md.to_blocks(once, resolve=lambda t: "p8" if t == "C# notes" else None)
        self.assertEqual(back[0]["content"][0]["props"]["pageId"], "p8")


class ExportEscapes(unittest.TestCase):
    def test_line_start_markers_in_paragraph_round_trip(self):
        text = "- a\n# b\n1. c\n> d\n+ e\n| f"
        blocks = [{"type": "paragraph", "content": [{"type": "text", "text": text, "styles": {}}]}]
        back = md.to_blocks(md.to_markdown(blocks))
        self.assertEqual([b["type"] for b in back], ["paragraph"])
        self.assertEqual(_texts(back), text)


class Callouts(unittest.TestCase):
    def _callout(self, emoji, color, text="Attention"):
        return [{"type": "callout", "props": {"emoji": emoji, "color": color},
                 "content": [{"type": "text", "text": text, "styles": {}}], "children": []}]

    def test_custom_emoji_and_colour_round_trip(self):
        once = md.to_markdown(self._callout("🎯", "red"))
        back = md.to_blocks(once)
        self.assertEqual(back[0]["type"], "callout")
        self.assertEqual(back[0]["props"]["emoji"], "🎯")
        self.assertEqual(back[0]["props"]["color"], "red")
        self.assertEqual(_texts(back), "Attention")

    def test_known_callout_is_still_obsidian_syntax(self):
        once = md.to_markdown(self._callout("⚠️", "yellow"))
        self.assertTrue(once.startswith("> [!warning]"), once)
        back = md.to_blocks(once)
        self.assertEqual((back[0]["props"]["emoji"], back[0]["props"]["color"]), ("⚠️", "yellow"))

    def test_dash_and_arrow_quotes_are_not_callouts(self):
        for src in ("> — Victor Hugo", "> → suite", "> • puce"):
            self.assertEqual(md.to_blocks(src)[0]["type"], "quote", src)

    def test_real_emoji_quote_is_still_a_callout(self):
        self.assertEqual(md.to_blocks("> 🔥 flamme")[0]["type"], "callout")


class Links(unittest.TestCase):
    def test_url_with_balanced_parentheses_is_complete(self):
        b = md.to_blocks("https://fr.wikipedia.org/wiki/Foo_(bar) fin")
        link = b[0]["content"][0]
        self.assertEqual(link["href"], "https://fr.wikipedia.org/wiki/Foo_(bar)")

    def test_closing_parenthesis_outside_url_is_not_part_of_it(self):
        b = md.to_blocks("(voir https://a.b/x)")
        links = [c for c in b[0]["content"] if c["type"] == "link"]
        self.assertEqual(links[0]["href"], "https://a.b/x")

    def test_image_and_file_blocks_only_keep_safe_urls(self):
        b = md.to_blocks("![x](javascript:alert(1))\n\n![y](https://a.b/p.png)\n\n![z](/files/abc/p.png)\n\n"
                         "![w](data:image/png;base64,AAAA)\n\n![v](//evil.example/p.png)\n")
        urls = [x["props"]["url"] for x in b if x["type"] in ("image", "file", "video", "audio")]
        self.assertEqual(urls, ["https://a.b/p.png", "/files/abc/p.png"])
        self.assertFalse(any("javascript" in str(x) for x in b))


class CodeAndFrontmatter(unittest.TestCase):
    def test_tabs_inside_code_block_are_kept(self):
        b = md.to_blocks("```\na\tb\n\tindented\n```\n")
        self.assertEqual(b[0]["content"][0]["text"], "a\tb\n\tindented")

    def test_tab_indented_list_still_nests(self):
        b = md.to_blocks("- a\n\t- b\n")
        self.assertEqual(b[0]["children"][0]["type"], "bulletListItem")

    def test_empty_front_matter(self):
        self.assertEqual(md.split_frontmatter("---\n---\nHi\n"), ({}, "Hi\n"))
        self.assertEqual(md.to_blocks("---\n---\nHi")[0]["content"][0]["text"], "Hi")

    def test_deep_quotes_do_not_crash(self):
        b = md.to_blocks("> " * 3000 + "fin")
        self.assertIn("fin", _texts(b))


class Toggles(unittest.TestCase):
    def test_toggle_round_trip(self):
        blocks = [{"type": "toggleListItem", "props": {}, "content": [{"type": "text", "text": "Titre", "styles": {}}],
                   "children": [{"type": "paragraph", "props": {}, "content": [
                       {"type": "text", "text": "contenu", "styles": {}}], "children": []}]}]
        once = md.to_markdown(blocks)
        self.assertIn("<details>", once)
        back = md.to_blocks(once)
        self.assertEqual(back[0]["type"], "toggleListItem")
        self.assertEqual(md._plain(back[0]["content"]), "Titre")
        self.assertEqual(_texts(back[0]["children"]), "contenu")


if __name__ == "__main__":
    unittest.main()
