import { useEffect, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Code, Baseline, Highlighter, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, List, ListOrdered, ListChecks, Link2, Image as ImageIcon, Table, SquareFunction,
  Sigma, IndentIncrease, IndentDecrease, RemoveFormatting, ChevronDown, Plus, Quote, Minus, MessageSquareQuote,
  ListCollapse, ListTree, AppWindow, Columns2, FileCode2, Paperclip, Video, Sparkles, MessageCircle, SpellCheck,
  Workflow, PenTool,
} from "lucide-react";
import { Popover, MenuItem, MenuSep, COLORS } from "../ui/Popover";
import { useApp } from "../app/store";
import { t } from "../i18n";

const COLOR_NAMES: Record<string, string> = {
  default: "Default", gray: "Gray", brown: "Brown", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue",
  purple: "Purple", pink: "Pink", red: "Red",
};

export type Kind = { key: string; label: string; type: string; props?: any; icon: ReactNode };
export const KINDS: Kind[] = [
  { key: "p", label: "Text", type: "paragraph", icon: <span className="cn-tb-glyph">T</span> },
  { key: "h1", label: "Heading 1", type: "heading", props: { level: 1 }, icon: <span className="cn-tb-glyph">H1</span> },
  { key: "h2", label: "Heading 2", type: "heading", props: { level: 2 }, icon: <span className="cn-tb-glyph">H2</span> },
  { key: "h3", label: "Heading 3", type: "heading", props: { level: 3 }, icon: <span className="cn-tb-glyph">H3</span> },
  { key: "ul", label: "Bulleted list", type: "bulletListItem", icon: <List size={16} /> },
  { key: "ol", label: "Numbered list", type: "numberedListItem", icon: <ListOrdered size={16} /> },
  { key: "todo", label: "To-do list", type: "checkListItem", icon: <ListChecks size={16} /> },
  { key: "toggle", label: "Toggle list", type: "toggleListItem", icon: <ListCollapse size={16} /> },
  { key: "quote", label: "Quote", type: "quote", icon: <Quote size={16} /> },
  { key: "callout", label: "Callout", type: "callout", icon: <MessageSquareQuote size={16} /> },
  { key: "code", label: "Code block", type: "codeBlock", icon: <FileCode2 size={16} /> },
];

export function kindOf(block: any): Kind {
  if (!block) return KINDS[0];
  if (block.type === "heading") return KINDS.find((k) => k.props?.level === block.props.level) || KINDS[1];
  const OTHER: Record<string, string> = { database: "Database", pageLink: "Page", image: "Image", file: "File", video: "Video",
    audio: "Audio", table: "Table", math: "Equation", diagram: "Diagram", whiteboard: "Whiteboard", embed: "Embed", divider: "Divider", column: "Columns", columnList: "Columns" };
  return KINDS.find((k) => k.type === block.type) || { key: block.type, label: OTHER[block.type] || "Block", type: block.type, icon: null };
}

/** Keyboard height on phones (the visual viewport shrinks when the keyboard opens). */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    on();
    return () => { vv.removeEventListener("resize", on); vv.removeEventListener("scroll", on); };
  }, []);
  return inset;
}

