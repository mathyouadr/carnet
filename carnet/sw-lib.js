/* Carnet offline: pure helpers of the service worker (sw.js loads this file with importScripts; node tests
   require() it). No DOM, no Cache API here. */
(function (root) {
  "use strict";
  const SUMMARY = ["id", "parent_id", "kind", "title", "icon", "position", "favorite", "is_template", "inline", "updated_at", "created_at"];

  /* A page's cached JSON is stale when the page changed or one of its direct children (sub-pages, database
     rows: they are listed in the page) was added, changed or removed. */
  function signatures(tree) {
    const kids = new Map();
    for (const p of tree) if (p.parent_id) { if (!kids.has(p.parent_id)) kids.set(p.parent_id, []); kids.get(p.parent_id).push(p); }
    const out = {};
    for (const p of tree) {
      const k = (kids.get(p.id) || []).map(c => c.id + "@" + c.updated_at + "@" + c.title).sort().join(",");
      out[p.id] = p.updated_at + "|" + p.title + "|" + k;
    }
    return out;
  }

  function stalePages(tree, known) {
    const sig = signatures(tree), ids = new Set(tree.map(p => p.id));
    return { fetch: tree.filter(p => sig[p.id] !== known[p.id]).map(p => p.id), drop: Object.keys(known).filter(id => !ids.has(id)) };
  }

  function inlineText(c, out) {
    if (!c) return;
    if (Array.isArray(c)) { for (const x of c) inlineText(x, out); return; }
    if (typeof c !== "object") return;
    if (typeof c.text === "string") out.push(c.text);
    if (c.props && typeof c.props.title === "string") out.push(c.props.title);       // page mentions
    if (c.content) inlineText(c.content, out);
    if (c.rows) for (const r of c.rows) for (const cell of r.cells || []) inlineText(cell && cell.content ? cell.content : cell, out);
  }
  function blocksText(blocks, out) {
    for (const b of blocks || []) {
      if (!b || typeof b !== "object") continue;
      inlineText(b.content, out);
      if (b.props && typeof b.props.latex === "string") out.push(b.props.latex);
      if (b.props && typeof b.props.caption === "string") out.push(b.props.caption);
      if (b.props && typeof b.props.name === "string" && b.type === "file") out.push(b.props.name);
      blocksText(b.children, out);
    }
  }
  /* Searchable text of a page JSON (GET /api/pages/<id>): blocks, then property values. */
  function pageText(page) {
    const out = [];
    blocksText(page.content, out);
    for (const v of Object.values(page.props || {})) {
      if (typeof v === "string" || typeof v === "number") out.push(String(v));
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
    }
    return out.join("\n").replace(/[ \t]+/g, " ");
  }

  const fold = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  /* Same answer shape as GET /api/search: summary fields + snippet (match between \u0002 and \u0003) + path. */
  function searchPages(pages, tree, q, limit) {
    const terms = fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const byId = new Map(tree.map(p => [p.id, p]));
    const path = id => { const out = [], seen = new Set(); let cur = byId.get(id);
      while (cur && cur.parent_id && !seen.has(cur.id) && out.length < 50) { seen.add(cur.id); cur = byId.get(cur.parent_id); if (cur) out.unshift(cur.title); }
      return out; };
    const hits = [];
    for (const p of pages) {
      const ft = fold(p.title), fx = fold(p.text);
      if (terms.length && !terms.every(t => ft.includes(t) || fx.includes(t))) continue;
      const score = terms.length ? terms.reduce((s, t) => s + (ft.includes(t) ? 10 : 0) + (fx.includes(t) ? 1 : 0), 0) : 0;
      let snippet = "";
      const t0 = terms.find(t => fx.includes(t));
      if (t0) {                                    // fold() keeps the length of plain and precomposed text
        const text = String(p.text).normalize("NFC"), ftext = fold(text), i = ftext.indexOf(t0);
        if (i >= 0 && ftext.length === text.length) {
          const a = Math.max(0, i - 60), b = Math.min(text.length, i + t0.length + 60);
          snippet = (a ? "…" : "") + text.slice(a, i) + "\u0002" + text.slice(i, i + t0.length) + "\u0003" + text.slice(i + t0.length, b) + (b < text.length ? "…" : "");
          snippet = snippet.replace(/\s+/g, " ");
        }
      }
      const d = {}; for (const k of SUMMARY) d[k] = p[k] === undefined ? null : p[k];
      d.snippet = snippet; d.path = path(p.id);
      hits.push([score, p.updated_at || "", d]);
    }
    hits.sort((x, y) => (y[0] - x[0]) || String(y[1]).localeCompare(String(x[1])));
    return hits.slice(0, limit).map(h => h[2]);
  }

  /* Attachments, images and cover of a page stored by this Carnet ("/files/…"). */
  function fileUrls(page) {
    const out = new Set();
    const add = u => { if (typeof u === "string" && u.startsWith("/files/")) out.add(u); };
    add(page.cover);
    const walk = bs => { for (const b of bs || []) { if (b && b.props) add(b.props.url); if (b) walk(b.children); } };
    walk(page.content);
    return [...out];
  }

  const api = { signatures, stalePages, pageText, searchPages, fileUrls, fold };
  root.CarnetOffline = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
