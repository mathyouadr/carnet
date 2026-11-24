import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReplace, fingerprint, historyFor, askedText, isSpaceInput, selectionTooLong, AI_HISTORY_MESSAGES,
} from "../src/editor/ai/policy.ts";
import { mdText, mdPreview } from "../src/editor/ai/text.ts";

test("canReplace: only a complete, unchanged rewrite", () => {
  const ok = { rewrite: true, partial: false, stale: false };
  assert.equal(canReplace(ok), true);
  assert.equal(canReplace({ ...ok, partial: true }), false);   // stopped answer: never replace with a cut text
  assert.equal(canReplace({ ...ok, stale: true }), false);
  assert.equal(canReplace({ ...ok, rewrite: false }), false);  // insert-only commands never replace
});

test("fingerprint sees ids and content, not only the number of blocks", () => {
  const a = [{ id: "1", type: "paragraph", content: [{ type: "text", text: "salut" }] }];
  const b = [{ id: "1", type: "paragraph", content: [{ type: "text", text: "salut!" }] }];
  const c = [{ id: "2", type: "paragraph", content: [{ type: "text", text: "salut" }] }];
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
  assert.equal(fingerprint(a), fingerprint(JSON.parse(JSON.stringify(a))));
});

test("historyFor keeps the newest messages and clips them", () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", content: "x" + i }) as const);
  const out = historyFor([...hist]);
  assert.equal(out.length, AI_HISTORY_MESSAGES);
  assert.equal(out[out.length - 1].content, "x19");
  const big = historyFor([{ role: "user", content: "a".repeat(50000) }]);
  assert.ok(big[0].content.length <= 4000);
});

test("askedText: no 'custom:' prefix in the conversation", () => {
  assert.equal(askedText("custom", "Explique OSPF", "Ask « x »"), "Explique OSPF");
  assert.equal(askedText("fix", "", "Fix spelling"), "Fix spelling");
  assert.equal(askedText("fix", "plus formel", "Fix spelling"), "Fix spelling: plus formel");
});

test("isSpaceInput: a space typed on an Android keyboard", () => {
  assert.equal(isSpaceInput(" ", "insertText"), true);
  assert.equal(isSpaceInput(" ", "insertCompositionText"), false);
  assert.equal(isSpaceInput("a", "insertText"), false);
  assert.equal(isSpaceInput(null, "insertText"), false);
});

test("selectionTooLong: 20 000 characters", () => {
  assert.equal(selectionTooLong("a".repeat(20000)), false);
  assert.equal(selectionTooLong("a".repeat(20001)), true);
});

test("mdPreview shows the target of links", () => {
  const h = mdPreview("Voir [la doc](https://example.org/a?b=1) ici.");
  assert.match(h, /<u>la doc<\/u> \(https:\/\/example\.org\/a\?b=1\)/);
  const evil = mdPreview("[x](javascript:alert(1))");
  assert.match(evil, /javascript:alert\(1\)/);            // shown as text
  assert.ok(!/href/.test(evil));                           // never a live link
});

test("mdText: rendered text, no block markers", () => {
  const t = mdText("## Titre\n\n- [ ] faire ceci\n- [x] fait\n> [!note] attention\n1. un\n\nTexte **gras**");
  assert.equal(t, "Titre\nfaire ceci\nfait\nattention\nun\nTexte gras");
});
