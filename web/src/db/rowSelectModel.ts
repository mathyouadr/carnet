// Pure geometry of the rectangle selection in database views (no React): testable with `npm test`.
export type Box = { left: number; top: number; right: number; bottom: number };

/** The drag rectangle from its start point (kept in page coordinates, so scrolling while dragging moves it) to the pointer. */
export function dragBox(start: { x: number; y: number; scrollTop: number }, now: { x: number; y: number; scrollTop: number }): Box {
  const sy = start.y - (now.scrollTop - start.scrollTop);
  return { left: Math.min(start.x, now.x), right: Math.max(start.x, now.x), top: Math.min(sy, now.y), bottom: Math.max(sy, now.y) };
}

/** Notion selects every card the rectangle touches (any overlap, both axes). */
export const touches = (a: Box, b: Box) => a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;

/** Same selection? (avoids a re-render of every card on each pointer move) */
export const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
