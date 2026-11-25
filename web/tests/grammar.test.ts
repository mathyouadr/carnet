import { test } from "node:test";
import assert from "node:assert/strict";
import { joinSegments, locate, filterDict, relocate, context, PLACEHOLDER } from "../src/editor/grammar.ts";

const m = (offset: number, length: number, extra: any = {}) => ({ offset, length, message: "x", replacements: [], rule: "R", type: "grammar", category: "GRAMMAR", ...extra });

test("matches are mapped back to their segment", () => {
  const texts = ["Je sui là", "Il a mangé"];
  const { text, starts } = joinSegments(texts);
  assert.equal(text, "Je sui là\n\nIl a mangé");
  const out = locate([m(3, 3), m(14, 1)], texts, starts);
  assert.deepEqual(out.map((i) => [i.seg, i.at, i.str]), [[0, 3, "sui"], [1, 3, "a"]]);
});

test("a match across two segments or on a placeholder is dropped", () => {
  const texts = ["abc", `x${PLACEHOLDER}y`];
  const { starts } = joinSegments(texts);
  assert.equal(locate([m(2, 4)], texts, starts).length, 0);
  assert.equal(locate([m(5, 2)], texts, starts).length, 0);
});

test("dictionary words are not spelling mistakes, grammar stays", () => {
  const issues = [{ ...m(0, 4, { type: "misspelling" }), str: "VLAN" }, { ...m(0, 4), str: "VLAN" }];
  assert.equal(filterDict(issues, new Set(["vlan"])).length, 1);
});

test("relocate follows the text after an edit", () => {
  assert.equal(relocate("Je sui là", 3, "sui"), 3);
  assert.equal(relocate("Alors je sui là", 3, "sui"), 9);
  assert.equal(relocate("Je suis là", 3, "sui "), -1);
});

test("context around the mistake", () => {
  assert.deepEqual(context("abcdefghij", 4, 2, 2), { before: "…cd", err: "ef", after: "gh…" });
});
