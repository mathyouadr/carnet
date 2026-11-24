import { useCallback, useEffect, useRef, useState } from "react";
import {
  Table2, Columns3, List as ListIcon, LayoutGrid, CalendarDays, Plus, ChevronDown, Search, ArrowUpDown,
  ListFilter, SlidersHorizontal, Trash2, Copy, X, FileText, Download,
} from "lucide-react";
import { api, BASE, Page, Row, Schema, View } from "../api";
import { useApp } from "../app/store";
import { t } from "../i18n";
import { MenuItem, MenuLabel, MenuSep, Popover } from "../ui/Popover";
import { applyView, changedPropValues, newId, propsFromFilters, withOptionsFor } from "./model";
import { BoardView, CalendarView, GalleryView, ListView, TableView } from "./Views";
import { RowSelCtx, useRowSelect } from "./rowSelect";
import { FilterEditor, filterLabel, RenameInline, SortEditor, VisibilityEditor } from "./Menus";

export const VIEW_TYPES: { type: View["type"]; label: string; icon: any }[] = [
  { type: "table", label: "Table", icon: Table2 },
  { type: "board", label: "Board", icon: Columns3 },
  { type: "list", label: "List", icon: ListIcon },
  { type: "gallery", label: "Gallery", icon: LayoutGrid },
  { type: "calendar", label: "Calendar", icon: CalendarDays },
];
const viewIcon = (type: string, size = 14) => {
  const V = VIEW_TYPES.find((v) => v.type === type)?.icon || Table2;
  return <V size={size} />;
};

/** Tell every open view of a database (and the sidebar) that something changed. */
export function announce(id: string | null | undefined) {
  if (id) window.dispatchEvent(new CustomEvent("carnet:changed", { detail: { id } }));
}

export function useChanged(id: string | null | undefined, cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail?.id === id) ref.current(); };
    addEventListener("carnet:changed", on);
    return () => removeEventListener("carnet:changed", on);
  }, [id]);
}

/** ``lockView``: a linked view (inline database block pointing at one view, Notion's "linked view of a database"):
 *  only that view is shown, its name is the title. Views marked ``embed_only`` stay out of the database's own tabs. */
