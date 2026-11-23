import { useEffect, useMemo, useRef, useState } from "react";
import { combineByGroup, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { fr as bnFr, en as bnEn } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { getMultiColumnSlashMenuItems, multiColumnDropCursor, locales as mcLocales } from "@blocknote/xl-multi-column";
import { syntaxHighlighter } from "@blocknote/code-block";
import { Sigma, SquareFunction, MessageSquareQuote, FileText, Table2, Database, Link2, ListTree, AppWindow, Plus } from "lucide-react";
import { api, fileUrl, Page } from "../api";
import { useApp } from "../app/store";
import { LANG, t } from "../i18n";
import { schema } from "./schema";
import { DocsToolbar } from "./DocsToolbar";
import { useTheme } from "../app/theme";

const KNOWN = new Set(Object.keys((schema as any).blockSchema));

/** Drop what the schema doesn't know (old imports, newer versions) instead of crashing the editor. */
function sanitize(blocks: any[]): any[] {
  const out: any[] = [];
  for (const b of blocks || []) {
    if (!b || typeof b !== "object") continue;
    if (!KNOWN.has(b.type)) {
      const text = Array.isArray(b.content) ? b.content : [];
      out.push({ type: "paragraph", content: text, children: sanitize(b.children || []) });
      continue;
    }
    out.push({ ...b, children: sanitize(b.children || []) });
  }
  return out;
}

export function Editor({ page, editable, onChange, focusOnLoad, toolbarSlot }: {
  page: Page; editable: boolean; onChange: (blocks: any[]) => void; focusOnLoad?: boolean; toolbarSlot?: string;
}) {
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
    initialContent: page.content?.length ? sanitize(page.content) : undefined,
    uploadFile: async (file: File) => (await api.upload(file, file.name, page.id)).url,
    resolveFileUrl: async (url: string) => fileUrl(url),
    extensions: [syntaxHighlighter],
    tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
    animations: false,
  } as any, [page.id]);

  useEffect(() => {
    if (focusOnLoad && editable) setTimeout(() => editor.focus(), 50);
  }, [editor]);  // eslint-disable-line

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
    const defaults = getDefaultReactSlashMenuItems(editor);
    return filterSuggestionItems(combineByGroup(defaults, getMultiColumnSlashMenuItems(editor), custom as any) as any, query) as any;
  }, [editor, page.id, app]);

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
      {editable && <DocsToolbar editor={editor} pageId={page.id} slot={toolbarSlot} />}
      <BlockNoteView editor={editor} editable={editable} theme={theme} onChange={() => onChange(editor.document as any[])}
        slashMenu={false} formattingToolbar={!app.mobile} sideMenu={editable && !app.mobile} emojiPicker>
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        <SuggestionMenuController triggerCharacter="@" getItems={mentionItems} />
      </BlockNoteView>
    </div>
  );
}
