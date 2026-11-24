import { test } from "node:test";
import assert from "node:assert/strict";
import { dragBox, touches, sameSet } from "../src/db/rowSelectModel.ts";

test("dragBox is normalised whatever the direction", () => {
  const b = dragBox({ x: 300, y: 200, scrollTop: 0 }, { x: 100, y: 50, scrollTop: 0 });
  assert.deepEqual(b, { left: 100, right: 300, top: 50, bottom: 200 });
});

test("dragBox follows the page when it scrolls under the pointer", () => {
  const b = dragBox({ x: 10, y: 400, scrollTop: 0 }, { x: 60, y: 500, scrollTop: 300 });
  assert.equal(b.top, 100);      // the start point went up by the scrolled distance
  assert.equal(b.bottom, 500);
});

test("touches: any overlap counts, a gap does not", () => {
  const box = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.ok(touches(box, { left: 90, top: 90, right: 200, bottom: 200 }));
  assert.ok(!touches(box, { left: 101, top: 0, right: 200, bottom: 50 }));
  assert.ok(!touches(box, { left: 0, top: 150, right: 50, bottom: 200 }));
});

test("sameSet", () => {
  assert.ok(sameSet(new Set(["a", "b"]), new Set(["b", "a"])));
  assert.ok(!sameSet(new Set(["a"]), new Set(["a", "b"])));
});
