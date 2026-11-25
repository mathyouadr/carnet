import { test } from "node:test";
import assert from "node:assert/strict";
import { initTabs, openTab, closeTab, closeOthers, closeRight, moveTab, showInActive, activate, dropMissing, MAX_TABS } from "../src/app/tabsModel.ts";

let n = 0;
const key = () => `k${n++}`;
const ids = (s: any) => s.list.map((x: any) => x.id);

test("first start: one tab on the URL page", () => {
  const s = initTabs(null, "a", key);
  assert.deepEqual(ids(s), ["a"]);
  assert.equal(s.active, s.list[0].k);
});

test("restore: the URL page activates its tab, or replaces the active one", () => {
  const saved = { list: [{ k: "1", id: "a" }, { k: "2", id: "b" }], active: "1" };
  assert.equal(initTabs(saved, "b").active, "2");
  const s = initTabs(saved, "c");
  assert.deepEqual(ids(s), ["c", "b"]);
  assert.equal(s.active, "1");
  assert.deepEqual(ids(initTabs({ list: "junk" }, null, key)), [null]);
});

test("open after the active tab, background or not", () => {
  let s: any = { list: [{ k: "1", id: "a" }, { k: "2", id: "b" }], active: "1" };
  s = openTab(s, "c", { key: "3", background: true });
  assert.deepEqual(ids(s), ["a", "c", "b"]);
  assert.equal(s.active, "1");
  s = openTab(s, "d", { key: "4" });
  assert.deepEqual(ids(s), ["a", "d", "c", "b"]);
  assert.equal(s.active, "4");
});

test("tab limit: the page opens in the active tab", () => {
  const list = Array.from({ length: MAX_TABS }, (_, i) => ({ k: String(i), id: "p" + i }));
  const s = openTab({ list, active: "0" }, "new");
  assert.equal(s.list.length, MAX_TABS);
  assert.equal(s.list[0].id, "new");
});

test("close: right neighbour, else left; the last tab stays", () => {
  const s = { list: [{ k: "1", id: "a" }, { k: "2", id: "b" }, { k: "3", id: "c" }], active: "2" };
  assert.equal(closeTab(s, "2").active, "3");
  assert.equal(closeTab({ ...s, active: "3" }, "3").active, "2");
  assert.equal(closeTab(s, "1").active, "2");
  const one = { list: [{ k: "1", id: "a" }], active: "1" };
  assert.equal(closeTab(one, "1"), one);
});

test("close others / to the right", () => {
  const s = { list: [{ k: "1", id: "a" }, { k: "2", id: "b" }, { k: "3", id: "c" }], active: "3" };
  assert.deepEqual(ids(closeOthers(s, "2")), ["b"]);
  const r = closeRight(s, "1");
  assert.deepEqual(ids(r), ["a"]);
  assert.equal(r.active, "1");
});

test("move by drag and drop", () => {
  const s = { list: [{ k: "1", id: "a" }, { k: "2", id: "b" }, { k: "3", id: "c" }], active: "1" };
  assert.deepEqual(ids(moveTab(s, "1", 3)), ["b", "c", "a"]);
  assert.deepEqual(ids(moveTab(s, "3", 0)), ["c", "a", "b"]);
  assert.deepEqual(ids(moveTab(s, "1", 1)), ["a", "b", "c"]);
});

test("navigation changes the active tab only; deleted pages close their tabs", () => {
  let s: any = { list: [{ k: "1", id: "a", scroll: 50 }, { k: "2", id: "b" }], active: "2" };
  s = showInActive(s, "z");
  assert.deepEqual(ids(s), ["a", "z"]);
  s = activate(s, "1");
  assert.equal(s.active, "1");
  assert.deepEqual(ids(dropMissing(s, (id) => id !== "a")), ["z"]);
});
