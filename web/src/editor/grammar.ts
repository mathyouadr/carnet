// Spelling / grammar issues (LanguageTool matches) mapped onto the text segments of a page. Pure, tested by
// tests/grammar.test.ts. A segment = the text of one block (one table cell); they are sent joined by "\n\n".

export type Match = { offset: number; length: number; message: string; short?: string; replacements: string[]; rule: string; type: string; category: string };
export type Issue = Match & { key: string; seg: number; at: number; str: string };

export const SEP = "\n\n";

export function joinSegments(texts: string[]): { text: string; starts: number[] } {
  const starts: number[] = [];
  let pos = 0;
  for (const s of texts) { starts.push(pos); pos += s.length + SEP.length; }
  return { text: texts.join(SEP), starts };
}

/** Matches in the joined text -> issues inside one segment (those across segments or on a placeholder are dropped). */
export function locate(matches: Match[], texts: string[], starts: number[]): Issue[] {
  const out: Issue[] = [];
  for (const m of matches) {
    let seg = -1;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= m.offset) seg = i;
    if (seg < 0) continue;
    const at = m.offset - starts[seg];
    const str = texts[seg].slice(at, at + m.length);
    if (!m.length || at + m.length > texts[seg].length || str.includes(PLACEHOLDER)) continue;
    out.push({ ...m, key: `${seg}:${at}:${m.rule}`, seg, at, str });
  }
  return out;
}

/** Character standing for an inline element that is not text (mention, equation): never corrected. */
export const PLACEHOLDER = "\uFFFC";

export const isSpelling = (i: Match) => i.type === "misspelling" || i.category === "TYPOS";

/** Words the user added to his dictionary are not spelling mistakes. */
export function filterDict<T extends Match & { str: string }>(issues: T[], dict: Set<string>): T[] {
  return issues.filter((i) => !(isSpelling(i) && dict.has(i.str.toLowerCase())));
}

/** Where the issue's text is now in its segment (after edits): same place, else the nearest occurrence, else -1. */
export function relocate(text: string, at: number, str: string): number {
  if (text.slice(at, at + str.length) === str) return at;
  let best = -1, bd = Infinity, i = text.indexOf(str);
  while (i >= 0) {
    if (Math.abs(i - at) < bd) { bd = Math.abs(i - at); best = i; }
    i = text.indexOf(str, i + 1);
  }
  return bd <= 400 ? best : -1;
}

/** A few words around the mistake, for the list. */
export function context(text: string, at: number, len: number, room = 30): { before: string; err: string; after: string } {
  const s = Math.max(0, at - room), e = Math.min(text.length, at + len + room);
  return { before: (s > 0 ? "…" : "") + text.slice(s, at), err: text.slice(at, at + len), after: text.slice(at + len, e) + (e < text.length ? "…" : "") };
}
