import { test } from "node:test";
import assert from "node:assert/strict";
import { applyView, changedPropValues, convertValue, matchFilter, propsFromFilters, textOf, withOptionsFor } from "../src/db/logic.ts";
import type { Row, Schema, View } from "../src/api.ts";

const row = (id: string, props: Record<string, any>, extra: Partial<Row> = {}): Row =>
  ({ id, title: id, props, position: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", ...extra } as any);

const schema: Schema = {
  title_name: "Name",
  properties: [
    { id: "n", name: "N", type: "number" },
    { id: "s", name: "S", type: "select", options: [{ id: "a", name: "A", color: "red" }, { id: "b", name: "B", color: "blue" }] },
    { id: "m", name: "M", type: "multi_select", options: [{ id: "x", name: "X", color: "red" }, { id: "y", name: "Y", color: "blue" }] },
  ],
};

test("a multi-select value that is not a list does not throw in text/filter code", () => {
  const r = row("r1", { m: "x" });
  assert.equal(textOf(r, "m", schema), "X");
  assert.equal(matchFilter(r, { prop: "m", op: "contains", value: "x" }, schema), true);
});

test("select to multi-select keeps the value as a one-item list", () => {
  const p = schema.properties[2];
  assert.deepEqual(convertValue("x", "select", "multi_select", p), ["x"]);
  assert.deepEqual(convertValue(null, "select", "multi_select", p), null);
});

test("multi-select to select keeps the first item", () => {
  const p = schema.properties[1];
  assert.equal(convertValue(["a", "b"], "multi_select", "select", p), "a");
  assert.equal(convertValue([], "multi_select", "select", p), null);
});

test("text to number: numeric text converts, the rest becomes empty", () => {
  const p = schema.properties[0];
  assert.equal(convertValue("12,5", "text", "number", p), 12.5);
  assert.equal(convertValue("abc", "text", "number", p), null);
  assert.equal(convertValue("", "text", "number", p), null);
});

test("any value to text stays readable and never becomes [object Object]", () => {
  const text = { id: "t", name: "T", type: "text" as const };
  assert.equal(convertValue(3, "number", "text", text), "3");
  assert.equal(convertValue({ start: "2026-11-24" }, "date", "text", text), "2026-11-24");
  assert.equal(convertValue(["x", "y"], "multi_select", "text", text), "x, y");
});

test("changedPropValues lists only the rows whose value moved to the new type", () => {
  const oldS: Schema = { title_name: "T", properties: [{ id: "s", name: "S", type: "select", options: [{ id: "a", name: "A", color: "red" }] }] };
  const newS: Schema = { title_name: "T", properties: [{ id: "s", name: "S", type: "multi_select", options: [{ id: "a", name: "A", color: "red" }] }] };
  const rows = [row("r1", { s: "a" }), row("r2", {}), row("r3", { s: ["a"] })];
  assert.deepEqual(changedPropValues(rows, oldS, newS), [{ id: "r1", props: { s: ["a"] } }]);
  assert.deepEqual(changedPropValues(rows, oldS, oldS), []);
});

test("number filters never match an empty cell (Number('') is not 0)", () => {
  const empty = row("e", { n: "" });
  const nul = row("z", {});
  for (const op of ["eq", "ne", "gt", "lt", "gte", "lte"]) {
    assert.equal(matchFilter(empty, { prop: "n", op, value: 0 }, schema), false, op);
    assert.equal(matchFilter(nul, { prop: "n", op, value: 0 }, schema), false, op);
  }
  assert.equal(matchFilter(row("k", { n: 0 }), { prop: "n", op: "eq", value: 0 }, schema), true);
});

test("descending sort puts empty values last, as ascending does", () => {
  const rows = [row("e", {}), row("a", { n: 1 }), row("b", { n: 5 })];
  const view = (dir: "asc" | "desc"): View => ({ id: "v", name: "v", type: "table", sorts: [{ prop: "n", dir }] });
  assert.deepEqual(applyView(rows, view("asc"), schema, "").map((r) => r.id), ["a", "b", "e"]);
  assert.deepEqual(applyView(rows, view("desc"), schema, "").map((r) => r.id), ["b", "a", "e"]);
});

test("new row from filters keeps every contains rule of a multi-select", () => {
  const view: View = { id: "v", name: "v", type: "board", filters: [
    { prop: "m", op: "contains", value: "x" }, { prop: "m", op: "contains", value: "y" }] };
  assert.deepEqual(propsFromFilters(view, schema).m, ["x", "y"]);
});

test("text to select: the existing texts become options and keep their values", () => {
  const oldS: Schema = { title_name: "T", properties: [{ id: "s", name: "S", type: "text" }] };
  const newS: Schema = { title_name: "T", properties: [{ id: "s", name: "S", type: "select", options: [] }] };
  const rows = [row("r1", { s: "Alpha" }), row("r2", { s: "alpha" }), row("r3", { s: "Beta" }), row("r4", {})];
  let n = 0;
  const withOpts = withOptionsFor(rows, oldS, newS, () => `o${++n}`);
  assert.deepEqual(withOpts.properties[0].options!.map((o) => o.name), ["Alpha", "Beta"]);
  assert.deepEqual(changedPropValues(rows, oldS, withOpts), [
    { id: "r1", props: { s: "o1" } },
    { id: "r2", props: { s: "o1" } },
    { id: "r3", props: { s: "o2" } },
  ]);
});
