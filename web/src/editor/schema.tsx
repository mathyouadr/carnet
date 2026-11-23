import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultProps } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import { createCodeBlockSpec } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import katex from "katex";
import { useApp } from "../app/store";
import { t } from "../i18n";
import { fileUrl } from "../api";
import { Popover } from "../ui/Popover";
import { EmojiPicker } from "../ui/Pickers";
import { DatabaseView } from "../db/DatabaseView";
import { FileText, ArrowUpRight, Table2 } from "lucide-react";

export function renderTex(latex: string, display: boolean): { html: string; error: string } {
  try {
    return { html: katex.renderToString(latex || "", { displayMode: display, throwOnError: true, strict: "ignore", trust: false, output: "html" }), error: "" };
  } catch (e: any) {
    return { html: "", error: String(e?.message || e).replace(/^KaTeX parse error: /, "") };
  }
}

// ------------------------------------------------------------------ math (block)
function MathEditor({ value, onChange, onDone, display }: { value: string; onChange: (v: string) => void; onDone: () => void; display: boolean }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const r = renderTex(v, display);
  return (
    <div className="cn-math-edit" onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <textarea ref={ref} value={v} rows={Math.min(8, Math.max(2, v.split("\n").length))} spellCheck={false}
        placeholder={t("Type a LaTeX formula") + "  e.g. \\frac{a}{b}"}
        onChange={(e) => { setV(e.target.value); onChange(e.target.value); }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || e.key === "Escape") { e.preventDefault(); onDone(); }
        }} />
      <div className="cn-math-edit-foot">
        {r.error ? <span className="cn-err">{r.error}</span> : <span className="cn-muted">Ctrl+Entrée</span>}
        <button type="button" className="cn-btn primary sm" onClick={onDone}>{t("OK")}</button>
      </div>
    </div>
  );
}

export const MathBlock = createReactBlockSpec(
  { type: "math", propSchema: { latex: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [editing, setEditing] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const latex = block.props.latex as string;
      const out = useMemo(() => renderTex(latex, true), [latex]);
      const open = (e: React.MouseEvent) => {
        if (!editor.isEditable) return;
        setAnchor(e.currentTarget as HTMLElement);
        setEditing(true);
      };
      return (
        <div className={`cn-math ${editing ? "editing" : ""}`} onClick={open} contentEditable={false}>
          {latex ? (out.error ? <span className="cn-err">{out.error}</span> : <span dangerouslySetInnerHTML={{ __html: out.html }} />)
            : <span className="cn-muted">∑ {t("Empty formula")} — {t("Click to edit")}</span>}
          {editing && anchor && (
            <Popover anchor={anchor} onClose={() => setEditing(false)} width={420}>
              <MathEditor value={latex} display onChange={(v) => editor.updateBlock(block, { props: { latex: v } as any })}
                onDone={() => setEditing(false)} />
            </Popover>
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => <div dangerouslySetInnerHTML={{ __html: renderTex(block.props.latex as string, true).html }} />,
  },
);

// ------------------------------------------------------------------ math (inline)
export const InlineMath = createReactInlineContentSpec(
  { type: "inlineMath", propSchema: { latex: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent, updateInlineContent, editor }) => {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const latex = inlineContent.props.latex as string;
      const out = renderTex(latex, false);
      return (
        <span className="cn-imath" onClick={(e) => { if (editor.isEditable) setAnchor(e.currentTarget); }}>
          {latex && !out.error ? <span dangerouslySetInnerHTML={{ __html: out.html }} /> : <span className="cn-muted">{latex || "∑"}</span>}
          {anchor && (
            <Popover anchor={anchor} onClose={() => setAnchor(null)} width={360}>
              <MathEditor value={latex} display={false}
                onChange={(v) => updateInlineContent({ type: "inlineMath", props: { latex: v } } as any)}
                onDone={() => setAnchor(null)} />
            </Popover>
          )}
        </span>
      );
    },
  },
);

// ------------------------------------------------------------------ callout
export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { textAlignment: defaultProps.textAlignment, textColor: defaultProps.textColor, emoji: { default: "💡" }, color: { default: "gray" } },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <div className={`cn-callout bg-${block.props.color}`}>
          <button type="button" className="cn-callout-emoji" contentEditable={false}
            onClick={(e) => { if (editor.isEditable) setAnchor(e.currentTarget); }}>{block.props.emoji}</button>
          <div className="inline-content cn-callout-text" ref={contentRef} />
          {anchor && (
            <Popover anchor={anchor} onClose={() => setAnchor(null)} width={360}>
              <div className="cn-callout-colors">
                {["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red", "default"].map((c) => (
                  <button key={c} type="button" className={`bg-${c} ${block.props.color === c ? "on" : ""}`} title={c}
                    onClick={() => editor.updateBlock(block, { props: { color: c } as any })} />
                ))}
              </div>
              <EmojiPicker onPick={(em) => { editor.updateBlock(block, { props: { emoji: em } as any }); setAnchor(null); }} />
            </Popover>
          )}
        </div>
      );
    },
  },
);

