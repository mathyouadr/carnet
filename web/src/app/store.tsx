import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, BASE, BOOT, Summary } from "../api";
import { t } from "../i18n";

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
  setSearchOpen: (v: boolean) => void;
  mobile: boolean;
  titleOf: (id: string) => string;
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
  const [route, setRoute] = useState(parseRoute);
  const [peek, setPeekState] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mobile = useMobile();
  useKeyboardFlag(mobile);
  const [sidebar, setSidebarState] = useState(() => !matchMedia("(max-width: 760px)").matches && localStorage.getItem("carnet:sidebar") !== "0");
  const [searchOpen, setSearchOpen] = useState(false);
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

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), action ? 6000 : 3000);
  }, []);

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
    peek, setPeek: setPeekState, toast, toasts, createPage, trashPage, sidebar, setSidebar, searchOpen, setSearchOpen,
    mobile, titleOf,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export { BOOT };
