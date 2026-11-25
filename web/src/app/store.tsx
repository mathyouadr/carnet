import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, BASE, BOOT, Summary } from "../api";
import { t } from "../i18n";
import * as T from "./tabsModel";
import type { TabsState } from "./tabsModel";

// ------------------------------------------------------------------ routing (history API)
export function pagePath(id: string) {
  return `${BASE}/p/${id}`;
}

function parseRoute(): { pageId: string | null } {
  const p = location.pathname.slice(BASE.length);
  const m = p.match(/^\/p\/([a-z0-9]+)/);
  return { pageId: m ? m[1] : null };
}

// ------------------------------------------------------------------ toasts
export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

type Ctx = {
  tree: Summary[];
  byId: Map<string, Summary>;
  children: (id: string | null) => Summary[];
  settings: Record<string, any>;
  refresh: () => Promise<void>;
  patchTree: (id: string, patch: Partial<Summary>) => void;
  pageId: string | null;
  navigate: (id: string | null, opts?: { replace?: boolean }) => void;
  peek: string | null;
  setPeek: (id: string | null) => void;
  toast: (text: string, action?: Toast["action"]) => void;
  toasts: Toast[];
  createPage: (data: Record<string, any>, open?: boolean) => Promise<any>;
  trashPage: (id: string) => Promise<void>;
  sidebar: boolean;
  setSidebar: (v: boolean) => void;
  searchOpen: boolean;
  graphOpen: boolean;
  setGraphOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  mobile: boolean;
  titleOf: (id: string) => string;
  // page tabs (desktop): see tabsModel.ts
  tabs: TabsState;
  openTab: (id: string | null, opts?: { background?: boolean }) => void;
  switchTab: (k: string) => void;
  closeTab: (k: string) => void;
  closeOtherTabs: (k: string) => void;
  closeRightTabs: (k: string) => void;
  moveTab: (k: string, to: number) => void;
  /** a link click: Ctrl/Cmd + click or middle click opens a new tab (desktop), else the page opens here */
  open: (id: string, e?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; button?: number; preventDefault?: () => void }) => void;
  /** props for an element that opens a page: click, Ctrl+click and middle click */
  linkProps: (id: string) => { onClick: (e: React.MouseEvent) => void; onAuxClick: (e: React.MouseEvent) => void; onMouseDown: (e: React.MouseEvent) => void };
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

