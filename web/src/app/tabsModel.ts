// Page tabs (like Notion desktop or a file explorer): a list of tabs, each showing one page, one active.
// Pure functions, tested by tests/tabs.test.ts; the React side lives in store.tsx / Tabs.tsx.

export type Tab = { k: string; id: string | null; scroll?: number };
export type TabsState = { list: Tab[]; active: string };

export const MAX_TABS = 20;

let seq = 0;
export const newKey = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Restore the saved tabs; the page in the URL wins over the saved active tab. */
export function initTabs(saved: unknown, routeId: string | null, key = newKey): TabsState {
  let list: Tab[] = [];
  let active = "";
  const s = saved as TabsState | null;
  if (s && Array.isArray(s.list)) {
    list = s.list
      .filter((x) => x && typeof x.k === "string" && (typeof x.id === "string" || x.id === null))
      .slice(0, MAX_TABS)
      .map((x) => ({ k: x.k, id: x.id, scroll: typeof x.scroll === "number" ? x.scroll : undefined }));
    active = typeof s.active === "string" ? s.active : "";
  }
  if (!list.length) list = [{ k: key(), id: routeId }];
  if (!list.some((x) => x.k === active)) active = list[0].k;
  if (routeId) {
    const cur = list.find((x) => x.k === active)!;
    if (cur.id !== routeId) {
      const other = list.find((x) => x.id === routeId);
      if (other) active = other.k;
      else list = list.map((x) => (x.k === active ? { ...x, id: routeId, scroll: undefined } : x));
    }
  }
  return { list, active };
}

export const activeTab = (s: TabsState) => s.list.find((x) => x.k === s.active) || s.list[0];

/** The active tab now shows `id` (a normal click / navigation). */
export function showInActive(s: TabsState, id: string | null): TabsState {
  const cur = activeTab(s);
  if (cur.id === id) return s;
  return { ...s, list: s.list.map((x) => (x.k === cur.k ? { ...x, id, scroll: undefined } : x)) };
}

/** Open `id` in a new tab right after the active one. */
export function openTab(s: TabsState, id: string | null, opts: { background?: boolean; key?: string } = {}): TabsState {
  if (s.list.length >= MAX_TABS) return showInActive(s, id);
  const k = opts.key || newKey();
  const i = s.list.findIndex((x) => x.k === s.active);
  const list = [...s.list];
  list.splice(i + 1, 0, { k, id });
  return { list, active: opts.background ? s.active : k };
}

/** Close a tab; closing the active one activates its right neighbour (else the left one). The last tab stays. */
export function closeTab(s: TabsState, k: string): TabsState {
  if (s.list.length <= 1) return s;
  const i = s.list.findIndex((x) => x.k === k);
  if (i < 0) return s;
  const list = s.list.filter((x) => x.k !== k);
  const active = s.active !== k ? s.active : list[Math.min(i, list.length - 1)].k;
  return { list, active };
}

/** Close every tab but `k`. */
export function closeOthers(s: TabsState, k: string): TabsState {
  const keep = s.list.find((x) => x.k === k);
  return keep ? { list: [keep], active: k } : s;
}

/** Close the tabs on the right of `k`. */
export function closeRight(s: TabsState, k: string): TabsState {
  const i = s.list.findIndex((x) => x.k === k);
  if (i < 0) return s;
  const list = s.list.slice(0, i + 1);
  return { list, active: list.some((x) => x.k === s.active) ? s.active : k };
}

export const activate = (s: TabsState, k: string): TabsState => (s.list.some((x) => x.k === k) ? { ...s, active: k } : s);

/** Drag & drop: move tab `k` to position `to` (index in the list before the move). */
export function moveTab(s: TabsState, k: string, to: number): TabsState {
  const i = s.list.findIndex((x) => x.k === k);
  if (i < 0) return s;
  const list = [...s.list];
  const [t] = list.splice(i, 1);
  const j = Math.max(0, Math.min(to > i ? to - 1 : to, list.length));
  list.splice(j, 0, t);
  return { ...s, list };
}

export const setScroll = (s: TabsState, k: string, scroll: number): TabsState =>
  ({ ...s, list: s.list.map((x) => (x.k === k ? { ...x, scroll } : x)) });

/** Pages deleted for good: their tabs close (a tab never shows a page that no longer exists). */
export function dropMissing(s: TabsState, exists: (id: string) => boolean): TabsState {
  let out = s;
  for (const x of s.list) if (x.id && !exists(x.id)) out = out.list.length > 1 ? closeTab(out, x.k) : showInActive(out, null);
  return out;
}
