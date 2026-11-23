import unittest

from carnet import markdown as md


class MarkdownToBlocks(unittest.TestCase):
    def test_headings_lists_and_inline_styles(self):
        b = md.to_blocks("# Titre\n\nTexte **gras** et *ital* `code`\n\n- a\n  - a1\n- [x] fait\n1. un\n2. deux\n")
        self.assertEqual([x["type"] for x in b], ["heading", "paragraph", "bulletListItem", "checkListItem",
                                                   "numberedListItem", "numberedListItem"])
        self.assertEqual(b[0]["props"]["level"], 1)
        styles = [(c["text"], c["styles"]) for c in b[1]["content"]]
        self.assertIn(("gras", {"bold": True}), styles)
        self.assertIn(("ital", {"italic": True}), styles)
        self.assertIn(("code", {"code": True}), styles)
        self.assertEqual(b[2]["children"][0]["type"], "bulletListItem")
        self.assertTrue(b[3]["props"]["checked"])

    def test_wiki_links_math_callouts_tables(self):
        b = md.to_blocks("Voir [[Autre page|alias]] et $x^2$\n\n> [!warning] Attention\n> corps\n\n$$\n\\frac{a}{b}\n$$\n\n"
                         "| a | b |\n|---|---|\n| 1 | 2 |\n", resolve=lambda t: "pid123" if t == "Autre page" else None)
        types = [x["type"] for x in b]
        self.assertEqual(types, ["paragraph", "callout", "math", "table"])
        mention = [c for c in b[0]["content"] if c["type"] == "pageMention"][0]
        self.assertEqual(mention["props"], {"pageId": "pid123", "title": "alias"})
        self.assertTrue(any(c["type"] == "inlineMath" for c in b[0]["content"]))
        self.assertEqual(b[1]["props"]["emoji"], "⚠️")
        self.assertEqual(b[1]["content"][0], {"type": "text", "text": "Attention", "styles": {"bold": True}})
        self.assertEqual(b[2]["props"]["latex"], "\\frac{a}{b}")
        self.assertEqual(len(b[3]["content"]["rows"]), 2)

    def test_unknown_wiki_link_stays_text(self):
        b = md.to_blocks("[[Nowhere]]")
        self.assertEqual(b[0]["content"], [{"type": "text", "text": "Nowhere", "styles": {}}])

    def test_code_fence_keeps_content_verbatim(self):
        b = md.to_blocks("```bash\nenable\n# not a heading\n- not a list\n```\n")
        self.assertEqual(b[0]["type"], "codeBlock")
        self.assertEqual(b[0]["props"]["language"], "shellscript")
        self.assertEqual(b[0]["content"][0]["text"], "enable\n# not a heading\n- not a list")

    def test_frontmatter(self):
        fm, body = md.split_frontmatter("---\ntype: cours\ntags: [a, b]\nreviser: false\nn: 3\nlist:\n  - x\n  - y\n---\n# Hi\n")
        self.assertEqual(fm, {"type": "cours", "tags": ["a", "b"], "reviser": False, "n": 3, "list": ["x", "y"]})
        self.assertEqual(body, "# Hi\n")
        self.assertEqual(md.to_blocks("---\na: 1\n---\nhello")[0]["content"][0]["text"], "hello")

    def test_embeds_and_images(self):
        files = {"pic.png": "/files/abc/pic.png"}
        b = md.to_blocks("![[pic.png]]\n\n![alt](pic.png)\n", resolve_file=files.get)
        self.assertEqual([x["type"] for x in b], ["image", "image"])
        self.assertEqual(b[0]["props"]["url"], "/files/abc/pic.png")


class RoundTrip(unittest.TestCase):
    SAMPLE = """# Titre

Texte **gras** et *ital* `code` ~~barré~~ [lien](https://a.b) $x^2$.

- a
  - a1
- [ ] todo
1. un
2. deux

> [!tip] Astuce
> corps

> une citation

```python
print("hi")
```

$$
E = mc^2
$$

| a | b |
| --- | --- |
| 1 | 2 |

---
"""

    def test_markdown_survives_a_round_trip(self):
        once = md.to_markdown(md.to_blocks(self.SAMPLE))
        twice = md.to_markdown(md.to_blocks(once))
        self.assertEqual(once, twice)
        for piece in ("**gras**", "*ital*", "`code`", "~~barré~~", "[lien](https://a.b)", "$x^2$", "- [ ] todo",
                      "> [!tip] Astuce", "```python", "$$\nE = mc^2\n$$", "| 1 | 2 |", "---"):
            self.assertIn(piece, once)

    def test_text_and_refs(self):
        blocks = [{"type": "paragraph", "content": [{"type": "text", "text": "Bonjour ", "styles": {}},
                                                    {"type": "pageMention", "props": {"pageId": "p1", "title": "X"}}]},
                  {"type": "pageLink", "props": {"pageId": "p2"}, "children": [
                      {"type": "database", "props": {"pageId": "p3"}}]}]
        self.assertEqual(md.page_refs(blocks), {"p1", "p2", "p3"})
        self.assertIn("Bonjour X", md.to_text(blocks))


class CodeMarkTest(unittest.TestCase):
    def test_code_drops_other_styles(self):
        # BlockNote refuses bold + code on the same text: the whole page would fail to load
        b = md.to_blocks("Use **`secret`** not `password`.")[0]
        styles = [n["styles"] for n in b["content"] if n["text"] in ("secret", "password")]
        self.assertEqual(styles, [{"code": True}, {"code": True}])


if __name__ == "__main__":
    unittest.main()


class MalformedBlocksTest(unittest.TestCase):
    def test_garbage_never_raises(self):
        # content written through the API may be anything: search indexing and export must not crash
        junk = [None, "x", 1, [], {}, {"rows": "o"}, {"type": "tableContent", "rows": [1, {"cells": "z"}, {"cells": [1, None]}]},
                [{"type": "text"}], [{"type": "link", "content": "q"}], [3, "a"]]
        for t in ("paragraph", "table", "numberedListItem", "math", "image", "codeBlock", "callout"):
            for c in junk:
                for props in (None, {"start": "a"}, {"latex": 3}):
                    blocks = [{"type": t, "content": c, "props": props, "children": "c"}, "junk", None]
                    md.to_text(blocks)
                    md.to_markdown(blocks)
                    md.page_refs(blocks)
