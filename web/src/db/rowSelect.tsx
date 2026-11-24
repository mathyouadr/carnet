import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Trash2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../app/store";
import { t } from "../i18n";
import { MenuItem, MenuLabel, Popover } from "../ui/Popover";
import { dragBox, sameSet, touches } from "./rowSelectModel";
import type { Box } from "./rowSelectModel";

/**
 * Notion-style selection of cards / rows in a database view: drag a rectangle from the empty space, every card
 * it touches turns blue. Then Delete (to the trash, with Undo), Ctrl+D, Ctrl+A, Esc, Ctrl+click to add or remove
 * one, right-click for the menu. Items are the elements carrying `data-row="<page id>"`.
 */
export type RowSel = { ids: Set<string>; toggle: (id: string) => void; clear: () => void; menu: (at: DOMRect) => void };
export const RowSelCtx = createContext<RowSel | null>(null);
export const useRowSel = () => useContext(RowSelCtx);

const SKIP = "[data-row], .cn-tr, .cn-list-row, .cn-card, button, input, textarea, select, a[href], .cn-pop, .cn-db-bar, .cn-db-title, .cn-title, .cn-cover, .cn-icon, .bn-side-menu, .cn-toolbar";

/** A text field the user is typing in (a database block sits in a contenteditable=false island of the editor). */
const typing = (el: HTMLElement) => { const ce = el.closest?.("[contenteditable]"); return !!ce && ce.getAttribute("contenteditable") !== "false"; };

