// Applies an AI answer to the page without throwing away what it did not touch.
// Old and new top-level blocks are matched by their text (longest common subsequence): matched blocks stay
// as they are (ids, files, formatting), only the differences are replaced, inserted or removed.
// Blocks that hold no text (database, file, image, embed…) are never removed: the markdown answer cannot carry them.

export type Hunk = { remove: any[]; insert: any[]; after: string | null };   // `after`: id of the old block the insertion follows (null = at the start)

const isText = (b: any) => Array.isArray(b?.content);

function plain(b: any): string {
  const own = Array.isArray(b?.content)
    ? b.content.map((c: any) => (typeof c?.text === "string" ? c.text : c?.type === "link" ? plain({ content: c.content }) : "")).join("")
    : b?.content?.type === "tableContent"
      ? (b.content.rows || []).map((r: any) => (r.cells || []).map((c: any) => plain({ content: Array.isArray(c) ? c : c?.content })).join("|")).join("\n")
      : "";
  return own + (b?.children || []).map(plain).join("\n");
}

/** Identity of a block for matching: its type and its words (spacing and case of marks are ignored). */
export function blockKey(b: any): string {
  const lvl = b?.type === "heading" ? String(b.props?.level ?? 1) : "";
  return `${b?.type}${lvl}:${plain(b).replace(/\s+/g, " ").trim()}`;
}

/** Hunks that turn `oldBlocks` into `newBlocks`. */
export function mergeBlocks(oldBlocks: any[], newBlocks: any[]): Hunk[] {
  const a = oldBlocks.map(blockKey), b = newBlocks.map(blockKey);
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0, j = 0, after: string | null = null;
  let cur: Hunk | null = null;
  const flush = () => { if (cur && (cur.remove.length || cur.insert.length)) hunks.push(cur); cur = null; };
  const hunk = () => (cur ||= { remove: [], insert: [], after });
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); after = oldBlocks[i].id; i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { hunk().insert.push(newBlocks[j]); j++; }
    else { const o = oldBlocks[i]; if (isText(o)) hunk().remove.push(o); else flush(); after = o.id; i++; }
  }
  flush();
  return hunks;
}

/** How much text the merge removes (blocks and characters) and puts back. */
export function removalStats(oldBlocks: any[], hunks: Hunk[]): { removed: number; total: number; removedChars: number; insertedChars: number } {
  const total = oldBlocks.filter((b) => isText(b) && plain(b).trim()).length;
  const gone = hunks.flatMap((h) => h.remove).filter((b) => plain(b).trim());
  const len = (bs: any[]) => bs.reduce((n, b) => n + plain(b).length, 0);
  return { removed: gone.length, total, removedChars: len(gone), insertedChars: len(hunks.flatMap((h) => h.insert)) };
}

/** A merge that wipes most of the text without putting text back (a translation or a rewrite is not one): warned, never silent. */
export function destructive(s: { removed: number; total: number; removedChars: number; insertedChars: number }): boolean {
  return s.total >= 3 && s.removed / s.total > 0.5 && s.insertedChars < s.removedChars * 0.5;
}
