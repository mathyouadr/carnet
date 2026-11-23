import { schema } from "./schema";

const KNOWN = new Set(Object.keys((schema as any).blockSchema));

/** BlockNote's `code` mark excludes every other mark: bold + code (common in Markdown) would make the
 *  whole document fail to load. `strict` (second try, after a crash) keeps plain text only. */
function cleanInline(content: any, strict: boolean): any {
  if (!Array.isArray(content)) return content;
  return content.filter(Boolean).map((n: any) => {
    if (n.type === "text") {
      const st = n.styles || {};
      return { ...n, text: String(n.text ?? ""), styles: strict ? {} : st.code ? { code: true } : st };
    }
    if (n.type === "link") return strict ? { type: "text", text: (n.content || []).map((c: any) => c.text || "").join(""), styles: {} }
      : { ...n, content: cleanInline(n.content, strict) };
    return n;
  });
}

function cleanContent(b: any, strict: boolean): any {
  const c = b.content;
  if (Array.isArray(c)) return cleanInline(c, strict);
  if (c && c.type === "tableContent" && Array.isArray(c.rows)) {
    if (strict) return undefined;
    return { ...c, rows: c.rows.map((r: any) => ({ ...r, cells: (r.cells || []).map((cell: any) =>
      Array.isArray(cell) ? cleanInline(cell, strict) : cell && typeof cell === "object" ? { ...cell, content: cleanInline(cell.content, strict) } : cell) })) };
  }
  return c;
}

/** Drop what the schema doesn't know (old imports, newer versions) instead of crashing the editor. */
export function sanitize(blocks: any[], strict = false): any[] {
  const out: any[] = [];
  for (const b of blocks || []) {
    if (!b || typeof b !== "object") continue;
    if (!KNOWN.has(b.type) || (strict && b.type === "table")) {
      const text = Array.isArray(b.content) ? b.content : [];
      out.push({ type: "paragraph", content: cleanInline(text, true), children: sanitize(b.children || [], strict) });
      continue;
    }
    const nb: any = { ...b, children: sanitize(b.children || [], strict) };
    const c = cleanContent(b, strict);
    if (c === undefined) delete nb.content; else nb.content = c;
    out.push(nb);
  }
  return out;
}
