import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksPreview } from "../src/app/preview.ts";
import { safeHref, safeEmbed } from "../src/safe.ts";

const opts = { base: "/notes", tex: (s: string) => ({ html: "<span>" + s + "</span>", error: "" }) };
const XSS = '<img src=x onerror="alert(1)">';

test("history preview escapes the callout emoji and colour", () => {
  const html = blocksPreview([{ type: "callout", props: { emoji: XSS, color: '"><script>alert(1)</script>' },
    content: [{ type: "text", text: "hi", styles: {} }], children: [] }], opts);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
});

test("history preview only accepts heading levels 1 to 6", () => {
  const html = blocksPreview([{ type: "heading", props: { level: "1 onclick=alert(1)" },
    content: [{ type: "text", text: "T", styles: {} }], children: [] }], opts);
  assert.equal(html, "<h1>T</h1>");
  assert.equal(blocksPreview([{ type: "heading", props: { level: 3 }, content: [], children: [] }], opts), "<h3></h3>");
});

test("history preview keeps text escaped and images under the base path", () => {
  const html = blocksPreview([{ type: "image", props: { url: "/files/abc/x.png" }, children: [] },
    { type: "paragraph", content: [{ type: "text", text: "<b>", styles: { bold: true } }], children: [] }], opts);
  assert.match(html, /src="\/notes\/files\/abc\/x\.png"/);
  assert.match(html, /<b>&lt;b&gt;<\/b>/);
});

test("safeHref keeps web, mail and phone links and refuses scripts", () => {
  assert.equal(safeHref("https://a.fr/x"), "https://a.fr/x");
  assert.equal(safeHref("mailto:a@b.fr"), "mailto:a@b.fr");
  assert.equal(safeHref("exemple.fr"), "https://exemple.fr");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref(" JavaScript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<script>"), null);
});

test("safeEmbed accepts web pages and uploaded files only", () => {
  assert.equal(safeEmbed("https://www.youtube.com/watch?v=x"), true);
  assert.equal(safeEmbed("/files/abc/doc.pdf"), true);
  assert.equal(safeEmbed("javascript:alert(1)"), false);
  assert.equal(safeEmbed("data:text/html,hi"), false);
  assert.equal(safeEmbed("/notes/p/abc"), false);
});

test("history preview: diagram source is escaped, whiteboard shows a marker only", () => {
  const o = { base: "", tex: () => ({ html: "", error: "" }) };
  const html = blocksPreview([
    { type: "diagram", props: { code: "A[\"<img src=x onerror=alert(1)>\"]" }, children: [] },
    { type: "whiteboard", props: { data: "{\"elements\":[{\"text\":\"<script>\"}]}" }, children: [] },
    { type: "whiteboard", props: { data: "" }, children: [] },
  ], o);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("Whiteboard"));
});
