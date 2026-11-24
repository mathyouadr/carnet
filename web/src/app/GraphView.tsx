import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "./store";

type GNode = { id: string; title: string; icon: string; kind: string; parent_id: string | null; readonly: boolean };
type GLink = { source: string; target: string };
type Sim = { id: string; x: number; y: number; vx: number; vy: number; r: number; n: GNode; deg: number; fixed?: boolean };

const PALETTE = ["#5aa9e6", "#a78bfa", "#f87171", "#fb923c", "#facc15", "#4ade80", "#f472b6", "#2dd4bf", "#a3e635", "#94a3b8"];

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
    // colour = the ancestor at depth 1 (notes written in Carnet) or depth 2 (Markdown folders, to tell their sections apart)
    const depth = (id: string) => { let c = id, d = 0; while (nm.get(c)?.parent_id && d < 50) { c = nm.get(c)!.parent_id!; d++; } return d; };
    const root = (id: string): string => {
      const lim = nm.get(id)?.readonly ? 2 : 1; let c = id, d = depth(id);
      while (d > lim && nm.get(c)?.parent_id) { c = nm.get(c)!.parent_id!; d--; }
      return c;
    };
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
    const ctx = c.getContext("2d", { alpha: false })!;
    const { nodes, edges } = model;
    const view = { x: 0, y: 0, k: 1 };
    let w = 0, h = 0, dpr = 1, alpha = 1, raf = 0, dead = false, ready = false;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const fg = col("--cn-fg", "#ddd"), fg2 = col("--cn-fg-2", "#999"), bg = col("--cn-bg", "#191919");
    const dark = document.documentElement.dataset.theme !== "light";
    const byDeg = [...nodes].sort((a, b) => b.deg - a.deg);

    // glow sprites: one small radial gradient per colour, drawn with drawImage (far cheaper than per-frame gradients)
    const sprites = new Map<string, HTMLCanvasElement>();
    const sprite = (colr: string) => {
      let sp = sprites.get(colr); if (sp) return sp;
      sp = document.createElement("canvas"); sp.width = sp.height = 64;
      const g = sp.getContext("2d")!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, colr + "99"); gr.addColorStop(.35, colr + "33"); gr.addColorStop(1, colr + "00");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); sprites.set(colr, sp); return sp;
    };

    // on-demand rendering: frames only while the layout moves or the user interacts
    const schedule = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2); w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      if (ready) fit();
      schedule();
    };

    // layout: repulsion through a uniform grid (about O(n)), springs, soft gravity
    const CELL = 140;
    const tick = () => {
      const grid = new Map<number, Sim[]>();
      for (const s of nodes) { const k = Math.floor(s.x / CELL) * 100003 + Math.floor(s.y / CELL); (grid.get(k) || grid.set(k, []).get(k)!).push(s); }
      for (const a of nodes) {
        const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get((cx + ox) * 100003 + (cy + oy)); if (!cell) continue;
          for (const b of cell) {
            if (b === a) continue;
            let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
            const f = (2200 * alpha) / d2 / Math.sqrt(d2); a.vx += dx * f; a.vy += dy * f;
          }
        }
      }
      for (const e of edges) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - (e.tree ? 60 : 95)) * (e.tree ? .05 : .02) * alpha, fx = dx / d * f, fy = dy / d * f;
        e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
      }
      for (const s of nodes) {
        s.vx -= s.x * .0025 * alpha; s.vy -= s.y * .0025 * alpha;
        if (s.fixed) { s.vx = s.vy = 0; continue; }
        s.vx *= .55; s.vy *= .55; s.x += s.vx; s.y += s.vy;
      }
      alpha *= .975;
    };
    for (let i = 0; i < 300; i++) tick();
    alpha = 0;

    const fit = () => {
      if (!nodes.length) return;
      // fit the dense core, ignoring far outliers (5th-95th percentile), so the graph is not drawn tiny
      const xs = nodes.map((s) => s.x).sort((p, q) => p - q), ys = nodes.map((s) => s.y).sort((p, q) => p - q);
      const lo = Math.floor(nodes.length * .03), hi = Math.ceil(nodes.length * .97) - 1;
      const x0 = xs[lo], x1 = xs[hi], y0 = ys[lo], y1 = ys[hi];
      view.k = Math.min(2.2, .9 * Math.min(w / Math.max(60, x1 - x0), h / Math.max(60, y1 - y0)));
      view.x = -((x0 + x1) / 2) * view.k; view.y = -((y0 + y1) / 2) * view.k;
      schedule();
    };
    (c as any).__fit = fit;
    const sx = (x: number) => w / 2 + view.x + x * view.k, sy = (y: number) => h / 2 + view.y + y * view.k;
    const radius = (s: Sim) => s.r * Math.min(1.5, Math.max(.75, Math.sqrt(view.k)));
    const pick = (px: number, py: number) => {
      let best: Sim | null = null, bd = 1e9;
      for (const s of nodes) { const d = Math.hypot(sx(s.x) - px, sy(s.y) - py); if (d < Math.max(11, radius(s) + 5) && d < bd) { bd = d; best = s; } }
      return best;
    };

    const frame = () => {
      raf = 0; if (dead) return;
      const moving = alpha > .01; if (moving) tick();
      const S = st.current, hov = S.hover;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const near = new Set<Sim>();
      if (hov) { near.add(hov); for (const e of edges) { if (e.a === hov) near.add(e.b); else if (e.b === hov) near.add(e.a); } }
      const match = (s: Sim) => !S.q || (s.n.title || "").toLowerCase().includes(S.q);
      const dimmed = (s: Sim) => (hov && !near.has(s)) || (S.q && !match(s));

      // edges: one path per style (not one draw state per edge)
      const lines = new Map<string, number[]>(); const hot: number[] = [];
      for (const e of edges) {
        if (e.tree && !S.showTree) continue;
        const x1 = sx(e.a.x), y1 = sy(e.a.y), x2 = sx(e.b.x), y2 = sy(e.b.y);
        if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > w && x2 > w) || (y1 > h && y2 > h)) continue;
        if (hov && (e.a === hov || e.b === hov)) { hot.push(x1, y1, x2, y2); continue; }
        const key = e.tree ? "tree" : model.color(e.a.id);
        (lines.get(key) || lines.set(key, []).get(key)!).push(x1, y1, x2, y2);
      }
      const stroke = (arr: number[], style: string, a: number, lw: number) => {
        ctx.globalAlpha = a; ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath();
        for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(arr[i], arr[i + 1]); ctx.lineTo(arr[i + 2], arr[i + 3]); }
        ctx.stroke();
      };
      const base = hov || S.q ? .06 : 1;
      lines.forEach((arr, key) => key === "tree" ? stroke(arr, fg2, .16 * base, 1) : stroke(arr, key, (dark ? .2 : .35) * base, 1));
      if (hot.length) stroke(hot, fg, .9, 1.6);

      // nodes
      for (const s of nodes) {
        const x = sx(s.x), y = sy(s.y), r = radius(s);
        if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
        const colr = model.color(s.id), dim = dimmed(s);
        ctx.globalAlpha = dim ? .18 : 1;
        if (!dim && s.deg > 5 && view.k > .35) { const g = r * 3; ctx.globalAlpha = .7; ctx.drawImage(sprite(colr), x - g, y - g, g * 2, g * 2); ctx.globalAlpha = 1; }
        ctx.fillStyle = colr; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        if (s.id === app.pageId || s === hov) { ctx.globalAlpha = 1; ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 6.2832); ctx.stroke(); }
      }

      // labels: the biggest pages first, never overlapping; more of them as you zoom in
      ctx.font = "12px system-ui, -apple-system, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      const boxes: number[][] = []; let shown = 0;
      const maxLabels = Math.floor(6 + 14 * view.k * view.k);
      const label = (s: Sim, force: boolean) => {
        const x = sx(s.x), y = sy(s.y) + radius(s) + 3;
        if (x < 0 || y < 0 || x > w || y > h) return;
        const txt = `${s.n.icon ? s.n.icon + " " : ""}${s.n.title || t("Untitled")}`.slice(0, 32), tw = ctx.measureText(txt).width;
        const bx = x - tw / 2 - 2, bw = tw + 4;
        if (!force) for (const b of boxes) if (bx < b[0] + b[2] && bx + bw > b[0] && y < b[1] + b[3] && y + 14 > b[1]) return;
        boxes.push([bx, y, bw, 14]); shown++;
        ctx.globalAlpha = .72; ctx.fillStyle = bg; ctx.fillRect(bx, y - 1, bw, 15);
        ctx.globalAlpha = 1; ctx.fillStyle = s === hov ? fg : dark ? "#d4d4d8" : fg; ctx.fillText(txt, x, y);
      };
      if (hov) label(hov, true);
      if (S.q) { for (const s of nodes) if (match(s) && shown < 40) label(s, false); }
      else for (const s of byDeg) { if (shown >= maxLabels) break; if (s !== hov && !dimmed(s)) label(s, false); }
      ctx.globalAlpha = 1;
      if (moving) schedule();
    };

    // pointers: one = drag node or pan, two = pinch; wheel = zoom
    const pts = new Map<number, { x: number; y: number }>();
    let drag: Sim | null = null, moved = 0, pinch = 0, lastHover: Sim | null = null;
    const rel = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId); const p = rel(e); pts.set(e.pointerId, p); moved = 0;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; return; }
      drag = pick(p.x, p.y); if (drag) { drag.fixed = true; alpha = Math.max(alpha, .25); schedule(); }
    };
    const move = (e: PointerEvent) => {
      const p = rel(e), prev = pts.get(e.pointerId);
      if (!prev) {
        const hv = pick(p.x, p.y); st.current.hover = hv; c.style.cursor = hv ? "pointer" : "grab";
        if (hv !== lastHover) { lastHover = hv; schedule(); } return;
      }
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y); pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) view.k = Math.min(6, Math.max(.15, view.k * d / pinch)); pinch = d; schedule(); return;
      }
      if (drag) { drag.x = (p.x - w / 2 - view.x) / view.k; drag.y = (p.y - h / 2 - view.y) / view.k; alpha = Math.max(alpha, .25); }
      else { view.x += p.x - prev.x; view.y += p.y - prev.y; }
      schedule();
    };
    const up = (e: PointerEvent) => {
      const p = rel(e); pts.delete(e.pointerId); pinch = 0;
      if (drag) { drag.fixed = false; if (moved < 6) { app.navigate(drag.id); onClose(); } drag = null; }
      else if (moved < 6 && pts.size === 0) { const s = pick(p.x, p.y); if (s) { app.navigate(s.id); onClose(); } }
      if (e.pointerType !== "mouse") { st.current.hover = null; lastHover = null; schedule(); }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const b = c.getBoundingClientRect(), p = { x: e.clientX - b.left, y: e.clientY - b.top };
      const k0 = view.k, k1 = Math.min(6, Math.max(.15, k0 * Math.exp(-e.deltaY * .0015)));
      const wx = (p.x - w / 2 - view.x) / k0, wy = (p.y - h / 2 - view.y) / k0;
      view.k = k1; view.x = p.x - w / 2 - wx * k1; view.y = p.y - h / 2 - wy * k1; schedule();
    };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    const redraw = () => schedule();
    (c as any).__redraw = redraw;
    const ro = new ResizeObserver(resize); ro.observe(c);
    resize(); fit(); ready = true;
    return () => {
      dead = true; cancelAnimationFrame(raf); ro.disconnect();
      c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    };
  }, [model]);  // eslint-disable-line

  // search / hierarchy toggles only change what is drawn: repaint, no relayout
  useEffect(() => { (cv.current as any)?.__redraw?.(); }, [q, showTree]);

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
