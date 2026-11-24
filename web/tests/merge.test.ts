import test from "node:test";
import assert from "node:assert/strict";
import { mergeBlocks, removalStats, destructive } from "../src/editor/ai/merge.ts";

const p = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const db = (id: string) => ({ id, type: "database", props: {}, children: [] });

test("identical answer changes nothing", () => {
  const old = [p("1", "a"), p("2", "b")];
  assert.deepEqual(mergeBlocks(old, [p("x", "a"), p("y", "b")]), []);
});
test("an added block is inserted after its neighbour, nothing removed", () => {
  const h = mergeBlocks([p("1", "a"), p("2", "b")], [p("x", "a"), p("n", "new"), p("y", "b")]);
  assert.equal(h.length, 1);
  assert.equal(h[0].after, "1");
  assert.equal(h[0].remove.length, 0);
  assert.equal(h[0].insert[0].id, "n");
});
test("an edited block is replaced, the others stay", () => {
  const h = mergeBlocks([p("1", "a"), p("2", "b"), p("3", "c")], [p("x", "a"), p("y", "B!"), p("z", "c")]);
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].remove.map((b: any) => b.id), ["2"]);
  assert.equal(h[0].after, "1");
});
test("blocks without text are never removed", () => {
  const h = mergeBlocks([p("1", "a"), db("d"), p("2", "b")], [p("x", "a"), p("y", "b")]);
  assert.equal(h.length, 0);
});
test("an answer that is only the addition is flagged as destructive", () => {
  const long = (c: string) => c.repeat(80);
  const old = [p("1", long("a")), p("2", long("b")), p("3", long("c")), p("4", long("d"))];
  const h = mergeBlocks(old, [p("n", "just the new part")]);
  assert.equal(removalStats(old, h).removed, 4);
  assert.ok(destructive(removalStats(old, h)));
});
test("a small edit is not destructive", () => {
  const old = [p("1", "a"), p("2", "b"), p("3", "c")];
  assert.ok(!destructive(removalStats(old, mergeBlocks(old, [p("x", "a"), p("y", "b2"), p("z", "c")]))));
});

test("a translation (everything replaced by as much text) is not destructive", () => {
  const old = [p("1", "Le chat dort"), p("2", "Le chien court"), p("3", "L'oiseau chante")];
  const h = mergeBlocks(old, [p("a", "The cat sleeps"), p("b", "The dog runs"), p("c", "The bird sings")]);
  assert.equal(removalStats(old, h).removed, 3);
  assert.ok(!destructive(removalStats(old, h)));
});