export function useRowSelect({ root, dbId, inline, readOnly, reload }: {
  root: HTMLElement | null; dbId: string; inline?: boolean; readOnly: boolean; reload: () => void;
}) {
  const app = useApp();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const idsRef = useRef(ids);
  const [box, setBox] = useState<Box | null>(null);
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  const set = useCallback((s: Set<string>) => { if (!sameSet(idsRef.current, s)) { idsRef.current = s; setIds(s); } }, []);
  const clear = useCallback(() => set(new Set()), [set]);
  const toggle = useCallback((id: string) => { const n = new Set(idsRef.current); n.has(id) ? n.delete(id) : n.add(id); set(n); }, [set]);

  const remove = useCallback(async () => {
    const list = [...idsRef.current];
    if (!list.length || readOnly) return;
    clear();
    try { for (const id of list) await api.del(`/api/pages/${id}`); }
    catch (e: any) { app.toast(t("Your changes could not be saved: {msg}").replace("{msg}", String(e?.message))); }
    await app.refresh(); reload();
    app.toast(`${t("Move to trash")} ✓ (${list.length})`, {
      label: t("Undo"),
      run: async () => { for (const id of list) await api.post(`/api/pages/${id}/restore`); await app.refresh(); reload(); },
    });
  }, [app, clear, readOnly, reload]);

  const duplicate = useCallback(async () => {
    const list = [...idsRef.current];
    if (!list.length || readOnly) return;
    try { for (const id of list) await api.post(`/api/pages/${id}/duplicate`); }
    catch (e: any) { app.toast(String(e?.message || e)); }
    await app.refresh(); reload();
  }, [app, readOnly, reload]);

  const actions = useRef({ remove, duplicate });
  actions.current = { remove, duplicate };

  useEffect(() => { clear(); }, [dbId, clear]);

  useEffect(() => {
    if (!root) return;
    const scroller = (root.closest(".cn-scroll") as HTMLElement) || (document.scrollingElement as HTMLElement);
    const area = inline ? root : scroller && scroller.contains(root) ? scroller : root;   // a database inside a page: its own space only
    const items = () => Array.from(root.querySelectorAll<HTMLElement>("[data-row]"));
    const popupOpen = () => !!document.querySelector(".cn-pop");

    const key = (e: KeyboardEvent) => {
      if (!idsRef.current.size || e.isComposing || popupOpen()) return;
      const tg = e.target as HTMLElement;
      if (tg.closest?.("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === "Escape") { stop(); clear(); }
      else if (e.key === "Delete" || e.key === "Backspace") { stop(); actions.current.remove(); }
      else if (mod && k === "d") { stop(); actions.current.duplicate(); }
      else if (mod && k === "a") { stop(); set(new Set(items().map((n) => n.dataset.row!))); }
    };

    let g: { x: number; y: number; st: number; cx: number; cy: number; on: boolean; loop: number } | null = null;
    const hit = () => {
      if (!g) return;
      const b = dragBox({ x: g.x, y: g.y, scrollTop: g.st }, { x: g.cx, y: g.cy, scrollTop: scroller?.scrollTop ?? 0 });
      const out = new Set<string>();
      for (const n of items()) { const r = n.getBoundingClientRect(); if (touches(b, r)) out.add(n.dataset.row!); }
      set(out); setBox(b);
    };
    const loop = () => {
      if (!g || !g.on || !scroller) return;
      const r = scroller.getBoundingClientRect(), zone = 56;
      const d = g.cy < r.top + zone ? -(r.top + zone - g.cy) : g.cy > r.bottom - zone ? g.cy - (r.bottom - zone) : 0;
      if (d) { scroller.scrollTop += Math.sign(d) * Math.min(24, 3 + Math.abs(d) / 4); hit(); }
      g.loop = requestAnimationFrame(loop);
    };
    const noSelect = (e: Event) => e.preventDefault();
    const move = (e: PointerEvent) => {
      if (!g) return;
      g.cx = e.clientX; g.cy = e.clientY;
      if (!g.on) {
        if (Math.hypot(g.cx - g.x, g.cy - g.y) < 5) return;
        g.on = true;
        document.body.classList.add("cn-marquee-on");
        document.addEventListener("selectstart", noSelect, true);
        (document.activeElement as HTMLElement | null)?.blur?.();
        getSelection()?.removeAllRanges();
        g.loop = requestAnimationFrame(loop);
      }
      e.preventDefault();
      hit();
    };
    const up = () => {
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
      document.removeEventListener("selectstart", noSelect, true);
      document.body.classList.remove("cn-marquee-on");
      if (g) cancelAnimationFrame(g.loop);
      g = null; setBox(null);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tg = e.target as HTMLElement;
      if (tg.closest?.(".cn-pop")) return;
      if ((e.ctrlKey || e.metaKey) && tg.closest?.("[data-row]")) return;       // Ctrl+click toggles (see the card)
      if (idsRef.current.size) clear();
      if (e.pointerType !== "mouse" || !area.contains(tg) || tg.closest?.(SKIP) || typing(tg)) return;
      if (!items().length) return;
      g = { x: e.clientX, y: e.clientY, st: scroller?.scrollTop ?? 0, cx: e.clientX, cy: e.clientY, on: false, loop: 0 };
      addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    };
    // a click anywhere else on the page also leaves the selection (this view only listens inside its area while dragging)
    const away = (e: PointerEvent) => {
      if (!idsRef.current.size || e.button !== 0) return;
      const tg = e.target as HTMLElement;
      if (tg.closest?.(".cn-pop") || root.contains(tg)) return;
      if ((e.ctrlKey || e.metaKey) && tg.closest?.("[data-row]")) return;
      clear();
    };

    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", away, true);
    area.addEventListener("pointerdown", down, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", away, true);
      area.removeEventListener("pointerdown", down, true);
      up();
    };
  }, [root, inline, readOnly, clear, set]);

  const ctx = useMemo<RowSel>(() => ({ ids, toggle, clear, menu: setMenuAt }), [ids, toggle, clear]);
  const layer = (
    <>
      {box && createPortal(
        <div className="cn-marquee fixed" aria-hidden="true" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />, document.body)}
      {menuAt && ids.size > 0 && (
        <Popover anchor={menuAt} onClose={() => setMenuAt(null)} width={220}>
          <MenuLabel>{t("{n} selected").replace("{n}", String(ids.size))}</MenuLabel>
          {!readOnly && <>
            <MenuItem icon={<Copy size={15} />} onClick={() => { setMenuAt(null); actions.current.duplicate(); }}>{t("Duplicate")}</MenuItem>
            <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { setMenuAt(null); actions.current.remove(); }}>{t("Move to trash")}</MenuItem>
          </>}
        </Popover>
      )}
    </>
  );
  return { ctx, layer };
}
