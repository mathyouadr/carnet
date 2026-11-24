import { test } from "node:test";
import assert from "node:assert/strict";
import { chatHtml as html } from "../src/editor/ai/chatMd.ts";
import { mdPreview } from "../src/editor/ai/text.ts";
const chatHtml = (m: string) => html(m, mdPreview);

test("inline maths are rendered, not left as $…$", () => {
  const h = chatHtml("Donc $x > -1$ et $S = ]-1 ; +\\infty[$.");
  assert.ok(h.includes("katex"));
  assert.ok(!h.includes("$x"));
});
test("display maths and underscores inside maths survive the Markdown pass", () => {
  const h = chatHtml("$$x_1 + y_2 = 3$$");
  assert.ok(h.includes("katex-display"));
});
test("prices are not maths", () => {
  const h = chatHtml("Ça coûte $5 puis $6 en tout");
  assert.ok(!h.includes("katex"));
});
test("html in the answer stays escaped", () => {
  assert.ok(!chatHtml("<img src=x onerror=alert(1)> $a<b$").includes("<img"));
});
