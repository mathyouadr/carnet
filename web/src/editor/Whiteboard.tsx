import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "../i18n";
import { useTheme } from "../app/theme";

const Editor = lazy(() => import("./WhiteboardEditor"));

/** Preview: the scene exported to SVG (library loaded on demand). */
function Preview({ data }: { data: string }) {
  const dark = useTheme() === "dark";
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("./WhiteboardEditor").then((m) => m.sceneSvg(data, dark)).then((s) => live && setSvg(s)).catch(() => live && setSvg(""));
    return () => { live = false; };
  }, [data, dark]);
  if (svg === null) return <span className="cn-muted">…</span>;
  return svg ? <div className="cn-wb-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="cn-muted">✎ {t("Empty whiteboard")}</span>;
}

function Overlay({ data, readOnly, onSave, onClose }: { data: string; readOnly: boolean; onSave: (json: string) => void; onClose: () => void }) {
  const dark = useTheme() === "dark";
  const latest = useRef(data);
  const timer = useRef<any>(null);
  const saved = useRef(data);
  const save = (json: string) => { saved.current = json; try { onSave(json); } catch { /* the block is already gone */ } };
  const flush = () => { clearTimeout(timer.current); if (latest.current !== saved.current) save(latest.current); };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);      // leaving the page with a drawing not yet saved
  useEffect(() => { document.documentElement.classList.add("cn-wb-open"); return () => document.documentElement.classList.remove("cn-wb-open"); }, []);
  const popped = useRef(false);
  // Phones: the back gesture closes the whiteboard (and saves it) instead of leaving the page.
  useEffect(() => {
    history.pushState(history.state, "", location.href);
    const onPop = () => { popped.current = true; flushRef.current(); onClose(); };
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); };
  }, []);
  const close = () => { flush(); onClose(); if (!popped.current) { popped.current = true; history.back(); } };
  return createPortal(
    <div className="cn-wb-full" onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="cn-wb-bar">
        <span>{readOnly ? t("Whiteboard") : t("Whiteboard · saved automatically")}</span>
        <button type="button" className="cn-btn primary sm" onClick={close}>{readOnly ? t("Close") : t("Done")}</button>
      </div>
      <div className="cn-wb-canvas">
        <Suspense fallback={<div className="cn-muted pad">…</div>}>
          <Editor data={data} dark={dark} readOnly={readOnly}
            onChange={(json) => { latest.current = json; clearTimeout(timer.current); timer.current = setTimeout(() => save(json), 300); }} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}

export const WhiteboardBlock = createReactBlockSpec(
  { type: "whiteboard", propSchema: { data: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [open, setOpen] = useState(false);
      const data = block.props.data as string;
      const editable = editor.isEditable;
      return (
        <div className="cn-wb" contentEditable={false} onClick={() => setOpen(true)}>
          {data ? <Preview data={data} />
            : <span className="cn-muted">✎ {editable ? t("Empty whiteboard") + " — " + t("Click to draw") : t("Empty whiteboard")}</span>}
          {open && (editable || data) && (
            <Overlay data={data} readOnly={!editable}
              onSave={(json) => editor.updateBlock(block, { props: { data: json } as any })}
              onClose={() => setOpen(false)} />
          )}
        </div>
      );
    },
    toExternalHTML: () => <p>✎ {t("Whiteboard")}</p>,
  },
);
