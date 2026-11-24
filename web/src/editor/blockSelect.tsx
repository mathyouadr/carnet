import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { flatten, resolve, stripIds } from "./selectModel";
import type { BSel } from "./selectModel";
export { stripIds, flatten, resolve };

/**
 * Notion-style block selection.
 *  - drag a rectangle from the empty margins of the page: every block it touches is selected;
 *  - Esc on a line selects that block, Shift+↑/↓ (or Shift+click) extends, ↑/↓ moves;
 *  - then Delete, Ctrl+D (duplicate), Ctrl+C / Ctrl+X, Ctrl+A (all blocks), Enter (edit), Esc (leave).
 * The selection is a contiguous range (anchor → focus) in document order. It is also mirrored as a real
 * ProseMirror selection (best effort) so copy, drag with the side-menu handle, Tab and styles keep working natively.
 */
export type { BSel };
type Rect = { top: number; left: number; width: number; height: number };

const SKIP = ".bn-block-content, .bn-side-menu, .bn-toolbar, .bn-suggestion-menu, button, input, textarea, select, a[href], [contenteditable=true], .cn-pop, .cn-title, .cn-cover, .cn-icon";

export function useBlockSelect(editor: any, host: RefObject<HTMLDivElement | null>, editable: boolean, pageId: string) {
  const [sel, setSelState] = useState<BSel>(null);
  const selRef = useRef<BSel>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const [box, setBox] = useState<Rect | null>(null);
  const raf = useRef(0);

  const setSel = useCallback((s: BSel) => { selRef.current = s; setSelState(s); }, []);
  const current = useCallback(() => resolve(editor.document as any[], selRef.current), [editor]);

  const measure = useCallback(() => {
    const el = host.current;
    if (!el || !selRef.current) { setRects([]); return; }
    const base = el.getBoundingClientRect(), out: Rect[] = [];
    for (const id of current().top) {
      const n = el.querySelector(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
      if (!n) continue;
      const r = n.getBoundingClientRect();
      out.push({ top: r.top - base.top, left: r.left - base.left - 6, width: r.width + 12, height: r.height });
    }
    setRects(out);
  }, [host, current]);
  const later = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; measure(); }); }, [measure]);

  useLayoutEffect(() => { measure(); }, [sel, measure]);
  useEffect(() => {
    if (!sel) return;
    const el = host.current?.querySelector(".bn-editor");
    const ro = el ? new ResizeObserver(later) : null;
    if (el) ro!.observe(el);
    const off = editor.onChange?.(later);
    addEventListener("resize", later);
    return () => { ro?.disconnect(); if (typeof off === "function") off(); removeEventListener("resize", later); };
  }, [sel, editor, host, later]);

  const clear = useCallback(() => setSel(null), [setSel]);
  useEffect(() => { clear(); }, [pageId, clear]);
  useEffect(() => { if (!editable) clear(); }, [editable, clear]);
  useEffect(() => { host.current?.classList.toggle("bsel", !!sel); }, [sel, host]);

  /** Mirror the selection into ProseMirror (best effort: blocks without text may refuse). */
  const mirror = useCallback((focus = true) => {
    const { top } = current();
    if (!top.length) return;
    try { if (focus) editor.focus(); editor.setSelection(top[0], top[top.length - 1]); } catch { /* keep our own selection */ }
  }, [editor, current]);

  const select = useCallback((a: string, f: string, scrollTo?: string, pm = true) => {
    setSel({ a, f });
    if (pm) mirror();
    if (scrollTo) host.current?.querySelector(`.bn-block-outer[data-id="${CSS.escape(scrollTo)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [setSel, mirror, host]);

  const caretTo = useCallback((id: string | undefined, where: "start" | "end" = "end") => {
    if (!id) return;
    try { editor.setTextCursorPosition(id, where); editor.focus(); } catch { /* block without text */ }
  }, [editor]);

  const actions = useRef({} as {
    remove: () => void; duplicate: () => void; copy: () => void; cut: () => void; move: (up: boolean) => void;
    turn: (type: string, props: any) => void; edit: () => void; all: () => void;
  });
  actions.current = {
    remove() {
      const { top, order } = current();
      if (!top.length) return;
      const before = order[order.indexOf(top[0]) - 1];
      const after = order[order.indexOf(top[top.length - 1]) + 1];
      editor.removeBlocks(top);
      clear();
      const keep = [before, after].find((id) => id && editor.getBlock(id));
      caretTo(keep, before === keep ? "end" : "start");
    },
    duplicate() {
      const { top } = current();
      if (!top.length) return;
      const copies = top.map((id) => editor.getBlock(id)).filter(Boolean).map(stripIds);
      const ins = editor.insertBlocks(copies, top[top.length - 1], "after");
      if (ins?.length) select(ins[0].id, ins[ins.length - 1].id, ins[ins.length - 1].id);
    },
    copy() { mirror(); document.execCommand("copy"); },
    cut() { mirror(); document.execCommand("copy"); this.remove(); },
    move(up) {
      mirror();
      try { up ? editor.moveBlocksUp() : editor.moveBlocksDown(); } catch { /* at the edge */ }
      later();
    },
    turn(type, props) {
      for (const id of current().top) {
        const b = editor.getBlock(id);
        if (b && Array.isArray(b.content)) editor.updateBlock(id, { type, props: props || {} });
      }
      later();
    },
    edit() { const { top } = current(); const last = top[top.length - 1]; clear(); caretTo(last, "end"); },
    all() { const { order } = flatten(editor.document); if (order.length) select(order[0], order[order.length - 1], undefined, true); },
  };

  // ---- keyboard + pointer ------------------------------------------------------------------------------
  useEffect(() => {
    const el = host.current;
    if (!el || !editable) return;
    const area = (el.closest(".cn-scroll") as HTMLElement) || el;
    const idOf = (n: Element | null) => n?.closest?.(".bn-block-outer")?.getAttribute("data-id") || null;
    const popupOpen = () => !!document.querySelector(".cn-pop, .bn-suggestion-menu");

    const key = (e: KeyboardEvent) => {
      if (e.isComposing || popupOpen()) return;
      const t = e.target as HTMLElement;
      const inEd = !!t.closest?.(".bn-editor");
      const s = selRef.current;
      const mod = e.ctrlKey || e.metaKey;
      if (!s) {
        // Esc on a line: select that block
        if (e.key === "Escape" && inEd && !mod && !e.altKey && !e.shiftKey && editable) {
          let id: string | undefined;
          try { id = editor.getTextCursorPosition().block.id; } catch { /* no cursor */ }
          if (!id) return;
          e.preventDefault(); e.stopPropagation();
          select(id, id, id);
        }
        return;
      }
      if (!inEd && t.closest?.("input, textarea, select, [contenteditable=true]")) return;
      const { order } = current();
      const fi = order.indexOf(s.f);
      const done = () => { e.preventDefault(); e.stopPropagation(); };
      const k = e.key.toLowerCase();
      if (e.key === "Escape") { done(); const { top } = current(); const last = top[top.length - 1]; clear(); caretTo(last, "end"); return; }
      if (e.key === "Enter" && !mod) { done(); actions.current.edit(); return; }
      if (e.key === "Backspace" || e.key === "Delete") { done(); actions.current.remove(); return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (mod || e.altKey) return;
        done();
        const nf = order[fi + (e.key === "ArrowUp" ? -1 : 1)];
        if (!nf) return;
        if (e.shiftKey) select(s.a, nf, nf); else select(nf, nf, nf);
        return;
      }
      if (mod && k === "a") { done(); actions.current.all(); return; }
      if (mod && k === "d") { done(); actions.current.duplicate(); return; }
      if (mod && k === "x") { done(); actions.current.cut(); return; }
      if (mod && (k === "z" || k === "y")) { clear(); return; }        // undo / redo: leave the mode, let the editor act
      if (mod || e.altKey || e.key === "Tab" || e.key.length > 1) return;  // copy, bold, indent, F-keys… stay native
      done();                                                             // typing does nothing while blocks are selected (Notion)
    };

    // fallback copy when ProseMirror refused the selection (e.g. only non-text blocks)
    const copy = (e: ClipboardEvent) => {
      if (!selRef.current || editor.getSelection?.()) return;
      const blocks = current().top.map((id) => editor.getBlock(id)).filter(Boolean);
      if (!blocks.length) return;
      e.preventDefault();
      try { e.clipboardData?.setData("text/plain", editor.blocksToMarkdownLossy(blocks)); e.clipboardData?.setData("text/html", editor.blocksToHTMLLossy(blocks)); } catch { /* nothing to copy */ }
    };

    // marquee
    let g: { sx: number; sy: number; st: number; cx: number; cy: number; on: boolean; loop: number } | null = null;
    const hit = () => {
      if (!g) return;
      const ay = g.sy - (area.scrollTop - g.st);
      const top = Math.min(ay, g.cy), bottom = Math.max(ay, g.cy);
      const ids: string[] = [];
      el.querySelectorAll(".bn-block-content").forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.bottom >= top && r.top <= bottom) { const id = idOf(c); if (id) ids.push(id); }
      });
      if (ids.length) setSel({ a: ids[0], f: ids[ids.length - 1] }); else setSel(null);
      const base = el.getBoundingClientRect();
      setBox({ left: Math.min(g.sx, g.cx) - base.left, top: top - base.top, width: Math.abs(g.cx - g.sx), height: bottom - top });
    };
    const loop = () => {
      if (!g || !g.on) return;
      const r = area.getBoundingClientRect(), zone = 56;
      const d = g.cy < r.top + zone ? -(r.top + zone - g.cy) : g.cy > r.bottom - zone ? g.cy - (r.bottom - zone) : 0;
      if (d) { area.scrollTop += Math.sign(d) * Math.min(24, 3 + Math.abs(d) / 4); hit(); }
      g.loop = requestAnimationFrame(loop);
    };
    const noSelect = (e: Event) => e.preventDefault();
    const move = (e: PointerEvent) => {
      if (!g) return;
      g.cx = e.clientX; g.cy = e.clientY;
      if (!g.on) {
        if (Math.hypot(g.cx - g.sx, g.cy - g.sy) < 5) return;
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
      const was = g?.on;
      if (g) cancelAnimationFrame(g.loop);
      g = null; setBox(null);
      if (was && selRef.current) mirror();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest?.(".cn-pop, .bn-toolbar, .bn-suggestion-menu, .cn-toolbar, .bn-side-menu")) return;   // toolbars and the drag handle act on the selection
      const inEd = !!t.closest?.(".bn-editor");
      if (selRef.current && inEd && e.shiftKey) {            // Shift+click extends the range
        const id = idOf(t);
        if (id) { e.preventDefault(); e.stopPropagation(); select(selRef.current.a, id, id); return; }
      }
      if (selRef.current) clear();
      if (e.pointerType !== "mouse" || !area.contains(t) || t.closest?.(SKIP)) return;
      const first = el.querySelector(".bn-block-content")?.getBoundingClientRect();
      if (!first || e.clientY < first.top - 6) return;
      g = { sx: e.clientX, sy: e.clientY, st: area.scrollTop, cx: e.clientX, cy: e.clientY, on: false, loop: 0 };
      addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    };

    document.addEventListener("keydown", key, true);
    document.addEventListener("copy", copy, true);
    area.addEventListener("pointerdown", down, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("copy", copy, true);
      area.removeEventListener("pointerdown", down, true);
      up();
    };
  }, [editor, host, editable, current, select, clear, caretTo, mirror, setSel]);

  /** True when a client Y lies inside the selected blocks (right-click on the selection). */
  const hits = useCallback((y: number) => {
    const el = host.current;
    if (!el || !selRef.current) return false;
    const base = el.getBoundingClientRect();
    return rects.some((r) => y >= base.top + r.top - 4 && y <= base.top + r.top + r.height + 4);
  }, [host, rects]);

  return { active: !!sel, rects, box, hits, clear, actions, current };
}

/** The blue tint over selected blocks and the drag rectangle. Rendered inside `.cn-editor` (position: relative). */
export function BlockSelectLayer({ rects, box }: { rects: Rect[]; box: Rect | null }) {
  if (!rects.length && !box) return null;
  return (
    <div className="cn-bsel-layer" aria-hidden="true">
      {rects.map((r, i) => <div key={i} className="cn-bsel" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />)}
      {box && <div className="cn-marquee" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />}
    </div>
  );
}
