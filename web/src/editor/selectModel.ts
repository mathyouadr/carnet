// Pure helpers of the block selection (no React): testable with `npm test`.
export type BSel = { a: string; f: string } | null;


export const stripIds = (b: any): any => ({ ...b, id: undefined, children: (b.children || []).map(stripIds) });

/** All blocks in document order, with their parent ids. */
export function flatten(blocks: any[]) {
  const order: string[] = [], parent = new Map<string, string | undefined>();
  const walk = (bs: any[], p?: string) => bs.forEach((b) => { order.push(b.id); parent.set(b.id, p); walk(b.children || [], b.id); });
  walk(blocks);
  return { order, parent };
}

/** Selected ids (document order) and the top-level ones (a child of a selected block follows its parent). */
export function resolve(blocks: any[], sel: BSel) {
  if (!sel) return { ids: [] as string[], top: [] as string[], order: [] as string[] };
  const { order, parent } = flatten(blocks);
  const ia = order.indexOf(sel.a), ifo = order.indexOf(sel.f);
  if (ia < 0 || ifo < 0) return { ids: [], top: [], order };
  const ids = order.slice(Math.min(ia, ifo), Math.max(ia, ifo) + 1);
  const set = new Set(ids);
  const hasSel = (id: string): boolean => { const p = parent.get(id); return !!p && (set.has(p) || hasSel(p)); };
  return { ids, top: ids.filter((id) => !hasSel(id)), order };
}

