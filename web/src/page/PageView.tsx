import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Smile, ChevronRight, FileText, Plus, Link2 } from "lucide-react";
import { api, Page, Property, Schema } from "../api";
import { useApp } from "../app/store";
import { relTime, t } from "../i18n";
import { Popover } from "../ui/Popover";
import { CoverPicker, coverStyle, EmojiPicker, GRADIENTS } from "../ui/Pickers";
import { Editor } from "../editor/Editor";
import { DatabaseView, announce, useChanged } from "../db/DatabaseView";
import { PropValue } from "../db/Cell";
import { AddProperty, PropertyMenu } from "../db/Menus";
import { typeIcon } from "../db/model";

export function setSaveState(s: "saving" | "saved" | "error") {
  window.dispatchEvent(new CustomEvent("carnet:save", { detail: s }));
}

export function usePage(id: string | null) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [version, setVersion] = useState(0);        // bump = remount the editor with fresh content
  const load = useCallback(async (remount = true) => {
    if (!id) return;
    try {
      const p = await api.get<Page>(`/api/pages/${id}`);
      setPage(p);
      setError(null);
      if (remount) setVersion((v) => v + 1);
    } catch (e: any) { setError(e.status || 500); }
  }, [id]);
  useEffect(() => { setPage(null); setError(null); load(); }, [id]);  // eslint-disable-line
  return { page, setPage, error, load, version };
}