// ------------------------------------------------------------------ sub-page / page link
export const PageLinkBlock = createReactBlockSpec(
  { type: "pageLink", propSchema: { pageId: { default: "" } }, content: "none" },
  {
    render: ({ block }) => {
      const { byId, navigate } = useApp();
      const p = byId.get(block.props.pageId as string);
      return (
        <div className="cn-pagelink" contentEditable={false} onClick={() => p && navigate(p.id)} role="link">
          <span className="ic">{p?.icon || (p?.kind === "database" ? <Table2 size={18} /> : <FileText size={18} />)}</span>
          <span className={`tx ${p ? "" : "gone"}`}>{p ? p.title || t("Untitled") : t("Page not found")}</span>
          <ArrowUpRight size={14} className="arrow" />
        </div>
      );
    },
  },
);

// ------------------------------------------------------------------ inline database
export const DatabaseBlock = createReactBlockSpec(
  { type: "database", propSchema: { pageId: { default: "" }, viewId: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => (
      <div className="cn-dbblock" contentEditable={false}
        onKeyDown={(e) => e.stopPropagation()} onPaste={(e) => e.stopPropagation()} onCopy={(e) => e.stopPropagation()}
        onCut={(e) => e.stopPropagation()} onDrop={(e) => { if (!(e.dataTransfer.types || []).includes("blocknote/html")) e.stopPropagation(); }}>
        <DatabaseView dbId={block.props.pageId as string} lockView={(block.props.viewId as string) || undefined} inline readOnly={!editor.isEditable} />
      </div>
    ),
  },
);

// ------------------------------------------------------------------ embed
export function embedUrl(url: string): string {
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  m = url.match(/loom\.com\/share\/(\w+)/);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  if (/google\.[a-z.]+\/maps/.test(url) && !url.includes("output=embed")) return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
  if (/figma\.com\//.test(url)) return `https://www.figma.com/embed?embed_host=carnet&url=${encodeURIComponent(url)}`;
  if (/docs\.google\.com\//.test(url)) return url.replace(/\/edit.*$/, "/preview");
  return fileUrl(url);
}

export const EmbedBlock = createReactBlockSpec(
  { type: "embed", propSchema: { url: { default: "" }, height: { default: 420 } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const [v, setV] = useState("");
      const url = block.props.url as string;
      if (!url) {
        if (!editor.isEditable) return <div />;
        return (
          <form className="cn-embed-empty" contentEditable={false} onKeyDown={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (/^https?:\/\/|^\/files\//.test(v.trim())) editor.updateBlock(block, { props: { url: v.trim() } as any }); }}>
            <input className="cn-input" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("Paste a link (YouTube, Google Maps, PDF, any page…)")} />
            <button className="cn-btn primary sm">{t("Embed")}</button>
          </form>
        );
      }
      return (
        <div className="cn-embed" contentEditable={false}>
          <iframe src={embedUrl(url)} style={{ height: Number(block.props.height) || 420 }} loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            allow="fullscreen; picture-in-picture; clipboard-write" referrerPolicy="no-referrer" title={url} />
          <a href={url} target="_blank" rel="noreferrer" className="cn-embed-url">{url}</a>
        </div>
      );
    },
  },
);

// ------------------------------------------------------------------ table of contents
export const TocBlock = createReactBlockSpec(
  { type: "toc", propSchema: {}, content: "none" },
  {
    render: ({ editor }) => {
      const [heads, setHeads] = useState<{ id: string; level: number; text: string }[]>([]);
      useEffect(() => {
        const read = () => {
          const out: { id: string; level: number; text: string }[] = [];
          const walk = (bs: any[]) => bs.forEach((b) => {
            if (b.type === "heading") out.push({ id: b.id, level: b.props.level, text: (b.content || []).map((c: any) => c.text || c.props?.title || "").join("") });
            if (b.type === "columnList" || b.type === "column" || b.type === "toggleListItem") walk(b.children || []);
          });
          walk(editor.document as any[]);
          setHeads(out);
        };
        read();
        return editor.onChange(read);
      }, [editor]);
      return (
        <nav className="cn-toc" contentEditable={false}>
          {heads.length === 0 && <span className="cn-muted">{t("Add a table of contents: headings will appear here.")}</span>}
          {heads.map((h) => (
            <a key={h.id} className={`l${h.level}`} onClick={(e) => {
              e.preventDefault();
              document.querySelector(`[data-id="${h.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>{h.text || t("Untitled")}</a>
          ))}
        </nav>
      );
    },
  },
);

// ------------------------------------------------------------------ @ page mention
export const PageMention = createReactInlineContentSpec(
  { type: "pageMention", propSchema: { pageId: { default: "" }, title: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent }) => {
      const { byId, navigate } = useApp();
      const p = byId.get(inlineContent.props.pageId as string);
      return (
        <a className={`cn-mention ${p ? "" : "gone"}`} href={p ? `p/${p.id}` : undefined}
          onClick={(e) => { e.preventDefault(); if (p) navigate(p.id); }}>
          <span className="ic">{p?.icon || <FileText size={13} />}</span>
          <span className="tx">{p ? p.title || t("Untitled") : inlineContent.props.title || t("Page not found")}</span>
        </a>
      );
    },
  },
);

const { codeBlock: _plainCode, ...baseBlocks } = defaultBlockSpecs as any;

export const schema = withMultiColumn(BlockNoteSchema.create({
  blockSpecs: {
    ...baseBlocks,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    callout: CalloutBlock(),
    math: MathBlock(),
    pageLink: PageLinkBlock(),
    database: DatabaseBlock(),
    embed: EmbedBlock(),
    toc: TocBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    pageMention: PageMention,
    inlineMath: InlineMath,
  },
}));

export type CarnetEditor = any;