export function DocsToolbar({ editor, pageId, slot, onAI, onChat, onSpell }: { editor: any; pageId: string; slot?: string; onAI?: () => void; onChat?: () => void; onSpell?: () => void }) {
  const app = useApp();
  const [, force] = useReducer((x) => x + 1, 0);
  useEditorSelectionChange(force, editor);
  useEditorChange(force, editor);
  const [pop, setPop] = useState<{ k: string; el: HTMLElement } | null>(null);
  const [link, setLink] = useState("");
  const kb = useKeyboardInset();
  const open = (k: string) => (e: React.MouseEvent) => setPop(pop?.k === k ? null : { k, el: e.currentTarget as HTMLElement });
  const close = () => setPop(null);

  let block: any = null, styles: any = {};
  try {
    block = editor.getTextCursorPosition().block;
    styles = editor.getActiveStyles();
  } catch { /* not focused yet */ }
  const selected = (): any[] => {
    try { return editor.getSelection()?.blocks || [editor.getTextCursorPosition().block]; } catch { return []; }
  };
  const kind = kindOf(block);
  const align = block?.props?.textAlignment || "left";

  const setKind = (k: Kind) => {
    for (const b of selected()) {
      if (b.content === undefined && b.type !== k.type) continue;            // images, tables... keep their type
      editor.updateBlock(b, { type: k.type, props: k.props || {} });
    }
    close();
    editor.focus();
  };
  const toggle = (s: string) => { editor.toggleStyles({ [s]: true }); editor.focus(); };
  const color = (key: "textColor" | "backgroundColor", c: string) => {
    if (c === "default") editor.removeStyles({ [key]: styles[key] || "default" });
    else editor.addStyles({ [key]: c });
    close();
    editor.focus();
  };
  const setAlign = (a: string) => {
    for (const b of selected()) if (b.props && "textAlignment" in b.props) editor.updateBlock(b, { props: { textAlignment: a } });
    close();
    editor.focus();
  };
  const insert = (blk: any) => {
    const cur = editor.getTextCursorPosition().block;
    const empty = cur && Array.isArray(cur.content) && cur.content.length === 0 && cur.type === "paragraph";
    const res = empty ? editor.replaceBlocks([cur], [blk]) : editor.insertBlocks([blk], cur, "after");
    const inserted = res?.insertedBlocks?.[0] || res?.[0];
    try { if (inserted && blk.content !== undefined) editor.setTextCursorPosition(inserted, "end"); } catch { /* atom */ }
    close();
  };
  const tableBlock = () => ({
    type: "table",
    content: { type: "tableContent", rows: [0, 1, 2].map(() => ({ cells: ["", "", ""] })) },
  });

  const B = ({ on, title, onClick, children, k }: { on?: boolean; title: string; onClick: (e: React.MouseEvent) => void; children: ReactNode; k?: string }) => (
    <button type="button" className={`cn-tb-btn ${on ? "on" : ""} ${pop?.k === k && k ? "open" : ""}`} title={t(title)} aria-label={t(title)}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  );
  const docked = app.mobile;
  const style = docked ? { bottom: kb > 80 ? kb : undefined } : undefined;
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlotEl(slot && !docked ? document.getElementById(slot) : null); }, [slot, docked]);

  const bar = (
    <div className={`cn-toolbar ${docked ? "docked" : ""} ${docked && kb > 80 ? "kb" : ""}`} style={style} onMouseDown={(e) => {
      if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
    }}>
      <div className="cn-tb-scroll">
        <B title="Undo" onClick={() => editor.undo()}><Undo2 size={16} /></B>
        <B title="Redo" onClick={() => editor.redo()}><Redo2 size={16} /></B>
        {onAI && <B title={t("Ask AI")} onClick={onAI}><Sparkles size={16} className="cn-ai-spark" /></B>}
        {onChat && <B title="Chat" onClick={onChat}><MessageCircle size={16} className="cn-ai-spark" /></B>}
        {onSpell && <B title="Check spelling and grammar" onClick={onSpell}><SpellCheck size={16} /></B>}
        <span className="cn-tb-sep" />
        <button type="button" className={`cn-tb-select ${pop?.k === "kind" ? "open" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={open("kind")}>
          <span>{t(kind.label)}</span><ChevronDown size={14} />
        </button>
        <span className="cn-tb-sep" />
        <B title="Bold" on={!!styles.bold} onClick={() => toggle("bold")}><Bold size={16} /></B>
        <B title="Italic" on={!!styles.italic} onClick={() => toggle("italic")}><Italic size={16} /></B>
        <B title="Underline" on={!!styles.underline} onClick={() => toggle("underline")}><Underline size={16} /></B>
        <B title="Strikethrough" on={!!styles.strike} onClick={() => toggle("strike")}><Strikethrough size={16} /></B>
        <B title="Inline code" on={!!styles.code} onClick={() => toggle("code")}><Code size={16} /></B>
        <B title="Text color" k="color" onClick={open("color")}>
          <span className="cn-tb-color"><Baseline size={16} /><i className={`fg-${styles.textColor || "default"}`} /></span>
        </B>
        <B title="Highlight" k="bg" onClick={open("bg")}>
          <span className="cn-tb-color"><Highlighter size={16} /><i className={`bgbar-${styles.backgroundColor || "default"}`} /></span>
        </B>
        <B title="Insert link" k="link" onClick={(e) => { setLink(editor.getSelectedLinkUrl?.() || ""); open("link")(e); }}><Link2 size={16} /></B>
        <span className="cn-tb-sep" />
        <B title="Align left" on={align === "left"} onClick={() => setAlign("left")}><AlignLeft size={16} /></B>
        <B title="Center" on={align === "center"} onClick={() => setAlign("center")}><AlignCenter size={16} /></B>
        <B title="Align right" on={align === "right"} onClick={() => setAlign("right")}><AlignRight size={16} /></B>
        <B title="Justify" on={align === "justify"} onClick={() => setAlign("justify")}><AlignJustify size={16} /></B>
        <span className="cn-tb-sep" />
        <B title="Bulleted list" on={kind.key === "ul"} onClick={() => setKind(kind.key === "ul" ? KINDS[0] : KINDS[4])}><List size={16} /></B>
        <B title="Numbered list" on={kind.key === "ol"} onClick={() => setKind(kind.key === "ol" ? KINDS[0] : KINDS[5])}><ListOrdered size={16} /></B>
        <B title="To-do list" on={kind.key === "todo"} onClick={() => setKind(kind.key === "todo" ? KINDS[0] : KINDS[6])}><ListChecks size={16} /></B>
        <B title="Outdent" onClick={() => { if (editor.canUnnestBlock()) editor.unnestBlock(); }}><IndentDecrease size={16} /></B>
        <B title="Indent" onClick={() => { if (editor.canNestBlock()) editor.nestBlock(); }}><IndentIncrease size={16} /></B>
        <span className="cn-tb-sep" />
        <B title="Image" onClick={() => insert({ type: "image" })}><ImageIcon size={16} /></B>
        <B title="Table" onClick={() => insert(tableBlock())}><Table size={16} /></B>
        <B title="Formula" onClick={() => insert({ type: "math" })}><SquareFunction size={16} /></B>
        <button type="button" className={`cn-tb-select ${pop?.k === "insert" ? "open" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={open("insert")}>
          <Plus size={15} /><span>{t("Insert")}</span><ChevronDown size={14} />
        </button>
        <B title="Clear formatting" onClick={() => {
          const s = editor.getActiveStyles();
          if (Object.keys(s).length) editor.removeStyles(s);
          editor.focus();
        }}><RemoveFormatting size={16} /></B>
      </div>

      {pop?.k === "kind" && (
        <Popover anchor={pop.el} onClose={close} width={220}>
          {KINDS.map((k) => <MenuItem key={k.key} icon={k.icon} active={k.key === kind.key} onClick={() => setKind(k)}>{t(k.label)}</MenuItem>)}
        </Popover>
      )}
      {(pop?.k === "color" || pop?.k === "bg") && (
        <Popover anchor={pop.el} onClose={close} width={200}>
          {COLORS.map((c) => (
            <MenuItem key={c} active={(pop.k === "color" ? styles.textColor : styles.backgroundColor) === c}
              icon={<span className={`cn-swatch ${pop.k === "color" ? "fg-" + c : "bg-" + c}`}>A</span>}
              onClick={() => color(pop.k === "color" ? "textColor" : "backgroundColor", c)}>{t(COLOR_NAMES[c])}</MenuItem>
          ))}
        </Popover>
      )}
      {pop?.k === "link" && (
        <Popover anchor={pop.el} onClose={close} width={320}>
          <form className="row pad" onSubmit={(e) => {
            e.preventDefault();
            let url = link.trim();
            if (url && !/^(https?:|mailto:|tel:|\/|#)/i.test(url)) url = /^[a-z][a-z0-9+.-]*:/i.test(url) ? "" : "https://" + url;
            if (url) editor.createLink(url);
            close();
            editor.focus();
          }}>
            <input className="cn-input" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("Link URL")} />
            <button className="cn-btn primary sm">{t("OK")}</button>
          </form>
        </Popover>
      )}
      {pop?.k === "insert" && (
        <Popover anchor={pop.el} onClose={close} width={240}>
          <MenuItem icon={<ImageIcon size={16} />} onClick={() => insert({ type: "image" })}>{t("Image")}</MenuItem>
          <MenuItem icon={<Paperclip size={16} />} onClick={() => insert({ type: "file" })}>{t("File")}</MenuItem>
          <MenuItem icon={<Video size={16} />} onClick={() => insert({ type: "video" })}>{t("Video")}</MenuItem>
          <MenuItem icon={<AppWindow size={16} />} onClick={() => insert({ type: "embed" })}>{t("Embed")}</MenuItem>
          <MenuSep />
          <MenuItem icon={<Table size={16} />} onClick={() => insert(tableBlock())}>{t("Table")}</MenuItem>
          <MenuItem icon={<SquareFunction size={16} />} onClick={() => insert({ type: "math" })}>{t("Formula")}</MenuItem>
          <MenuItem icon={<Sigma size={16} />} onClick={() => { editor.insertInlineContent([{ type: "inlineMath", props: { latex: "x^2" } }, " "]); close(); }}>{t("Inline formula")}</MenuItem>
          <MenuItem icon={<FileCode2 size={16} />} onClick={() => insert({ type: "codeBlock" })}>{t("Code block")}</MenuItem>
          <MenuItem icon={<MessageSquareQuote size={16} />} onClick={() => insert({ type: "callout", content: [] })}>{t("Callout")}</MenuItem>
          <MenuItem icon={<Quote size={16} />} onClick={() => insert({ type: "quote", content: [] })}>{t("Quote")}</MenuItem>
          <MenuItem icon={<ListCollapse size={16} />} onClick={() => insert({ type: "toggleListItem", content: [] })}>{t("Toggle list")}</MenuItem>
          <MenuItem icon={<Minus size={16} />} onClick={() => insert({ type: "divider" })}>{t("Divider")}</MenuItem>
          <MenuItem icon={<Workflow size={16} />} onClick={() => insert({ type: "diagram" })}>{t("Diagram")}</MenuItem>
          <MenuItem icon={<PenTool size={16} />} onClick={() => insert({ type: "whiteboard" })}>{t("Whiteboard")}</MenuItem>
          <MenuItem icon={<ListTree size={16} />} onClick={() => insert({ type: "toc" })}>{t("Table of contents")}</MenuItem>
          <MenuItem icon={<Columns2 size={16} />} onClick={() => insert({
            type: "columnList", children: [
              { type: "column", children: [{ type: "paragraph", content: [] }] },
              { type: "column", children: [{ type: "paragraph", content: [] }] },
            ],
          })}>{t("2 columns")}</MenuItem>
        </Popover>
      )}
      <span hidden>{pageId}</span>
    </div>
  );
  return slotEl ? createPortal(bar, slotEl) : bar;
}