export function PageView({ pageId, editable, peek }: { pageId: string; editable: boolean; peek?: boolean }) {
  const app = useApp();
  const { page, setPage, error, load, version } = usePage(pageId);
  const pending = useRef<{ content?: any[]; title?: string } | null>(null);
  const timer = useRef<any>(null);
  const rev = useRef(0);
  const [iconPop, setIconPop] = useState<HTMLElement | null>(null);
  const [coverPop, setCoverPop] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (page) rev.current = page.rev; }, [page?.id, version]);  // eslint-disable-line

  // a row edited in its database view (peek open) or by another tab
  useChanged(pageId, () => { if (!pending.current) load(); });

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaveState("saving");
    try {
      const body: any = { ...p };
      if (p.content) body.rev = rev.current;
      const res = await api.post<Page>(`/api/pages/${pageId}`, body);
      rev.current = res.rev;
      setPage((old) => (old ? { ...old, rev: res.rev, updated_at: res.updated_at, title: res.title, backlinks: res.backlinks, children: res.children } : old));
      app.patchTree(pageId, { title: res.title, updated_at: res.updated_at });
      if (p.title !== undefined) announce(res.parent_id);
      setSaveState("saved");
    } catch (e: any) {
      if (e.status === 409) {
        app.toast(t("This page was changed elsewhere: reloaded."));
        load();
        setSaveState("saved");
      } else {
        pending.current = { ...p, ...(pending.current || {}) };
        setSaveState("error");
        timer.current = setTimeout(flush, 4000);
      }
    }
  }, [pageId, app, load, setPage]);

  const queue = useCallback((patch: { content?: any[]; title?: string }, delay = 700) => {
    pending.current = { ...(pending.current || {}), ...patch };
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [flush]);

  useEffect(() => {
    const before = () => { if (pending.current) flush(); };
    addEventListener("beforeunload", before);
    addEventListener("pagehide", before);
    return () => { removeEventListener("beforeunload", before); removeEventListener("pagehide", before); flush(); };
  }, [flush]);

  const update = async (patch: Record<string, any>) => {
    setPage((p) => (p ? { ...p, ...patch, options: patch.options ? { ...p.options, ...patch.options } : p.options } : p));
    const res = await api.post<Page>(`/api/pages/${pageId}`, patch);
    rev.current = res.rev;
    app.patchTree(pageId, { icon: res.icon, title: res.title });
    announce(res.parent_id);
    return res;
  };

  // auto-grow title
  useEffect(() => {
    const el = titleRef.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  });

  if (error) return <div className="cn-page-missing"><h2>{t("Page not found")}</h2><button className="cn-btn" onClick={() => app.navigate(null)}>{t("Go home")}</button></div>;
  if (!page) return <div className="cn-page-loading" />;

  const isDb = page.kind === "database";
  const isRow = !!page.database;
  const o = page.options || {};
  const cls = ["cn-page", o.full_width ? "full" : "", o.small_text ? "small" : "", o.font ? "font-" + o.font : "", peek ? "peek" : "", isDb ? "is-db" : ""].join(" ");
  const referenced = new Set<string>();
  const walk = (bs: any[]) => bs?.forEach((b) => { if (b?.props?.pageId) referenced.add(b.props.pageId); walk(b?.children || []); (Array.isArray(b?.content) ? b.content : []).forEach((c: any) => c?.props?.pageId && referenced.add(c.props.pageId)); });
  walk(page.content);
  const loose = isDb ? [] : app.children(page.id).filter((c) => !referenced.has(c.id) && !c.is_template);

  return (
    <div className={cls}>
      {page.cover && (
        <div className="cn-cover" style={coverStyle(page.cover)}>
          {editable && (
            <div className="cn-cover-btns">
              <button type="button" onClick={(e) => setCoverPop(e.currentTarget)}>{t("Change cover")}</button>
              <button type="button" onClick={() => update({ cover: "" })}>{t("Remove")}</button>
            </div>
          )}
        </div>
      )}
      <div className={`cn-page-inner ${page.cover ? "has-cover" : ""} ${page.icon ? "has-icon" : ""}`}>
        {page.icon && (
          <button type="button" className="cn-page-icon" onClick={(e) => editable && setIconPop(e.currentTarget)}>{page.icon}</button>
        )}
        {editable && (
          <div className="cn-page-addons">
            {!page.icon && <button type="button" onClick={(e) => setIconPop(e.currentTarget)}><Smile size={15} /> {t("Add icon")}</button>}
            {!page.cover && <button type="button" onClick={() => update({ cover: GRADIENTS[Math.floor(Math.random() * 12)] })}><ImagePlus size={15} /> {t("Add cover")}</button>}
          </div>
        )}
        <textarea ref={titleRef} className="cn-title" rows={1} value={page.title} placeholder={t("Untitled")} readOnly={!editable}
          onChange={(e) => { const v = e.target.value.replace(/\n/g, ""); setPage({ ...page, title: v }); app.patchTree(page.id, { title: v }); queue({ title: v }, 400); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const ed = document.querySelector(`.cn-page[data-page="${page.id}"] .bn-editor, .cn-editor .bn-editor`) as HTMLElement | null;
              ed?.focus();
            }
          }} />
        {page.readonly && (
          <div className="cn-ro-note">{t("Markdown file, read only")} · <code>{page.source?.folder}{page.source?.path ? " / " + page.source.path : ""}</code></div>
        )}
        {isRow && <RowProperties page={page} editable={editable} onPage={setPage} />}
        {isDb ? (
          <DatabaseView dbId={page.id} initial={page} readOnly={!editable} />
        ) : (
          <div data-page={page.id}>
            <Editor key={page.id + ":" + version} page={page} editable={editable}
              focusOnLoad={!page.title && !page.content.length} toolbarSlot={peek ? "cn-tb-peek" : "cn-tb-main"}
              onChange={(blocks) => queue({ content: blocks })} />
          </div>
        )}
        {loose.length > 0 && (
          <div className="cn-subpages">
            {loose.map((c) => (
              <div key={c.id} className="cn-pagelink" onClick={() => app.navigate(c.id)}>
                <span className="ic">{c.icon || <FileText size={18} />}</span><span className="tx">{c.title || t("Untitled")}</span>
              </div>
            ))}
          </div>
        )}
        {page.backlinks.length > 0 && (
          <details className="cn-backlinks">
            <summary><Link2 size={14} /> {t("Backlinks")} ({page.backlinks.length})</summary>
            {page.backlinks.map((b) => (
              <a key={b.id} className="cn-backlink" onClick={() => app.navigate(b.id)}>
                <span>{b.icon || "📄"}</span> {b.title || t("Untitled")} <ChevronRight size={13} />
              </a>
            ))}
          </details>
        )}
        <div className="cn-page-foot">{t("Edited")} {relTime(page.updated_at)}</div>
      </div>
      {iconPop && (
        <Popover anchor={iconPop} onClose={() => setIconPop(null)} width={360}>
          <EmojiPicker onPick={(e) => { update({ icon: e }); setIconPop(null); }} onRemove={page.icon ? () => { update({ icon: "" }); setIconPop(null); } : undefined} />
        </Popover>
      )}
      {coverPop && (
        <Popover anchor={coverPop} onClose={() => setCoverPop(null)} width={420} placement="bottom-end">
          <CoverPicker pageId={page.id} onPick={(c) => { update({ cover: c }); setCoverPop(null); }} onRemove={() => { update({ cover: "" }); setCoverPop(null); }} />
        </Popover>
      )}
    </div>
  );
}

