import { test } from "node:test";
import assert from "node:assert/strict";
import { SSEParser, wordDiff, stripFence } from "../src/editor/ai/text.ts";

test("SSEParser buffers partial events", () => {
  const p = new SSEParser();
  assert.deepEqual(p.feed('data: {"delta":"Bo'), []);
  assert.deepEqual(p.feed('n"}\n\n: keepalive\n\ndata: {"done":true}\n\n'), [{ delta: "Bon" }, { done: true }]);
});

test("wordDiff marks replaced words", () => {
  assert.deepEqual(wordDiff("le chat noir", "le chien noir"), [
    { op: "eq", text: "le " }, { op: "del", text: "chat" }, { op: "ins", text: "chien" }, { op: "eq", text: " noir" },
  ]);
});

test("wordDiff parts rebuild both texts", () => {
  const pairs: [string, string][] = [
    ["Salut le mond, ça va ?", "Salut le monde, ça va bien ?"],
    ["", "tout nouveau"],
    ["un deux trois quatre", "deux trois cinq"],
  ];
  for (const [a, b] of pairs) {
    const d = wordDiff(a, b);
    assert.equal(d.filter((x) => x.op !== "ins").map((x) => x.text).join(""), a);
    assert.equal(d.filter((x) => x.op !== "del").map((x) => x.text).join(""), b);
  }
});

test("wordDiff gives up on huge inputs", () => {
  const a = Array.from({ length: 4500 }, (_, i) => "a" + i).join(" ");
  const b = Array.from({ length: 4500 }, (_, i) => "b" + i).join(" ");
  assert.deepEqual(wordDiff(a, b), [{ op: "del", text: a }, { op: "ins", text: b }]);
});

test("stripFence removes one wrapping fence only", () => {
  assert.equal(stripFence("```markdown\nHi\n```"), "Hi");
  assert.equal(stripFence("```\nHi\n```\n"), "Hi");
  const inner = "Texte\n\n```js\nx()\n```\n\nfin";
  assert.equal(stripFence(inner), inner);
});