export function DatabaseView({ dbId, inline, readOnly, initial, lockView }: { dbId: string; inline?: boolean; readOnly?: boolean; initial?: Page; lockView?: string }) {
  const app = useApp();
  const [db, setDb] = useState<Page | null>(initial && initial.id === dbId ? initial : null);
  const [err, setErr] = useState("");
  const [viewId, setViewId] = useState<string | null>(() => localStorage.getItem("carnet:view:" + dbId));
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pop, setPop] = useState<{ k: string; el: HTMLElement; i?: number } | null>(null);
  const saveTimer = useRef<any>(null);

  // latest database, for handlers that run later (async saves, stale closures)
  const dbRef = useRef<Page | null>(db);
  const commit = useCallback((p: Page | null) => { dbRef.current = p; setDb(p); }, []);
  const load = useCallback(async () => {
    try { commit(await api.get(`/api/pages/${dbId}`)); setErr(""); } catch (e: any) { setErr(e.status === 404 ? t("Page not found") : String(e.message)); }
  }, [dbId, commit]);
  // ``initial`` (the page the parent already loaded) is used on mount or when the database changes only:
  // the parent re-renders with a new ``initial`` on every title keystroke, which must not reset the rows
  useEffect(() => { if (initial && initial.id === dbId) commit(initial); else load(); }, [dbId]);  // eslint-disable-line
  useChanged(dbId, load);
  // rectangle selection of cards / rows (before the early returns below: hooks keep their order)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const rowSel = useRowSelect({ root: rootEl, dbId, inline, readOnly: !!readOnly, reload: load });

  if (err) return <div className="cn-db-missing">{err}</div>;
  if (!db || !db.schema || !db.views) return <div className="cn-db-loading">{t("Loading…")}</div>;
  const schema = db.schema;
  const views = db.views;
  const locked = lockView ? views.find((v) => v.id === lockView) : undefined;
  const tabs = locked ? [locked] : views.filter((v) => !v.embed_only);
  const view = locked || tabs.find((v) => v.id === viewId) || tabs[0] || views[0];
  const rows = (db.rows || []).filter((r) => !r.is_template);
  const templates = (db.rows || []).filter((r) => r.is_template);
  const shown = applyView(rows, view, schema, search, app.titleOf);

  const persist = (patch: Partial<Page>) => {
    if (dbRef.current) commit({ ...dbRef.current, ...patch });
    clearTimeout(saveTimer.current);
    const body: any = {};
    if (patch.schema) body.schema = patch.schema;
    if (patch.views) body.views = patch.views;
    if (patch.title !== undefined) body.title = patch.title;
    api.post(`/api/pages/${dbId}`, body).then((p) => {
      if (patch.title !== undefined) app.patchTree(dbId, { title: p.title });
    }).catch((e) => app.toast(String(e.message)));
  };
  // a property that changes type: its values in every row are converted (see changedPropValues)
  const onSchema = (given: Schema) => {
    const cur = dbRef.current;
    const s = cur?.schema ? withOptionsFor(cur.rows || [], cur.schema, given, () => newId()) : given;
    const moved = cur?.schema ? changedPropValues(cur.rows || [], cur.schema, s) : [];
    persist({ schema: s });
    for (const m of moved) {
      setRow(m.id, { props: m.props } as any);
      api.post(`/api/pages/${m.id}`, { props: m.props }).catch((e: any) => app.toast(t("Your changes could not be saved: {msg}").replace("{msg}", String(e.message))));
    }
  };
  // views are read from the latest state: two quick changes must not overwrite each other
  const curViews = () => dbRef.current?.views ?? views;
  const onView = (v: View) => persist({ views: curViews().map((x) => (x.id === v.id ? v : x)) });
  const setRow = (id: string, patch: Partial<Row>) => {
    const d = dbRef.current;
    if (d) commit({ ...d, rows: (d.rows || []).map((r) => (r.id === id ? { ...r, ...patch, props: { ...r.props, ...(patch.props || {}) } } : r)) });
  };
  const onRow = async (id: string, patch: { title?: string; props?: Record<string, any> }) => {
    setRow(id, patch as any);
    try {
      const p = await api.post(`/api/pages/${id}`, patch);
      setRow(id, { props: p.props, updated_at: p.updated_at, title: p.title });
      if (patch.title !== undefined) app.patchTree(id, { title: p.title });
      announce(id);
    } catch (e: any) { app.toast(t("Your changes could not be saved: {msg}").replace("{msg}", String(e.message))); load(); }
  };
  const onAdd = async (props: Record<string, any> = {}, open = false, template?: string) => {
    try {
      const r = template
        ? await api.post(`/api/templates/${template}/use`, { parent_id: dbId })
        : await api.post(`/api/databases/${dbId}/rows`, { title: "", props: { ...propsFromFilters(view, schema), ...props } });
      if (template) await api.post(`/api/pages/${r.id}`, { props: { ...propsFromFilters(view, schema), ...props } });
      await load();
      app.refresh();
      if (open) app.setPeek(r.id);
      return r as Row;
    } catch (e: any) { app.toast(String(e.message)); return null; }
  };
  const open = (id: string) => app.setPeek(id);
  const pick = (id: string) => { setViewId(id); localStorage.setItem("carnet:view:" + dbId, id); };
  const close = () => setPop(null);
  const openPop = (k: string, i?: number) => (e: React.MouseEvent) => setPop({ k, el: e.currentTarget as HTMLElement, i });
  const vp = { rows: shown, schema, view, readOnly: !!readOnly, onRow, onAdd, onSchema, onView, open };
  // delete a view: switch to its neighbour tab at once, and tell the other open views (linked blocks, peek) once saved
  const removeView = (id: string) => {
    const i = tabs.findIndex((v) => v.id === id);
    const rest = curViews().filter((v) => v.id !== id);
    const next = rest.filter((v) => !v.embed_only);
    const to = next[Math.min(Math.max(i, 0), next.length - 1)] || rest[0];
    if (to) pick(to.id);
    if (dbRef.current) commit({ ...dbRef.current, views: rest });
    api.post(`/api/pages/${dbId}`, { views: rest }).then(() => announce(dbId)).catch((e) => { app.toast(String(e.message)); load(); });
  };
  const addView = (type: View["type"]) => {
    const v: View = { id: newId(8), name: t(VIEW_TYPES.find((x) => x.type === type)!.label), type };
    persist({ views: [...curViews(), v] });
    pick(v.id);
    close();
  };

  return (
    <RowSelCtx.Provider value={rowSel.ctx}>
    <div ref={setRootEl} className={`cn-db ${inline ? "inline" : "full"}`}>
      {inline && (
        <div className="cn-db-title">
          <span className="ic">{db.icon || "🗂️"}</span>
          {locked ? <a onClick={() => app.navigate(dbId)}>{locked.name}</a> : readOnly ? <a onClick={() => app.navigate(dbId)}>{db.title || t("Untitled")}</a> : (
            <input className="cn-db-title-in" defaultValue={db.title} placeholder={t("Untitled")} key={db.id}
              onBlur={(e) => { if (e.target.value !== db.title) persist({ title: e.target.value }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          )}
          <button type="button" className="cn-icon-btn" title={t("Open in full page")} onClick={() => app.navigate(dbId)}><FileText size={14} /></button>
        </div>
      )}
      <div className="cn-db-bar">
        <div className="cn-views">
          {(locked && readOnly ? [] : tabs).map((v) => (
            <button type="button" key={v.id} className={`cn-view-tab ${v.id === view.id ? "on" : ""}`}
              onClick={(e) => (v.id === view.id && !readOnly ? openPop("view")(e) : pick(v.id))}>
              {viewIcon(v.type)}<span>{v.name}</span>{v.id === view.id && !readOnly && <ChevronDown size={12} />}
            </button>
          ))}
          {!readOnly && !locked && <button type="button" className="cn-icon-btn" title={t("Add a view")} onClick={openPop("addview")}><Plus size={15} /></button>}
        </div>
        <div className="cn-db-tools">
          <button type="button" className={`cn-icon-btn ${(view.filters || []).length ? "active" : ""}`} title={t("Filter")} onClick={openPop("filter")}><ListFilter size={16} /></button>
          <button type="button" className={`cn-icon-btn ${(view.sorts || []).length ? "active" : ""}`} title={t("Sort")} onClick={openPop("sort")}><ArrowUpDown size={16} /></button>
          {searchOpen || search ? (
            <span className="cn-db-search"><Search size={14} />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search in this database…")}
                onBlur={() => !search && setSearchOpen(false)} />
              {search && <button type="button" onClick={() => setSearch("")}><X size={13} /></button>}
            </span>
          ) : <button type="button" className="cn-icon-btn" title={t("Search")} onClick={() => setSearchOpen(true)}><Search size={16} /></button>}
          {!readOnly && <button type="button" className="cn-icon-btn" title={t("Properties")} onClick={openPop("props")}><SlidersHorizontal size={16} /></button>}
          {!readOnly && (
            <span className="cn-split">
              <button type="button" className="cn-btn primary sm" onClick={() => onAdd({}, true)}>{t("New")}</button>
              <button type="button" className="cn-btn primary sm" onClick={openPop("new")}><ChevronDown size={14} /></button>
            </span>
          )}
        </div>
      </div>
      {(view.filters || []).length > 0 && !locked && (
        <div className="cn-filter-chips">
          {(view.filters || []).map((f, i) => (
            <button type="button" key={i} className="cn-fchip" onClick={openPop("filter1", i)}>{filterLabel(f, schema)} <ChevronDown size={12} /></button>
          ))}
          {(view.filters || []).length > 1 && (
            <button type="button" className="cn-fchip mode" onClick={() => onView({ ...view, filter_mode: view.filter_mode === "or" ? "and" : "or" })}>
              {view.filter_mode === "or" ? t("Any rule (OR)") : t("All rules (AND)")}
            </button>
          )}
          {!readOnly && <button type="button" className="cn-fchip add" onClick={() => onView({ ...view, filters: [...(view.filters || []), { prop: "__title", op: "contains", value: "" }] })}><Plus size={12} /> {t("Add a filter")}</button>}
        </div>
      )}

      <div className={`cn-view cn-view-${view.type}`}>
        {rows.length === 0 && view.type !== "board" && view.type !== "calendar" && readOnly && <div className="cn-muted pad">{t("This database is empty.")}</div>}
        {view.type === "table" && <TableView {...vp} />}
        {view.type === "board" && <BoardView {...vp} />}
        {view.type === "list" && <ListView {...vp} />}
        {view.type === "gallery" && <GalleryView {...vp} />}
        {view.type === "calendar" && <CalendarView {...vp} />}
      </div>

      {pop?.k === "addview" && (
        <Popover anchor={pop.el} onClose={close} width={220}>
          <MenuLabel>{t("Add a view")}</MenuLabel>
          {VIEW_TYPES.map((v) => <MenuItem key={v.type} icon={viewIcon(v.type, 15)} onClick={() => addView(v.type)}>{t(v.label)}</MenuItem>)}
        </Popover>
      )}
      {pop?.k === "view" && (
        <Popover anchor={pop.el} onClose={close} width={270}>
          <RenameInline value={view.name} onDone={(v) => { if (v.trim() && v !== view.name) onView({ ...view, name: v.trim() }); }} />
          <MenuLabel>{t("Layout")}</MenuLabel>
          <div className="cn-layouts">
            {VIEW_TYPES.map((v) => (
              <button type="button" key={v.type} className={view.type === v.type ? "on" : ""} onClick={() => onView({ ...view, type: v.type })}>
                {viewIcon(v.type, 18)}<span>{t(v.label)}</span>
              </button>
            ))}
          </div>
          {(view.type === "board" || view.type === "gallery") && (
            <div className="pad row"><span className="cn-muted">{t("Group by")}</span>
              <select className="cn-input" value={view.group_by || ""} onChange={(e) => onView({ ...view, group_by: e.target.value })}>
                {view.type === "gallery" && <option value="">{t("None")}</option>}
                {schema.properties.filter((p) => ["select", "status", "multi_select"].includes(p.type)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          )}
          {view.type === "calendar" && (
            <div className="pad row"><span className="cn-muted">{t("Calendar by")}</span>
              <select className="cn-input" value={view.date_prop || ""} onChange={(e) => onView({ ...view, date_prop: e.target.value })}>
                {schema.properties.filter((p) => ["date", "created_time", "edited_time"].includes(p.type)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          )}
          {(view.type === "gallery" || view.type === "board") && (
            <div className="pad row"><span className="cn-muted">{t("Card preview")}</span>
              <select className="cn-input" value={view.card_cover || "cover"} onChange={(e) => onView({ ...view, card_cover: e.target.value as any })}>
                <option value="cover">{t("Cover")}</option><option value="content">{t("Page content")}</option><option value="none">{t("None")}</option>
              </select></div>
          )}
          {view.type === "gallery" && (
            <div className="pad row"><span className="cn-muted">{t("Card size")}</span>
              <select className="cn-input" value={view.card_size || "medium"} onChange={(e) => onView({ ...view, card_size: e.target.value as any })}>
                <option value="small">{t("Small")}</option><option value="medium">{t("Medium")}</option><option value="large">{t("Large")}</option>
              </select></div>
          )}
          {view.type === "table" && (
            <label className="cn-toggle-row pad"><input type="checkbox" checked={!!view.wrap} onChange={(e) => onView({ ...view, wrap: e.target.checked })} /> {t("Wrap cells")}</label>
          )}
          <MenuSep />
          <MenuItem icon={<Copy size={15} />} onClick={() => { const v = { ...view, id: newId(8), name: view.name + " 2" }; persist({ views: [...curViews(), v] }); pick(v.id); close(); }}>{t("Duplicate view")}</MenuItem>
          <MenuItem icon={<Download size={15} />} onClick={() => { location.href = `${BASE}/api/pages/${dbId}/export.csv`; close(); }}>{t("Export as CSV")}</MenuItem>
          {views.length > 1 && !locked && <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { removeView(view.id); close(); }}>{t("Delete view")}</MenuItem>}
        </Popover>
      )}
      {pop?.k === "filter" && (
        <Popover anchor={pop.el} onClose={close} width={340}>
          {(view.filters || []).map((f, i) => (
            <FilterEditor key={i} f={f} schema={schema} onChange={(nf) => onView({ ...view, filters: (view.filters || []).map((x, j) => (j === i ? nf : x)) })}
              onDelete={() => onView({ ...view, filters: (view.filters || []).filter((_, j) => j !== i) })} />
          ))}
          <div className="pad"><button type="button" className="cn-btn ghost sm" onClick={() => onView({ ...view, filters: [...(view.filters || []), { prop: "__title", op: "contains", value: "" }] })}><Plus size={14} /> {t("Add a filter")}</button></div>
        </Popover>
      )}
      {pop?.k === "filter1" && pop.i !== undefined && (view.filters || [])[pop.i] && (
        <Popover anchor={pop.el} onClose={close} width={340}>
          <FilterEditor f={(view.filters || [])[pop.i]} schema={schema}
            onChange={(nf) => onView({ ...view, filters: (view.filters || []).map((x, j) => (j === pop.i ? nf : x)) })}
            onDelete={() => { onView({ ...view, filters: (view.filters || []).filter((_, j) => j !== pop.i) }); close(); }} />
        </Popover>
      )}
      {pop?.k === "sort" && <Popover anchor={pop.el} onClose={close} width={340}><SortEditor view={view} schema={schema} onView={onView} /></Popover>}
      {pop?.k === "props" && <Popover anchor={pop.el} onClose={close} width={260}><VisibilityEditor view={view} schema={schema} onView={onView} onSchema={onSchema} /></Popover>}
      {pop?.k === "new" && (
        <Popover anchor={pop.el} onClose={close} width={260} placement="bottom-end">
          <MenuLabel>{t("Templates")}</MenuLabel>
          <MenuItem icon={<FileText size={15} />} onClick={() => { onAdd({}, true); close(); }}>{t("Empty page")}</MenuItem>
          {templates.map((tp) => (
            <MenuItem key={tp.id} icon={<span>{tp.icon || "📄"}</span>} onClick={() => { onAdd({}, true, tp.id); close(); }}
              right={<button type="button" className="cn-icon-btn" onClick={(e) => { e.stopPropagation(); app.setPeek(tp.id); close(); }}>✎</button>}>
              {tp.title || t("Untitled")}
            </MenuItem>
          ))}
          <MenuSep />
          <MenuItem icon={<Plus size={15} />} onClick={async () => {
            const r = await api.post(`/api/databases/${dbId}/rows`, { title: "", is_template: true });
            await load();
            app.setPeek(r.id);
            close();
          }}>{t("New")} ({t("Templates").toLowerCase()})</MenuItem>
        </Popover>
      )}
    </div>
    {rowSel.layer}
    </RowSelCtx.Provider>
  );
}