/** The property list under the title of a database row (like Notion). */
function RowProperties({ page, editable, onPage }: { page: Page; editable: boolean; onPage: (p: Page) => void }) {
  const app = useApp();
  const [schema, setSchema] = useState<Schema>(page.database!.schema);
  const [menu, setMenu] = useState<{ el: HTMLElement; prop: Property } | null>(null);
  const [add, setAdd] = useState<HTMLElement | null>(null);
  useEffect(() => setSchema(page.database!.schema), [page.database]);
  const dbId = page.database!.id;
  const saveSchema = async (s: Schema) => {
    setSchema(s);
    await api.post(`/api/pages/${dbId}`, { schema: s });
    announce(dbId);
  };
  const row = { ...page, props: page.props, cover: page.cover, has_content: true, preview: "" } as any;
  const setVal = async (p: Property, v: any) => {
    onPage({ ...page, props: { ...page.props, [p.id]: v } });
    const res = await api.post<Page>(`/api/pages/${page.id}`, { props: { [p.id]: v } });
    onPage({ ...page, props: res.props, rev: res.rev });
    announce(dbId);
  };
  const dummyView = { id: "", name: "", type: "table" as const };
  return (
    <div className="cn-rowprops">
      <a className="cn-rowprops-db" onClick={() => app.navigate(dbId)}>{page.database!.icon || "🗂️"} {page.database!.title || t("Untitled")}</a>
      {schema.properties.map((p) => (
        <div key={p.id} className="cn-rowprop">
          <button type="button" className="cn-rowprop-name" onClick={(e) => editable && setMenu({ el: e.currentTarget, prop: p })}>
            {typeIcon(p.type, 15)}<span>{p.name}</span>
          </button>
          <PropValue prop={p} row={row} schema={schema} mode="panel" readOnly={!editable}
            onChange={(v) => setVal(p, v)} onSchema={(np) => saveSchema({ ...schema, properties: schema.properties.map((x) => (x.id === np.id ? np : x)) })} />
        </div>
      ))}
      {editable && <button type="button" className="cn-rowprop-add" onClick={(e) => setAdd(e.currentTarget)}><Plus size={14} /> {t("Add a property")}</button>}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} width={260}>
          <PropertyMenu prop={menu.prop} schema={schema} view={dummyView} onSchema={saveSchema} onView={() => {}} onClose={() => setMenu(null)} />
        </Popover>
      )}
      {add && <Popover anchor={add} onClose={() => setAdd(null)} width={240}><AddProperty schema={schema} onSchema={saveSchema} onClose={() => setAdd(null)} /></Popover>}
    </div>
  );
}
