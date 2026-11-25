import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToc, activeIndex } from "../src/editor/toc.ts";

const tx = (text: string, bold = false) => ({ type: "text", text, styles: bold ? { bold: true } : {} });
const h = (id: string, level: number, text: string, children: any[] = []) => ({ id, type: "heading", props: { level }, content: [tx(text)], children });
const p = (id: string, ...content: any[]) => ({ id, type: "paragraph", props: {}, content, children: [] });

test("headings keep their hierarchy", () => {
  const toc = buildToc([h("a", 1, "Intro"), p("x", tx("blabla")), h("b", 2, "Détail"), h("c", 3, "Sous-détail"), h("d", 1, "Fin")]);
  assert.deepEqual(toc.map((i) => [i.id, i.level]), [["a", 0], ["b", 1], ["c", 2], ["d", 0]]);
});

test("a page with only H2 is not indented", () => {
  assert.deepEqual(buildToc([h("a", 2, "Un"), h("b", 2, "Deux")]).map((i) => i.level), [0, 0]);
});

test("a short paragraph all in bold counts as a title, under the heading above", () => {
  const toc = buildToc([h("a", 1, "OSPF"), p("b", tx("Les états", true)), p("c", tx("Un mot "), tx("gras", true)), p("d", tx("Une phrase en gras.", true))]);
  assert.deepEqual(toc.map((i) => [i.id, i.kind, i.level]), [["a", "heading", 0], ["b", "bold", 1]]);
});

test("empty headings are skipped, toggles and columns are searched", () => {
  const toc = buildToc([
    { id: "e", type: "heading", props: { level: 1 }, content: [], children: [] },
    { id: "t", type: "toggleListItem", props: {}, content: [tx("plier")], children: [h("in", 2, "Dedans")] },
    { id: "cl", type: "columnList", props: {}, children: [{ id: "c1", type: "column", props: {}, children: [h("col", 2, "Colonne")] }] },
  ]);
  assert.deepEqual(toc.map((i) => i.id), ["in", "col"]);
});

test("link and mention text is read", () => {
  const toc = buildToc([{ id: "a", type: "heading", props: { level: 1 }, content: [tx("Voir "), { type: "link", href: "x", content: [tx("RFC")] }, { type: "pageMention", props: { title: "OSPF" } }], children: [] }]);
  assert.equal(toc[0].text, "Voir RFCOSPF");
});

test("active entry follows the reading line", () => {
  assert.equal(activeIndex([100, 400, 900], 50), 0);
  assert.equal(activeIndex([100, 400, 900], 500), 1);
  assert.equal(activeIndex([], 500), -1);
});
