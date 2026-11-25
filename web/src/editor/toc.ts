// Table of contents of a page: its headings, plus the lines written as titles without being one
// (a short paragraph entirely in bold). Pure, tested by tests/toc.test.ts.

export type TocItem = { id: string; text: string; level: number; kind: "heading" | "bold" };

function inlineText(content: any): string {
  if (!Array.isArray(content)) return "";
  return content.map((c: any) => {
    if (c?.type === "text") return c.text || "";
    if (c?.type === "link") return inlineText(c.content);
    if (c?.type === "pageMention") return c.props?.title || "";
    return "";
  }).join("");
}

/** A paragraph used as a title: every non-blank character in bold, short, not a sentence. */
function boldTitle(block: any): string {
  if (block?.type !== "paragraph" || !Array.isArray(block.content) || !block.content.length) return "";
  const parts: any[] = [];
  const walk = (cs: any[]) => cs.forEach((c) => (c?.type === "link" ? walk(c.content || []) : parts.push(c)));
  walk(block.content);
  if (!parts.every((c) => c?.type === "text" && (c.styles?.bold || !(c.text || "").trim()))) return "";
  const text = inlineText(block.content).replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 80 || /[.!?;]$/.test(text)) return "";
  return text;
}

/** Entries in document order (children of toggles and columns included). Levels start at 0. */
export function buildToc(blocks: any[]): TocItem[] {
  const out: TocItem[] = [];
  let last = 0;                                        // level of the heading above (0 = none)
  const visit = (bs: any[]) => {
    for (const b of bs || []) {
      if (b?.type === "heading") {
        const text = inlineText(b.content).replace(/\s+/g, " ").trim();
        const level = Math.min(Math.max(Number(b.props?.level) || 1, 1), 6);
        if (text) { out.push({ id: b.id, text, level, kind: "heading" }); last = level; }
      } else {
        const text = boldTitle(b);
        if (text) out.push({ id: b.id, text, level: last + 1, kind: "bold" });
      }
      if (b?.type !== "table") visit(b?.children || []);
    }
  };
  visit(blocks);
  // the smallest level used is not indented: a page made of H2 only is flat, not shifted right
  const min = Math.min(...out.map((i) => i.level));
  return out.map((i) => ({ ...i, level: Math.min(i.level - min, 3) }));
}

/** Entry to highlight: the last one whose top is above the reading line. */
export function activeIndex(tops: number[], line: number): number {
  let idx = -1;
  tops.forEach((t, i) => { if (t <= line) idx = i; });
  return tops.length ? Math.max(idx, 0) : -1;
}
