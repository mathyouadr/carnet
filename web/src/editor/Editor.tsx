import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { combineByGroup, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { fr as bnFr, en as bnEn } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import {
  FormattingToolbar, FormattingToolbarController, SuggestionMenuController, getDefaultReactSlashMenuItems,
  getFormattingToolbarItems, useComponentsContext, useCreateBlockNote,
} from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { getMultiColumnSlashMenuItems, multiColumnDropCursor, locales as mcLocales } from "@blocknote/xl-multi-column";
import { syntaxHighlighter } from "@blocknote/code-block";
import { Sigma, SquareFunction, MessageSquareQuote, FileText, Table2, Database, Link2, ListTree, AppWindow, Plus, Sparkles } from "lucide-react";
import { api, BOOT, fileUrl, Page } from "../api";
import { useApp } from "../app/store";
import { LANG, t } from "../i18n";
import { schema } from "./schema";
import { sanitize } from "./sanitize";
import { AIMenu, aiName } from "./ai/AIMenu";
import { isSpaceInput } from "./ai/policy";
import { DocsToolbar } from "./DocsToolbar";
import { BlockMenu, BlocksMenu, SelectionMenu } from "./BlockMenu";
import { BlockSelectLayer, useBlockSelect } from "./blockSelect";
import { PageMenu } from "../app/PageMenu";
import { useTheme } from "../app/theme";

/** ✨ in BlockNote's selection toolbar (desktop). */
function AIToolbarButton({ onClick }: { onClick: () => void }) {
  const C = useComponentsContext()!;
  return <C.FormattingToolbar.Button className="cn-ai-tb" label={t("Ask {name}").replace("{name}", aiName())}
    mainTooltip={t("Ask {name}").replace("{name}", aiName())} onClick={onClick}>
    <Sparkles size={16} /><span className="cn-ai-tb-tx">{t("Ask AI")}</span>
  </C.FormattingToolbar.Button>;
}

type EditorProps = {
  page: Page; editable: boolean; onChange: (blocks: any[]) => void; focusOnLoad?: boolean; toolbarSlot?: string; strict?: boolean;
};

/** A page that cannot be loaded must never blank the whole app: retry in plain-text mode, then show a message. */
class EditorBoundary extends Component<EditorProps, { level: number; key: string }> {
  state = { level: 0, key: this.props.page.id };
  static getDerivedStateFromProps(p: EditorProps, s: { level: number; key: string }) {
    return p.page.id !== s.key ? { level: 0, key: p.page.id } : null;
  }
  componentDidCatch(err: unknown) {
    console.error("Carnet: page content could not be loaded", err);
    this.setState(s => ({ level: s.level + 1 }));
  }
  render() {
    if (this.state.level >= 2)
      return <div className="cn-editor-error">{t("This page could not be displayed. Its content is kept: export it as Markdown from the ⋯ menu.")}</div>;
    return <EditorInner key={this.state.level} {...this.props} strict={this.state.level === 1} />;
  }
}

export function Editor(props: EditorProps) {
  return <EditorBoundary {...props} />;
}

function EditorInner({ page, editable, onChange, focusOnLoad, toolbarSlot, strict }: EditorProps) {
  const app = useApp();
  const theme = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const dict = LANG === "fr" ? bnFr : bnEn;
  const editor: any = useCreateBlockNote({
    schema,
    dropCursor: multiColumnDropCursor,
    dictionary: {
      ...dict,
      multi_column: LANG === "fr" ? mcLocales.fr : mcLocales.en,
      placeholders: { ...dict.placeholders, default: t("Start writing, or press / for commands"), emptyDocument: t("Start writing, or press / for commands") },
    } as any,
    initialContent: page.content?.length ? sanitize(page.content, strict) : undefined,
    uploadFile: async (file: File) => (await api.upload(file, file.name, page.id)).url,
    resolveFileUrl: async (url: string) => fileUrl(url),
    extensions: [syntaxHighlighter],
    tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
    animations: false,
  } as any, [page.id, strict]);

  useEffect(() => {
    if (focusOnLoad && editable) setTimeout(() => editor.focus(), 50);
  }, [editor]);  // eslint-disable-line

  // AI assistant: only when configured, on editable pages that are not Markdown files
  const aiAvailable = !!BOOT.ai?.enabled && !page.readonly && !page.in_trash;
  const aiOn = aiAvailable && editable;
  const [ai, setAI] = useState<{ blockIds: string[]; hasSelection: boolean } | null>(null);
  useEffect(() => setAI(null), [page.id]);               // a menu belongs to the page it was opened on
  // scope "page": the whole page (toolbar button); "here": the block under the cursor (/ia); default: selection, else cursor
  const openAI = useCallback((scope?: "page" | "here") => {
    const sel = editor.getSelection();
    const ids: string[] = (sel?.blocks || []).map((b: any) => b.id);
    if (ids.length) return setAI({ blockIds: ids, hasSelection: true });
    const cur = editor.getTextCursorPosition().block;
    const filled = (b: any) => !Array.isArray(b.content) || b.content.length > 0 || (b.children || []).length > 0;
    if (scope === "page") {
      const all: any[] = editor.document;
      if (all.length > 1 || (all[0] && filled(all[0]))) return setAI({ blockIds: all.map((b) => b.id), hasSelection: true });
    }
    if (scope === "here" && filled(cur)) return setAI({ blockIds: [cur.id], hasSelection: true });
    setAI({ blockIds: [cur.id], hasSelection: false });
  }, [editor]);

  // Mobile reading mode: the AI button switches to edit mode, and the menu opens once the page is editable
  useEffect(() => {
    if (!aiOn || sessionStorage.getItem("carnet:ai-open") !== page.id) return;
    sessionStorage.removeItem("carnet:ai-open");
    const timer = setTimeout(() => openAI("page"), 60);
    return () => clearTimeout(timer);
  }, [aiOn, page.id, openAI]);

  // dragging a block (or a file) near the top or bottom edge scrolls the page, as the browser does not here
  useEffect(() => {
    const el = host.current;
    const area = el?.closest(".cn-scroll") as HTMLElement | null;
    if (!el || !area) return;
    let y = 0, raf = 0, on = false;
    const step = () => {
      const r = area.getBoundingClientRect();
      const zone = 90;
      const d = y < r.top + zone ? -(r.top + zone - y) : y > r.bottom - zone ? y - (r.bottom - zone) : 0;
      if (d) area.scrollTop += Math.sign(d) * Math.min(28, 4 + Math.abs(d) / 4);
      raf = on ? requestAnimationFrame(step) : 0;
    };
    const over = (e: DragEvent) => {
      const r = area.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right) return;
      y = e.clientY;
      if (!on) { on = true; raf = requestAnimationFrame(step); }
    };
    const stop = () => { on = false; cancelAnimationFrame(raf); raf = 0; };
    document.addEventListener("dragover", over, true);
    document.addEventListener("dragend", stop, true);
    document.addEventListener("drop", stop, true);
    return () => { stop(); document.removeEventListener("dragover", over, true); document.removeEventListener("dragend", stop, true); document.removeEventListener("drop", stop, true); };
  }, []);

  // Notion block selection (marquee from the margins, Esc, Shift+arrows)
  const bsel = useBlockSelect(editor, host, editable && !page.readonly, page.id);
  const bselRef = useRef(bsel); bselRef.current = bsel;
  const [multiMenu, setMultiMenu] = useState<DOMRect | null>(null);
  useEffect(() => setMultiMenu(null), [page.id]);
  // right-click on a block (Notion): its own menu, unless text is selected (browser menu: copy, paste)
  const [selMenu, setSelMenu] = useState<DOMRect | null>(null);
  const [pageMenu, setPageMenu] = useState<DOMRect | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ id: string; at: DOMRect } | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || !editable) return;
    const area = (el.closest(".cn-scroll") as HTMLElement) || el;
    const idOf = (n: Element | null) => n?.closest?.(".bn-block-outer")?.getAttribute("data-id") || n?.closest?.("[data-node-type=blockContainer]")?.getAttribute("data-id");
    // the block under the pointer, or (margins, below the last block) the one nearest to it vertically
    const blockAt = (y: number) => {
      let best: Element | null = null, bd = Infinity;
      for (const c of Array.from(el.querySelectorAll(".bn-block-content"))) {
        const r = c.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d <= bd) { bd = d; best = c; }
      }
      return bd <= 400 ? best : null;
    };
    const ctx = (e: MouseEvent) => {
      const tg = e.target as HTMLElement;
      if (tg.closest?.("input, textarea:not(.cn-title), select, a[href], .cn-pop")) return;
      if (tg.closest?.("button") && tg.closest?.(".bn-editor")) return;
      const bs = bselRef.current;
      if (bs.active) {                                   // blocks are selected: one menu for all of them
        if (bs.hits(e.clientY)) { e.preventDefault(); setMultiMenu(new DOMRect(e.clientX, e.clientY, 0, 0)); return; }
        bs.clear();
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && el.querySelector(".bn-editor")?.contains(sel.anchorNode)) {
        e.preventDefault();
        setSelMenu(new DOMRect(e.clientX, e.clientY, 0, 0));
        return;
      }
      let id: string | null | undefined;
      if (tg.closest?.(".bn-editor")) id = idOf(tg);
      if (!id) {
        const first = el.querySelector(".bn-block-content")?.getBoundingClientRect();
        if (!first || e.clientY < first.top) { // title, cover, properties, empty page: the page's own menu
          e.preventDefault();
          setPageMenu(new DOMRect(e.clientX, e.clientY, 0, 0));
          return;
        }
        id = idOf(blockAt(e.clientY));
      }
      if (!id) return;
      e.preventDefault();
      setBlockMenu({ id, at: new DOMRect(e.clientX, e.clientY, 0, 0) });
    };
    area.addEventListener("contextmenu", ctx);
    return () => area.removeEventListener("contextmenu", ctx);
  }, [editable]);

  // Space on an empty line opens the menu (Notion). Android virtual keyboards send no space keydown: the
  // space arrives as a text input instead (beforeinput, or input when the browser does not let us cancel it).
  useEffect(() => {
    const el = host.current;
    if (!el || !aiOn) return;
    const inEditor = (e: Event) => !!(e.target as HTMLElement).closest?.(".bn-editor");
    const emptyLine = () => {
      if (editor.getSelection()) return null;
      const b = editor.getTextCursorPosition().block;
      return b.type === "paragraph" && !(b.content || []).length ? b : null;
    };
    const down = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
      if (!inEditor(e) || !emptyLine()) return;
      e.preventDefault();
      e.stopPropagation();
      openAI();
    };
    const before = (e: InputEvent) => {
      if (!isSpaceInput(e.data, e.inputType) || !inEditor(e) || !emptyLine()) return;
      e.preventDefault();
      openAI();
    };
    const input = (e: InputEvent) => {
      if (!isSpaceInput(e.data, e.inputType) || !inEditor(e) || editor.getSelection()) return;
      const b = editor.getTextCursorPosition().block;
      if (b.type !== "paragraph" || (b.content || []).length !== 1 || (b.content[0] as any).text !== " ") return;
      editor.updateBlock(b, { content: [] } as any);
      openAI();
    };
    el.addEventListener("keydown", down, true);
    el.addEventListener("beforeinput", before as any, true);
    el.addEventListener("input", input as any, true);
    return () => {
      el.removeEventListener("keydown", down, true);
      el.removeEventListener("beforeinput", before as any, true);
      el.removeEventListener("input", input as any, true);
    };
  }, [editor, aiOn, openAI]);

  const slashItems = useMemo(() => async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const custom = [
      {
        title: t("Sub-page"), subtext: t("Page"), group: t("Basic blocks"), aliases: ["page", "sous-page", "subpage"],
        icon: <FileText size={18} />,
        onItemClick: async () => {
          const child = await app.createPage({ parent_id: page.id, title: "" }, false);
          insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId: child.id } } as any);
          app.navigate(child.id);
        },
      },
      {
        title: t("Database - inline"), subtext: t("Table"), group: t("Advanced"), aliases: ["database", "base", "db", "table", "tableau", "kanban"],
        icon: <Table2 size={18} />,
        onItemClick: async () => {
          const db = await app.createPage({ parent_id: page.id, kind: "database", inline: 1, title: "",
            title_name: t("Name"), view_name: t("Table") }, false);
          insertOrUpdateBlockForSlashMenu(editor, { type: "database", props: { pageId: db.id } } as any);
        },
      },
      {
        title: t("Database"), subtext: t("Page"), group: t("Advanced"), aliases: ["database", "base", "db", "full"],
        icon: <Database size={18} />,
        onItemClick: async () => {
          const db = await app.createPage({ parent_id: page.id, kind: "database", title: "", title_name: t("Name"), view_name: t("Table") }, false);
          insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId: db.id } } as any);
          app.navigate(db.id);
        },
      },
      {
        title: t("Callout"), group: t("Basic blocks"), aliases: ["callout", "encadre", "encadré", "note", "info", "alert"],
        icon: <MessageSquareQuote size={18} />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" } as any),
      },
      {
        title: t("Formula"), group: t("Advanced"), aliases: ["math", "latex", "equation", "formule", "katex", "tex"],
        icon: <SquareFunction size={18} />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "math" } as any),
      },
      {
        title: t("Inline formula"), group: t("Advanced"), aliases: ["math", "latex", "inline", "formule", "$"],
        icon: <Sigma size={18} />,
        onItemClick: () => editor.insertInlineContent([{ type: "inlineMath", props: { latex: "x^2" } } as any, " "]),
      },
      {
        title: t("Mention a page"), group: t("Basic blocks"), aliases: ["link", "lien", "mention", "@", "[["],
        icon: <Link2 size={18} />,
        onItemClick: () => editor.insertInlineContent("@"),
      },
      {
        title: t("Table of contents"), group: t("Advanced"), aliases: ["toc", "sommaire", "table des matieres", "contents"],
        icon: <ListTree size={18} />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toc" } as any),
      },
      {
        title: t("Embed"), group: t("Media"), aliases: ["embed", "iframe", "youtube", "integration", "intégration", "maps", "pdf"],
        icon: <AppWindow size={18} />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "embed" } as any),
      },
    ];
    // "Ask AI" first, in its own group, like Notion
    const aiItems: any[] = aiOn ? [{
      title: t("Ask {name}").replace("{name}", aiName()), subtext: t("Write, edit, summarize…"), group: t("AI"),
      aliases: ["ai", "ia", "assistant", "hermes", aiName().toLowerCase()],
      icon: <Sparkles size={18} />,
      onItemClick: () => setTimeout(() => openAI("here"), 0),
    }] : [];
    const defaults = getDefaultReactSlashMenuItems(editor);
    return filterSuggestionItems([...aiItems, ...combineByGroup(defaults, getMultiColumnSlashMenuItems(editor), custom as any)] as any, query) as any;
  }, [editor, page.id, app, aiOn, openAI]);

  const mentionItems = useMemo(() => async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const q = query.toLowerCase();
    const pages = app.tree.filter((p) => p.id !== page.id && !p.is_template && (p.title || "").toLowerCase().includes(q)).slice(0, 12);
    const items: any[] = pages.map((p) => ({
      title: p.title || t("Untitled"), icon: <span className="cn-sugg-ic">{p.icon || "📄"}</span>,
      subtext: app.byId.get(p.parent_id || "")?.title || "",
      onItemClick: () => editor.insertInlineContent([{ type: "pageMention", props: { pageId: p.id, title: p.title } } as any, " "]),
    }));
    if (query.trim()) {
      items.push({
        title: `${t("New page")} « ${query} »`, icon: <Plus size={16} />,
        onItemClick: async () => {
          const np = await app.createPage({ parent_id: page.id, title: query.trim() }, false);
          editor.insertInlineContent([{ type: "pageMention", props: { pageId: np.id, title: np.title } } as any, " "]);
        },
      });
    }
    return items;
  }, [editor, app.tree, page.id]);

  return (
    <div ref={host} className={`cn-editor ${editable ? "edit" : "read"}`}>
      <BlockSelectLayer rects={bsel.rects} box={bsel.box} />
      {editable && <DocsToolbar editor={editor} pageId={page.id} slot={toolbarSlot} onAI={aiOn ? () => openAI("page") : undefined} />}
      <BlockNoteView editor={editor} editable={editable} theme={theme} onChange={() => onChange(editor.document as any[])}
        slashMenu={false} formattingToolbar={!app.mobile && !aiOn} sideMenu={editable && !app.mobile} emojiPicker>
        {aiOn && !app.mobile && (
          <FormattingToolbarController formattingToolbar={() => (
            <FormattingToolbar>
              <AIToolbarButton key="ai" onClick={openAI} />
              {...getFormattingToolbarItems()}
            </FormattingToolbar>
          )} />
        )}
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        <SuggestionMenuController triggerCharacter="@" getItems={mentionItems} />
      </BlockNoteView>
      {aiAvailable && !editable && app.mobile && (
        <button type="button" aria-label={t("Ask AI")} title={t("Ask AI")}
          className="cn-btn cn-ai-fab" style={{ position: "fixed", right: 16, zIndex: 30, display: "flex", alignItems: "center", gap: 6, borderRadius: 999, boxShadow: "0 2px 10px rgba(0,0,0,.18)" }}
          onClick={() => {
            sessionStorage.setItem("carnet:ai-open", page.id);
            window.dispatchEvent(new CustomEvent("carnet:mode", { detail: "edit" }));   // App.tsx switches to edit mode
          }}>
          <Sparkles size={18} /><span className="cn-ai-fab-tx">{t("Ask AI")}</span>
        </button>
      )}
      {pageMenu && <PageMenu page={page} anchor={pageMenu} onClose={() => setPageMenu(null)} />}
      {selMenu && <SelectionMenu editor={editor} at={selMenu} onAI={aiOn ? openAI : undefined} onClose={() => setSelMenu(null)} />}
      {multiMenu && <BlocksMenu editor={editor} sel={bsel} at={multiMenu} onAI={aiOn ? openAI : undefined} onClose={() => setMultiMenu(null)} />}
      {blockMenu && <BlockMenu editor={editor} blockId={blockMenu.id} at={blockMenu.at} onAI={aiOn ? openAI : undefined} onClose={() => setBlockMenu(null)} />}
      {ai && <AIMenu key={page.id} editor={editor} pageId={page.id} blockIds={ai.blockIds} hasSelection={ai.hasSelection} onClose={() => setAI(null)} />}
    </div>
  );
}