function useMobile() {
  const q = "(max-width: 760px)";
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

/** Phones: mark <html> with `cn-kb` while the on-screen keyboard is up (an editable has focus and the
 *  visual viewport lost > 120 px). CSS then drops the host's bottom tab bar so the editor keeps its room. */
function useKeyboardFlag(mobile: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!mobile || !vv) { root.classList.remove("cn-kb"); return; }
    let base = vv.height;
    const editable = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    const on = () => {
      const ed = editable();
      if (!ed) base = Math.max(base, vv.height + vv.offsetTop);
      root.classList.toggle("cn-kb", ed && base - vv.height - vv.offsetTop > 120);
    };
    const orient = () => { base = vv.height; on(); };
    vv.addEventListener("resize", on);
    document.addEventListener("focusin", on);
    const off = () => { setTimeout(on, 50); };
    document.addEventListener("focusout", off);
    window.addEventListener("orientationchange", orient);
    on();
    return () => {
      vv.removeEventListener("resize", on);
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
      window.removeEventListener("orientationchange", orient);
      root.classList.remove("cn-kb");
    };
  }, [mobile]);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<Summary[]>([]);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [tabs, setTabs] = useState<TabsState>(() => {
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem("carnet:tabs") || "null"); } catch { /* ignore */ }
    return T.initTabs(saved, parseRoute().pageId);
  });
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // home URL: reopen the page of the active tab
  const [route, setRoute] = useState(() => {
    const r = parseRoute();
    const id = T.activeTab(tabs).id;
    if (!r.pageId && id && location.pathname.slice(BASE.length).replace(/\/$/, "") === "") {
      history.replaceState({ i: (history.state?.i as number) || 0 }, "", pagePath(id));
      return { pageId: id };
    }
    return r;
  });
  const [peek, setPeekState] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mobile = useMobile();
  useKeyboardFlag(mobile);
  const [sidebar, setSidebarState] = useState(() => !matchMedia("(max-width: 760px)").matches && localStorage.getItem("carnet:sidebar") !== "0");
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const toastId = useRef(0);

  const refresh = useCallback(async () => {
    const b = await api.get("/api/bootstrap");
    setTree(b.tree);
    setSettings(b.settings || {});
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  // a click handler whose request failed must say so (no silent loss)
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => {
      const msg = String((e.reason as any)?.message || e.reason || "");
      if (msg) setToasts((ts) => [...ts.slice(-2), { id: ++toastId.current, text: t("Your changes could not be saved: {msg}").replace("{msg}", msg) }]);
    };
    addEventListener("unhandledrejection", on);
    return () => removeEventListener("unhandledrejection", on);
  }, []);
  // a Carnet update removed the code this tab still uses (clientLog.ts): say so, with a reload button
  useEffect(() => {
    let shown = false;                                  // one notice, even when several chunks fail
    const on = () => {
      if (shown) return;
      shown = true;
      setToasts((ts) => [...ts.slice(-2), { id: ++toastId.current, text: t("Carnet was updated: reload the page"),
        action: { label: t("Reload"), run: () => location.reload() } }]);
    };
    addEventListener("carnet:stale", on);
    return () => removeEventListener("carnet:stale", on);
  }, []);
  useEffect(() => {
    const on = () => { setRoute(parseRoute()); setPeekState(null); };
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  // refresh the tree when coming back to the tab (edits from the phone / the API)
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") refresh().catch(() => {}); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [refresh]);

  const byId = useMemo(() => new Map(tree.map((p) => [p.id, p])), [tree]);

  // tabs: the active tab follows the route; saved for the next visit; tabs of deleted pages close
  useEffect(() => { setTabs((s) => T.showInActive(s, route.pageId)); }, [route.pageId]);
  useEffect(() => { try { localStorage.setItem("carnet:tabs", JSON.stringify(tabs)); } catch { /* full */ } }, [tabs]);
  useEffect(() => {
    if (!tree.length) return;
    setTabs((s) => { const cur = T.activeTab(s).id; return T.dropMissing(s, (id) => byId.has(id) || id === cur); });
  }, [tree, byId]);
  const kids = useMemo(() => {
    const m = new Map<string | null, Summary[]>();
    for (const p of tree) {
      const k = p.parent_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    return m;
  }, [tree]);

  const navigate = useCallback((id: string | null, opts?: { replace?: boolean }) => {
    const url = id ? pagePath(id) : `${BASE}/`;
    // history.state.i = how many in-app steps deep we are (drives the phone "back" button)
    const depth = (history.state?.i as number) || 0;
    if (opts?.replace) history.replaceState({ i: depth }, "", url);
    else if (location.pathname !== url) history.pushState({ i: depth + 1 }, "", url);
    setRoute({ pageId: id });
    setPeekState(null);
    if (id) localStorage.setItem("carnet:last", id);
    if (matchMedia("(max-width: 760px)").matches) setSidebarState(false);
    window.scrollTo(0, 0);
  }, []);

  // phones: a card opens as a full page (back button, history, edit toggle), not in the side "peek" panel
  const setPeek = useCallback((id: string | null) => {
    if (id && matchMedia("(max-width: 760px)").matches) navigate(id);
    else setPeekState(id);
  }, [navigate]);

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.filter((x) => x.text !== text || x.action).slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), action ? 6000 : 3000);
  }, []);

  // ---- tabs
  const scroller = () => document.querySelector<HTMLElement>(".cn-main > .cn-scroll");
  /** show tab `next` (already in the state): URL replaced (not pushed), scroll restored once the page is drawn */
  const show = useCallback((next: TabsState) => {
    const before = tabsRef.current;
    const el = scroller();
    if (el && before.active !== next.active) next = T.setScroll(next, before.active, el.scrollTop);
    tabsRef.current = next;
    setTabs(next);
    if (before.active === next.active) return;
    const tab = T.activeTab(next);
    const url = tab.id ? pagePath(tab.id) : `${BASE}/`;
    history.replaceState({ i: (history.state?.i as number) || 0 }, "", url);
    setRoute({ pageId: tab.id });
    setPeekState(null);
    if (tab.id) localStorage.setItem("carnet:last", tab.id);
    const y = tab.scroll || 0;
    [60, 250, 600, 1200].forEach((ms) => setTimeout(() => {
      const s = scroller();
      if (s && tabsRef.current.active === tab.k && Math.abs(s.scrollTop - y) > 2 && s.scrollHeight - s.clientHeight >= y - 2) s.scrollTop = y;
    }, ms));
  }, []);

  const openTab = useCallback((id: string | null, opts?: { background?: boolean }) => {
    if (matchMedia("(max-width: 760px)").matches) { if (id) navigate(id); return; }
    if (tabsRef.current.list.length >= T.MAX_TABS) { toast(t("{n} tabs at most: close one first").replace("{n}", String(T.MAX_TABS))); return; }
    show(T.openTab(tabsRef.current, id, opts));
  }, [navigate, show, toast]);
  const switchTab = useCallback((k: string) => show(T.activate(tabsRef.current, k)), [show]);
  const closeTab = useCallback((k: string) => show(T.closeTab(tabsRef.current, k)), [show]);
  const closeOtherTabs = useCallback((k: string) => show(T.closeOthers(tabsRef.current, k)), [show]);
  const closeRightTabs = useCallback((k: string) => show(T.closeRight(tabsRef.current, k)), [show]);
  const moveTab = useCallback((k: string, to: number) => show(T.moveTab(tabsRef.current, k, to)), [show]);

  const open = useCallback((id: string, e?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; button?: number; preventDefault?: () => void }) => {
    const wantsTab = !!e && (e.button === 1 || !!e.ctrlKey || !!e.metaKey);
    if (wantsTab && !matchMedia("(max-width: 760px)").matches) {
      e!.preventDefault?.();
      openTab(id, { background: !e!.shiftKey });     // like a browser: Ctrl+click = background, Ctrl+Shift+click = go there
    } else navigate(id);
  }, [navigate, openTab]);
  const linkProps = useCallback((id: string) => ({
    onClick: (e: React.MouseEvent) => open(id, e),
    onAuxClick: (e: React.MouseEvent) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); open(id, e); } },
    onMouseDown: (e: React.MouseEvent) => { if (e.button === 1) e.preventDefault(); },   // no autoscroll cursor
  }), [open]);


  const patchTree = useCallback((id: string, patch: Partial<Summary>) => {
    setTree((ts) => ts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const createPage = useCallback(async (data: Record<string, any>, open = true) => {
    const page = await api.post("/api/pages", data);
    await refresh();
    if (open) navigate(page.id);
    return page;
  }, [refresh, navigate]);

  const trashPage = useCallback(async (id: string) => {
    try { await api.del(`/api/pages/${id}`); } catch (e: any) { toast(t("Your changes could not be saved: {msg}").replace("{msg}", String(e?.message))); return; }
    await refresh();
    toast(t("Move to trash") + " ✓", {
      label: t("Undo"),
      run: async () => { await api.post(`/api/pages/${id}/restore`); await refresh(); },
    });
    if (route.pageId === id) navigate(null, { replace: true });
  }, [refresh, toast, navigate, route.pageId]);

  const setSidebar = useCallback((v: boolean) => {
    setSidebarState(v);
    if (!matchMedia("(max-width: 760px)").matches) localStorage.setItem("carnet:sidebar", v ? "1" : "0");
  }, []);

  const titleOf = useCallback((id: string) => byId.get(id)?.title || t("Untitled"), [byId]);

  const value: Ctx = {
    tree, byId, children: (id) => kids.get(id) || [], settings, refresh, patchTree, pageId: route.pageId, navigate,
    peek, setPeek, toast, toasts, createPage, trashPage, sidebar, setSidebar, searchOpen, setSearchOpen, graphOpen, setGraphOpen,
    mobile, titleOf,
    tabs, openTab, switchTab, closeTab, closeOtherTabs, closeRightTabs, moveTab, open, linkProps,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export { BOOT };
