// Pure helpers of the offline service worker (carnet/sw-lib.js, plain script also loaded by importScripts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../../carnet/sw-lib.js");

const tree = [
  { id: "a", parent_id: null, kind: "page", title: "Cours", icon: "🎓", updated_at: "1" },
  { id: "db", parent_id: "a", kind: "database", title: "Séances", icon: "", updated_at: "1" },
  { id: "r1", parent_id: "db", kind: "page", title: "OSPF", icon: "", updated_at: "1", is_row: true },
  { id: "b", parent_id: null, kind: "page", title: "Réseau", icon: "", updated_at: "1" },
];

test("signatures: a page changes when it or one of its direct children changes", () => {
  const s1 = L.signatures(tree);
  const t2 = tree.map(p => p.id === "r1" ? { ...p, updated_at: "2" } : p);
  const s2 = L.signatures(t2);
  assert.notEqual(s1.db, s2.db);          // a row changed: its database page is stale
  assert.notEqual(s1.r1, s2.r1);
  assert.equal(s1.a, s2.a);               // grandparent unchanged
  assert.equal(s1.b, s2.b);
});

test("stalePages: new or changed pages only, and the ones gone", () => {
  const known = L.signatures(tree);
  assert.deepEqual(L.stalePages(tree, known), { fetch: [], drop: [] });
  const t2 = tree.filter(p => p.id !== "b").concat([{ id: "c", parent_id: "a", kind: "page", title: "Neuf", updated_at: "3" }]);
  const st = L.stalePages(t2, known);
  assert.deepEqual(st.fetch.sort(), ["a", "c"]);   // c is new, a got a new child
  assert.deepEqual(st.drop, ["b"]);
  assert.deepEqual(L.stalePages(tree, {}).fetch.sort(), ["a", "b", "db", "r1"]);
});

test("pageText: text of every block, nested and in tables, plus props", () => {
  const page = { title: "OSPF", props: { tags: ["réseau"], note: "aire 0" }, content: [
    { type: "paragraph", content: [{ type: "text", text: "Protocole " }, { type: "link", content: [{ type: "text", text: "à état" }] }], children: [
      { type: "bulletListItem", content: [{ type: "text", text: "LSA" }], children: [] }] },
    { type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "DR" }], [{ type: "text", text: "BDR" }]] }] }, children: [] },
    { type: "codeBlock", content: [{ type: "text", text: "router ospf 1" }], children: [] },
  ] };
  const txt = L.pageText(page);
  for (const w of ["Protocole", "à état", "LSA", "DR", "BDR", "router ospf 1", "aire 0", "réseau"]) assert.ok(txt.includes(w), w);
});

test("searchPages: case and accent insensitive, title first, same shape as /api/search", () => {
  const pages = [
    { id: "b", parent_id: null, kind: "page", title: "Notes", icon: "", updated_at: "1", text: "le reseau du lycée et OSPF" },
    { id: "r1", parent_id: "db", kind: "page", title: "OSPF", icon: "", updated_at: "1", text: "aire 0" },
    { id: "x", parent_id: null, kind: "page", title: "Autre", icon: "", updated_at: "1", text: "rien" },
  ];
  const res = L.searchPages(pages, tree, "ospf", 25);
  assert.deepEqual(res.map(r => r.id), ["r1", "b"]);
  assert.deepEqual(res[0].path, ["Cours", "Séances"]);
  assert.ok(res[1].snippet.includes("\u0002OSPF\u0003"));
  assert.deepEqual(L.searchPages(pages, tree, "réseau", 25).map(r => r.id), ["b"]);
  assert.deepEqual(L.searchPages(pages, tree, "RESEAU lycee", 25).map(r => r.id), ["b"]);
  assert.equal(L.searchPages(pages, tree, "o", 1).length, 1);
  assert.deepEqual(Object.keys(res[0]).sort(), ["created_at", "favorite", "icon", "id", "inline", "is_template", "kind", "parent_id",
    "path", "position", "snippet", "title", "updated_at"].sort());
});

test("fileUrls: attachments and images of a page", () => {
  const page = { cover: "/files/c1/cover.jpg", content: [
    { type: "image", props: { url: "/files/i1/a.png" }, children: [] },
    { type: "file", props: { url: "https://example.com/x.pdf" }, children: [] },
    { type: "paragraph", content: [], children: [{ type: "file", props: { url: "/files/f2/b.pdf" }, children: [] }] },
  ] };
  assert.deepEqual(L.fileUrls(page).sort(), ["/files/c1/cover.jpg", "/files/f2/b.pdf", "/files/i1/a.png"]);
});
