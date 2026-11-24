import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "./store";

type GNode = { id: string; title: string; icon: string; kind: string; parent_id: string | null; readonly: boolean };
type GLink = { source: string; target: string };
type Sim = { id: string; x: number; y: number; vx: number; vy: number; r: number; n: GNode; deg: number; fixed?: boolean };

const PALETTE = ["#529cca", "#9a6dd7", "#df5452", "#d9730d", "#cb912f", "#4d9d66", "#d15796", "#8f8f8f"];

/** Graph view: every page is a dot, links and the page hierarchy are lines. Canvas + a small force layout. */
export function GraphView({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const cv = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [err, setErr] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [showMd, setShowMd] = useState(true);
  const [q, setQ] = useState("");
  const st = useRef({ showTree, q, hover: null as Sim | null, sel: null as string | null });
  st.current.showTree = showTree; st.current.q = q.trim().toLowerCase();

  useEffect(() => { api.get("/api/graph").then(setData).catch(() => setErr(true)); }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, [onClose]);

  const model = useMemo(() => {
    if (!data) return null;
    const keep = new Set(data.nodes.filter((n) => showMd || !n.readonly).map((n) => n.id));
    const all = data;
    const data2 = { nodes: all.nodes.filter((n) => keep.has(n.id)), links: all.links.filter((l) => keep.has(l.source) && keep.has(l.target)) };
    const byId = new Map<string, Sim>();
    const top = new Map<string, string>();       // id -> root ancestor id (colour)
    const nm = new Map(data2.nodes.map((n) => [n.id, n]));
    // colour = the ancestor one level under the top page (the top page itself for top-level pages)
    const root = (id: string): string => { let c = id, k = 0; while (nm.get(c)?.parent_id && nm.get(nm.get(c)!.parent_id!)?.parent_id && k++ < 50) c = nm.get(c)!.parent_id!; return c; };
    const roots = [...new Set(data2.nodes.map((n) => root(n.id)))];
    data2.nodes.forEach((n) => top.set(n.id, root(n.id)));
    const edges: { a: Sim; b: Sim; tree: boolean }[] = [];
    data2.nodes.forEach((n, i) => {
      const ang = i * 2.4, rad = 30 * Math.sqrt(i + 1);
      byId.set(n.id, { id: n.id, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, vx: 0, vy: 0, r: 5, n, deg: 0 });
    });
    const seen = new Set<string>();
    const add = (s: string, d: string, tree: boolean) => {
      const a = byId.get(s), b = byId.get(d); if (!a || !b) return;
      const k = tree ? `t${s}` : `${s}>${d}`; if (seen.has(k)) return; seen.add(k);
      edges.push({ a, b, tree }); a.deg++; b.deg++;
    };
    data2.nodes.forEach((n) => { if (n.parent_id) add(n.id, n.parent_id, true); });
    data2.links.forEach((l) => add(l.source, l.target, false));
    byId.forEach((s) => { s.r = 3.5 + Math.min(7, Math.sqrt(s.deg) * 1.5); });
    return { nodes: [...byId.values()], edges, byId, color: (id: string) => PALETTE[roots.indexOf(top.get(id)!) % PALETTE.length] };
  }, [data, showMd]);

  useEffect(() => {
    const c = cv.current; if (!c || !model) return;
    const ctx = c.getContext("2d")!;
    const { nodes, edges } = model;
    const view = { x: 0, y: 0, k: 1 };
    let w = 0, h = 0, dpr = 1, alpha = 1, raf = 0, dead = false;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const fg = col("--cn-fg", "#ddd"), fg2 = col("--cn-fg-2", "#999"), line = col("--cn-line-2", "rgba(255,255,255,.2)"), bg = col("--cn-bg", "#191919");

    const resize = () => {
      dpr = devicePixelRatio || 1; w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr; alpha = Math.max(alpha, .3);
      if (ready) fit();
    };
    let ready = false;
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    // start fitted: the layout is pre-settled, then fitted once
    const tick = () => {
      const n = nodes.length;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy;
        if (d2 > 360000) continue;
        if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
        const d = Math.sqrt(d2), f = (2600 * alpha) / d2; dx = dx / d * f; dy = dy / d * f;
        a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
      }
      for (const e of edges) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = e.tree ? 70 : 110, f = (d - rest) * (e.tree ? .04 : .025) * alpha, fx = dx / d * f, fy = dy / d * f;
        e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
      }
      for (const s of nodes) {
        s.vx -= s.x * .002 * alpha; s.vy -= s.y * .002 * alpha;
        if (s.fixed) { s.vx = s.vy = 0; continue; }
        s.vx *= .6; s.vy *= .6; s.x += s.vx; s.y += s.vy;
      }
      alpha = Math.max(0, alpha * .985 - .0003);
    };
    for (let i = 0; i < 250; i++) tick();
    const fit = () => {
      if (!nodes.length) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      nodes.forEach((s) => { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); });
      view.k = Math.min(2, .9 * Math.min(w / Math.max(40, x1 - x0), h / Math.max(40, y1 - y0)));
      view.x = -((x0 + x1) / 2) * view.k; view.y = -((y0 + y1) / 2) * view.k;
    };
    fit(); ready = true;
    const toScreen = (s: { x: number; y: number }) => [w / 2 + view.x + s.x * view.k, h / 2 + view.y + s.y * view.k];
    const pick = (px: number, py: number) => {
      let best: Sim | null = null, bd = 1e9;
      for (const s of nodes) { const [x, y] = toScreen(s); const d = Math.hypot(x - px, y - py); if (d < Math.max(12, s.r * view.k + 6) && d < bd) { bd = d; best = s; } }
      return best;
    };

    const draw = () => {
      if (dead) return;
      if (alpha > .002) tick();
      const S = st.current, hov = S.hover;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const near = new Set<string>();
      if (hov) { near.add(hov.id); edges.forEach((e) => { if (e.a === hov) near.add(e.b.id); if (e.b === hov) near.add(e.a.id); }); }
      const match = (s: Sim) => !S.q || (s.n.title || "").toLowerCase().includes(S.q);
      for (const e of edges) {
        if (e.tree && !S.showTree) continue;
        const [x1, y1] = toScreen(e.a), [x2, y2] = toScreen(e.b);
        const on = hov && (e.a === hov || e.b === hov);
        ctx.globalAlpha = hov ? (on ? .95 : .05) : e.tree ? .3 : .45;
        ctx.strokeStyle = on ? fg : e.tree ? line : model.color(e.a.id);
        ctx.lineWidth = e.tree ? 1 : 1.4; if (e.tree) ctx.setLineDash([3, 3]); else ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const s of nodes) {
        const [x, y] = toScreen(s), r = s.r * Math.min(1.6, Math.max(.7, view.k));
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        const dim = (hov && !near.has(s.id)) || (S.q && !match(s));
        ctx.globalAlpha = dim ? .15 : 1;
        ctx.fillStyle = model.color(s.id);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        if (s.id === app.pageId) { ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.stroke(); }
        const label = view.k > 1.6 || s.deg > 12 || s === hov || (S.q && match(s));
        if (label && !dim) {
          ctx.globalAlpha = s === hov ? 1 : .85; ctx.fillStyle = s === hov ? fg : fg2;
          ctx.font = `${s === hov ? 600 : 400} 12px system-ui, sans-serif`; ctx.textAlign = "center";
          const txt = `${s.n.icon ? s.n.icon + " " : ""}${s.n.title || t("Untitled")}`.slice(0, 40);
          ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(txt, x, y + r + 13); ctx.fillText(txt, x, y + r + 13);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // pointers: one = drag node or pan, two = pinch; wheel = zoom
    const pts = new Map<number, { x: number; y: number }>();
    let drag: Sim | null = null, moved = 0, pinch = 0;
    const rel = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const world = (p: { x: number; y: number }) => ({ x: (p.x - w / 2 - view.x) / view.k, y: (p.y - h / 2 - view.y) / view.k });
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId); const p = rel(e); pts.set(e.pointerId, p); moved = 0;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; return; }
      drag = pick(p.x, p.y); if (drag) { drag.fixed = true; alpha = Math.max(alpha, .3); }
    };
    const move = (e: PointerEvent) => {
      const p = rel(e), prev = pts.get(e.pointerId);
      if (!prev) { st.current.hover = pick(p.x, p.y); c.style.cursor = st.current.hover ? "pointer" : "grab"; return; }
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y); pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) view.k = Math.min(6, Math.max(.15, view.k * d / pinch)); pinch = d; return;
      }
      if (drag) { const wp = world(p); drag.x = wp.x; drag.y = wp.y; alpha = Math.max(alpha, .3); }
      else { view.x += p.x - prev.x; view.y += p.y - prev.y; }
    };
    const up = (e: PointerEvent) => {
      const p = rel(e); pts.delete(e.pointerId); pinch = 0;
      if (drag) { drag.fixed = false; if (moved < 6) { app.navigate(drag.id); onClose(); } drag = null; }
      else if (moved < 6 && pts.size === 0) { const s = pick(p.x, p.y); if (s) { app.navigate(s.id); onClose(); } }
      if (e.pointerType !== "mouse") st.current.hover = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const p = { x: e.clientX - c.getBoundingClientRect().left, y: e.clientY - c.getBoundingClientRect().top };
      const k0 = view.k, k1 = Math.min(6, Math.max(.15, k0 * Math.exp(-e.deltaY * .0015)));
      const wx = (p.x - w / 2 - view.x) / k0, wy = (p.y - h / 2 - view.y) / k0;
      view.k = k1; view.x = p.x - w / 2 - wx * k1; view.y = p.y - h / 2 - wy * k1;
    };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    (c as any).__fit = fit;
    return () => {
      dead = true; cancelAnimationFrame(raf); ro.disconnect();
      c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    };
  }, [model]);  // eslint-disable-line

  return (
    <div className="cn-graph" role="dialog" aria-label={t("Graph view")}>
      <div className="cn-graph-bar">
        <strong>{t("Graph view")}</strong>
        {data && <span className="cn-graph-count">{model?.nodes.length ?? data.nodes.length} {t("pages")} · {model?.edges.filter((e) => !e.tree).length ?? 0} {t("links")}</span>}
        <input className="cn-input" placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="cn-graph-chk"><input type="checkbox" checked={showTree} onChange={(e) => setShowTree(e.target.checked)} /> {t("Hierarchy")}</label>
        {data?.nodes.some((n) => n.readonly) && <label className="cn-graph-chk"><input type="checkbox" checked={showMd} onChange={(e) => setShowMd(e.target.checked)} /> {t("Hermes notes")}</label>}
        <button type="button" className="cn-btn sm" onClick={() => (cv.current as any)?.__fit?.()}>{t("Recenter")}</button>
        <button type="button" className="cn-icon-btn" title={t("Close")} onClick={onClose}><X size={18} /></button>
      </div>
      <canvas ref={cv} className="cn-graph-cv" />
      {!data && !err && <div className="cn-graph-msg">…</div>}
      {err && <div className="cn-graph-msg">{t("Could not load.")}</div>}
    </div>
  );
}
