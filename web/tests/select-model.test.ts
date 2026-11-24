import { test } from "node:test";
import assert from "node:assert/strict";
import { flatten, resolve, stripIds } from "../src/editor/selectModel.ts";

const doc = [
  { id: "a", children: [{ id: "a1", children: [] }, { id: "a2", children: [] }] },
  { id: "b", children: [] },
  { id: "c", children: [{ id: "c1", children: [] }] },
  { id: "d", children: [] },
];

test("flatten gives document order and parents", () => {
  const { order, parent } = flatten(doc);
  assert.deepEqual(order, ["a", "a1", "a2", "b", "c", "c1", "d"]);
  assert.equal(parent.get("a1"), "a");
  assert.equal(parent.get("b"), undefined);
});

test("resolve: range in either direction, children follow their selected parent", () => {
  assert.deepEqual(resolve(doc, { a: "b", f: "c" }).ids, ["b", "c"]);
  assert.deepEqual(resolve(doc, { a: "c", f: "b" }).ids, ["b", "c"]);
  assert.deepEqual(resolve(doc, { a: "a", f: "b" }).top, ["a", "b"]);          // a1, a2 ride with a
  assert.deepEqual(resolve(doc, { a: "a1", f: "b" }).top, ["a1", "a2", "b"]);  // parent not selected: children are top
});

test("resolve: unknown ids and no selection give nothing", () => {
  assert.deepEqual(resolve(doc, null).top, []);
  assert.deepEqual(resolve(doc, { a: "zz", f: "b" }).ids, []);
});

test("stripIds removes ids recursively", () => {
  const s = stripIds(doc[0]);
  assert.equal(s.id, undefined);
  assert.equal(s.children[0].id, undefined);
});
