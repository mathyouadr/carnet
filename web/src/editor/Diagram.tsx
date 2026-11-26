import { useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "../i18n";
import { useTheme } from "../app/theme";
import { Popover } from "../ui/Popover";

// Mermaid is large: loaded the first time a page shows a diagram.
let mermaidP: Promise<any> | null = null;
let mermaidTheme = "";
let seq = 0;

type Drawn = { svg: string; error: string };
const cache = new Map<string, Drawn>();
let queue: Promise<unknown> = Promise.resolve();

async function renderNow(code: string, dark: boolean): Promise<Drawn> {
  mermaidP ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidP;
  const theme = dark ? "dark" : "default";
  if (mermaidTheme !== theme) {
    // "strict": labels are sanitised and click handlers disabled, a note cannot run script.
    // Limits keep a huge or hostile diagram from freezing the page.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, suppressErrorRendering: true, maxTextSize: 20000, maxEdges: 200 });
    mermaidTheme = theme;
  }
  const id = `cn-mmd-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return { svg, error: "" };
  } catch (e: any) {
    document.getElementById(`d${id}`)?.remove();
    // mermaid: "Parse error on line 5:", the source line, a caret, then "Expecting …, got …": keep the first and the last
    const lines = String(e?.message || e).split("\n").map((l) => l.trim()).filter(Boolean);
    return { svg: "", error: (lines.length > 1 ? `${lines[0]} ${lines[lines.length - 1]}` : lines[0] || "?").slice(0, 220) };
  }
}

/** Draws Mermaid source to an SVG string. Renders run one at a time (a page of 30 diagrams stays responsive) and are cached. */
export function drawMermaid(code: string, dark: boolean): Promise<Drawn> {
  const key = (dark ? "d" : "l") + code;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    await new Promise((r) => setTimeout(r, 0));     // let the browser paint and handle input between two diagrams
    const r = await renderNow(code, dark);
    cache.set(key, r);
    if (cache.size > 150) cache.delete(cache.keys().next().value as string);
    return r;
  });
  queue = job.catch(() => {});
  return job;
}

export const SAMPLE = `flowchart TD
  A[Scan nmap] --> B{Port ouvert ?}
  B -- 80/443 --> C[Énumérer le web]
  B -- 22 --> D[Tester les identifiants]
  B -- Non --> E[Autre machine]`;

/** True once the element has been near the viewport (diagrams far down the page are not drawn until needed). */
function useSeen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    // the page scrolls inside its own container, which clips the margin of a viewport-rooted observer
    let root: HTMLElement | null = el.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { root, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, ref]);
  return seen;
}

function useDrawing(code: string, enabled = true) {
  const dark = useTheme() === "dark";
  const [out, setOut] = useState<Drawn | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!code.trim()) { setOut(null); return; }
    let live = true;
    const id = setTimeout(() => { drawMermaid(code, dark).then((r) => live && setOut(r)); }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [code, dark, enabled]);
  return out;
}

function Drawing({ code, enabled }: { code: string; enabled: boolean }) {
  const out = useDrawing(code, enabled);
  if (!out) return code.trim() ? <span className="cn-muted">…</span> : null;
  if (out.error) return <span className="cn-err">{out.error}</span>;
  return <div className="cn-diagram-svg" dangerouslySetInnerHTML={{ __html: out.svg }} />;
}

function DiagramEditor({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const out = useDrawing(v);
  return (
    <div className="cn-diagram-edit" onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <textarea ref={ref} value={v} rows={Math.min(14, Math.max(5, v.split("\n").length + 1))} spellCheck={false}
        placeholder={t("Mermaid source")}
        onChange={(e) => { setV(e.target.value); onChange(e.target.value); }}
        onKeyDown={(e) => { if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || e.key === "Escape") { e.preventDefault(); onDone(); } }} />
      <div className="cn-diagram-edit-foot">
        {out?.error ? <span className="cn-err">{out.error}</span> : <span className="cn-muted">Ctrl+Entrée</span>}
        <button type="button" className="cn-btn sm" onClick={() => { setV(SAMPLE); onChange(SAMPLE); }}>{t("Example")}</button>
        <button type="button" className="cn-btn primary sm" onClick={onDone}>{t("OK")}</button>
      </div>
    </div>
  );
}

export const DiagramBlock = createReactBlockSpec(
  { type: "diagram", propSchema: { code: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [editing, setEditing] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const code = block.props.code as string;
      const box = useRef<HTMLDivElement>(null);
      const seen = useSeen(box);
      const open = (e: React.MouseEvent) => {
        if (!editor.isEditable) return;
        setAnchor(e.currentTarget as HTMLElement);
        setEditing(true);
      };
      return (
        <div ref={box} className={`cn-diagram ${editing ? "editing" : ""}`} onClick={open} contentEditable={false}>
          {code.trim() ? <Drawing code={code} enabled={seen} />
            : <span className="cn-muted">⎇ {t("Empty diagram")} — {t("Click to edit")}</span>}
          {editing && anchor && (
            <Popover anchor={anchor} onClose={() => setEditing(false)} width={480}>
              <DiagramEditor value={code} onChange={(v) => editor.updateBlock(block, { props: { code: v } as any })}
                onDone={() => setEditing(false)} />
            </Popover>
          )}
        </div>
      );
    },
    // copied out of Carnet (other apps, text export): the Mermaid source as a code block
    toExternalHTML: ({ block }) => <pre><code>{block.props.code as string}</code></pre>,
  },
);
