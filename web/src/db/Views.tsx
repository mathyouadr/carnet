import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, FileText } from "lucide-react";
import type { Property, Row, Schema, View } from "../api";
import { useApp } from "../app/store";
import { LANG, t } from "../i18n";
import { Popover } from "../ui/Popover";
import { coverStyle } from "../ui/Pickers";
import { OpenButton, PropValue, ValueView } from "./Cell";
import { AddProperty, PropertyMenu } from "./Menus";
import { isEmpty, newId, OPTION_COLORS, TITLE, today, typeIcon, valueOf } from "./model";

export type ViewProps = {
  rows: Row[]; schema: Schema; view: View; readOnly: boolean;
  onRow: (id: string, patch: { title?: string; props?: Record<string, any> }) => void;
  onAdd: (props?: Record<string, any>, open?: boolean) => Promise<Row | null>;
  onSchema: (s: Schema) => void; onView: (v: View) => void; open: (id: string) => void;
};

function visibleProps(schema: Schema, view: View): Property[] {
  const hidden = new Set(view.hidden || []);
  const order = view.order || [];
  const props = schema.properties.filter((p) => !hidden.has(p.id));
  return [...props].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
  });
}

function TitleCell({ row, readOnly, onDone, autoEdit, open }: { row: Row; readOnly: boolean; onDone: (v: string) => void; autoEdit?: boolean; open: () => void }) {
  const [edit, setEdit] = useState(!!autoEdit);
  if (edit && !readOnly) {
    return (
      <div className="cn-pv editing cell title">
        <input autoFocus defaultValue={row.title} onBlur={(e) => { setEdit(false); if (e.target.value !== row.title) onDone(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(false); }} />
      </div>
    );
  }
  return (
    <div className="cn-pv cell title" onClick={() => (readOnly ? open() : setEdit(true))}>
      <span className="ic">{row.icon || (row.has_content ? <FileText size={14} /> : null)}</span>
      <span className="tx">{row.title || <span className="cn-placeholder">{t("Untitled")}</span>}</span>
      <OpenButton onClick={open} />
    </div>
  );
}

// ================================================================== table
export function TableView({ rows, schema, view, readOnly, onRow, onAdd, onSchema, onView, open }: ViewProps) {
  const props = visibleProps(schema, view);
  const [menu, setMenu] = useState<{ el: HTMLElement; prop: Property | null; title?: boolean } | null>(null);
  const [addEl, setAddEl] = useState<HTMLElement | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const widths = view.widths || {};
  const drag = useRef<{ id: string; x: number; w: number } | null>(null);
  const [liveW, setLiveW] = useState<Record<string, number>>({});
  const w = (id: string) => liveW[id] ?? widths[id] ?? (id === TITLE ? 260 : 180);
  const startResize = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { id, x: e.clientX, w: w(id) };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      setLiveW((m) => ({ ...m, [id]: Math.max(80, drag.current!.w + ev.clientX - drag.current!.x) }));
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (drag.current) onView({ ...view, widths: { ...widths, [id]: Math.max(80, drag.current.w + ev.clientX - drag.current.x) } });
      drag.current = null;
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const total = w(TITLE) + props.reduce((s, p) => s + w(p.id), 0) + 40;
  return (
    <div className="cn-table-wrap">
      <div className={`cn-table ${view.wrap ? "wrap" : ""}`} style={{ minWidth: total }}>
        <div className="cn-tr head">
          <div className="cn-th" style={{ width: w(TITLE) }} onClick={(e) => !readOnly && setMenu({ el: e.currentTarget, prop: null, title: true })}>
            {typeIcon("title")}<span>{schema.title_name}</span>
            {!readOnly && <i className="cn-resize" onPointerDown={startResize(TITLE)} onClick={(e) => e.stopPropagation()} />}
          </div>
          {props.map((p) => (
            <div key={p.id} className="cn-th" style={{ width: w(p.id) }} onClick={(e) => !readOnly && setMenu({ el: e.currentTarget, prop: p })}>
              {typeIcon(p.type)}<span>{p.name}</span>
              {!readOnly && <i className="cn-resize" onPointerDown={startResize(p.id)} onClick={(e) => e.stopPropagation()} />}
            </div>
          ))}
          {!readOnly && <div className="cn-th add" onClick={(e) => setAddEl(e.currentTarget)}><Plus size={15} /></div>}
        </div>
        {rows.map((r) => (
          <div key={r.id} className="cn-tr">
            <div className="cn-td" style={{ width: w(TITLE) }}>
              <TitleCell row={r} readOnly={readOnly} autoEdit={fresh === r.id} open={() => open(r.id)} onDone={(v) => { setFresh(null); onRow(r.id, { title: v }); }} />
            </div>
            {props.map((p) => (
              <div key={p.id} className="cn-td" style={{ width: w(p.id) }}>
                <PropValue prop={p} row={r} schema={schema} readOnly={readOnly}
                  onChange={(v) => onRow(r.id, { props: { [p.id]: v } })}
                  onSchema={(np) => onSchema({ ...schema, properties: schema.properties.map((x) => (x.id === np.id ? np : x)) })} />
              </div>
            ))}
          </div>
        ))}
        {!readOnly && (
          <div className="cn-tr add" onClick={async () => { const r = await onAdd(presetFromFilters(view, schema), false); if (r) setFresh(r.id); }}>
            <Plus size={15} /> {t("New")}
          </div>
        )}
        <div className="cn-tfoot">{rows.length} {t("rows")}</div>
      </div>
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} width={260}>
          <PropertyMenu prop={menu.prop} isTitle={menu.title} schema={schema} view={view} onSchema={onSchema} onView={onView} onClose={() => setMenu(null)} />
        </Popover>
      )}
      {addEl && <Popover anchor={addEl} onClose={() => setAddEl(null)} width={240} placement="bottom-end"><AddProperty schema={schema} onSchema={onSchema} onClose={() => setAddEl(null)} /></Popover>}
    </div>
  );
}

/** New rows created while a view is filtered get the filtered values (like Notion). */
export function presetFromFilters(view: View, schema: Schema): Record<string, any> {
  const out: Record<string, any> = {};
  if (view.filter_mode === "or") return out;
  for (const f of view.filters || []) {
    const p = schema.properties.find((x) => x.id === f.prop);
    if (!p || f.value === undefined || f.value === "") continue;
    if ((p.type === "select" || p.type === "status") && f.op === "is") out[p.id] = f.value;
    if (p.type === "multi_select" && f.op === "contains") out[p.id] = [f.value];
    if (p.type === "relation" && f.op === "contains") out[p.id] = [f.value];
    if (p.type === "checkbox") out[p.id] = f.op === "checked";
    if (p.type === "date" && f.op === "is") out[p.id] = { start: f.value === "today" ? today() : f.value };
    if ((p.type === "text" || p.type === "url") && f.op === "is") out[p.id] = f.value;
  }
  for (const f of view.filters || []) {
    const p = schema.properties.find((x) => x.id === f.prop);
    if (p?.type === "checkbox" && f.op === "checked") out[p.id] = true;
  }
  return out;
}

// ================================================================== card (board & gallery)
function Card({ row, schema, view, open, cover, draggable, onDragStart }: {
  row: Row; schema: Schema; view: View; open: () => void; cover?: boolean; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
}) {
  // on cards, an unticked checkbox says nothing: show it only when ticked (with its name)
  const props = visibleProps(schema, view).filter((p) => p.id !== view.group_by && !isEmpty(valueOf(row, p.id, schema))
    && !(p.type === "checkbox" && !valueOf(row, p.id, schema)));
  const mode = view.card_cover || "cover";
  return (
    <div className="cn-card" onClick={open} draggable={draggable} onDragStart={onDragStart}>
      {cover && mode === "cover" && row.cover && <div className="cn-card-cover" style={coverStyle(row.cover)} />}
      {cover && mode === "content" && <div className="cn-card-preview">{row.preview}</div>}
      <div className="cn-card-body">
        <div className="cn-card-title">{row.icon && <span className="ic">{row.icon}</span>}{row.title || <span className="cn-placeholder">{t("Untitled")}</span>}</div>
        {props.map((p) => <div key={p.id} className="cn-card-prop"><ValueView prop={p} value={valueOf(row, p.id, schema)} compact />{p.type === "checkbox" && <span className="cn-muted"> {p.name}</span>}</div>)}
      </div>
    </div>
  );
}

// ================================================================== board
export function BoardView({ rows, schema, view, readOnly, onRow, onAdd, onSchema, onView, open }: ViewProps) {
  const groupable = schema.properties.filter((p) => p.type === "select" || p.type === "status" || p.type === "multi_select");
  const gp = schema.properties.find((p) => p.id === view.group_by) || groupable[0];
  const [over, setOver] = useState<string | null>(null);
  const [newCol, setNewCol] = useState<HTMLElement | null>(null);
  if (!gp) {
    return (
      <div className="cn-empty-view">
        <p>{t("Group by")}…</p>
        {!readOnly && (
          <button type="button" className="cn-btn primary" onClick={() => {
            const p: Property = { id: newId(), name: t("Status"), type: "status", options: [
              { id: newId(), name: t("To do"), color: "gray", group: "todo" },
              { id: newId(), name: t("In progress"), color: "blue", group: "doing" },
              { id: newId(), name: t("Done"), color: "green", group: "done" }] };
            onSchema({ ...schema, properties: [...schema.properties, p] });
            onView({ ...view, group_by: p.id });
          }}><Plus size={14} /> {t("Status")}</button>
        )}
      </div>
    );
  }
  const groups: { id: string; name: string; color: string }[] = [
    { id: "", name: `${t("No")} ${gp.name}`, color: "default" },
    ...(gp.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
  ];
  const inGroup = (r: Row, gid: string) => {
    const v = r.props?.[gp.id];
    if (gp.type === "multi_select") return gid ? (v || []).includes(gid) : !(v || []).length;
    return gid ? v === gid : !v;
  };
  const drop = (gid: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/carnet-row");
    if (!id || readOnly) return;
    const r = rows.find((x) => x.id === id);
    if (!r || inGroup(r, gid)) return;
    const v = gp.type === "multi_select" ? (gid ? [gid] : []) : gid || null;
    onRow(id, { props: { [gp.id]: v } });
  };
  return (
    <div className="cn-board">
      {groups.map((g) => {
        const items = rows.filter((r) => inGroup(r, g.id));
        if (!g.id && !items.length) return null;
        return (
          <div key={g.id || "none"} className={`cn-col ${over === g.id ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(g.id); }} onDragLeave={() => setOver(null)} onDrop={drop(g.id)}>
            <div className="cn-col-head"><span className={`cn-chip c-${g.color}`}>{g.name}</span><span className="cn-muted">{items.length}</span></div>
            {items.map((r) => (
              <Card key={r.id} row={r} schema={schema} view={view} open={() => open(r.id)} cover draggable={!readOnly}
                onDragStart={(e) => { e.dataTransfer.setData("text/carnet-row", r.id); e.dataTransfer.effectAllowed = "move"; }} />
            ))}
            {!readOnly && (
              <button type="button" className="cn-col-add" onClick={() => onAdd({ ...presetFromFilters(view, schema), ...(g.id ? { [gp.id]: gp.type === "multi_select" ? [g.id] : g.id } : {}) }, true)}>
                <Plus size={14} /> {t("New")}
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && gp.type !== "status" && (
        <div className="cn-col ghost">
          <button type="button" className="cn-col-add" onClick={(e) => setNewCol(e.currentTarget)}><Plus size={14} /> {t("Add an option")}</button>
          {newCol && (
            <Popover anchor={newCol} onClose={() => setNewCol(null)} width={220}>
              <div className="pad"><input className="cn-input" autoFocus placeholder={t("Name")} onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const name = (e.target as HTMLInputElement).value.trim();
                if (!name) return;
                const o = { id: newId(), name, color: OPTION_COLORS[(gp.options || []).length % OPTION_COLORS.length] };
                onSchema({ ...schema, properties: schema.properties.map((p) => (p.id === gp.id ? { ...p, options: [...(p.options || []), o] } : p)) });
                setNewCol(null);
              }} /></div>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}

// ================================================================== list
export function ListView({ rows, schema, view, readOnly, onAdd, open }: ViewProps) {
  const props = visibleProps(schema, view);
  return (
    <div className="cn-list">
      {rows.map((r) => (
        <div key={r.id} className="cn-list-row" onClick={() => open(r.id)}>
          <span className="ic">{r.icon || <FileText size={15} />}</span>
          <span className="tx">{r.title || <span className="cn-placeholder">{t("Untitled")}</span>}</span>
          <span className="props">{props.filter((p) => !isEmpty(valueOf(r, p.id, schema))).slice(0, 4).map((p) => <ValueView key={p.id} prop={p} value={valueOf(r, p.id, schema)} compact />)}</span>
        </div>
      ))}
      {!readOnly && <div className="cn-list-row add" onClick={() => onAdd(presetFromFilters(view, schema), true)}><Plus size={15} /> {t("New")}</div>}
    </div>
  );
}

// ================================================================== gallery
export function GalleryView({ rows, schema, view, readOnly, onAdd, open }: ViewProps) {
  const gp = view.group_by ? schema.properties.find((p) => p.id === view.group_by && ["select", "status", "multi_select"].includes(p.type)) : undefined;
  const [closed, setClosed] = useState<string[]>(view.collapsed || []);
  const grid = (list: Row[], preset: Record<string, any>) => (
    <div className={`cn-gallery ${view.card_size || "medium"}`}>
      {!list.length && readOnly && <div className="cn-muted cn-gal-empty">{t("Nothing here yet")}</div>}
      {list.map((r) => <Card key={r.id} row={r} schema={schema} view={view} open={() => open(r.id)} cover />)}
      {!readOnly && <button type="button" className="cn-card add" onClick={() => onAdd({ ...presetFromFilters(view, schema), ...preset }, true)}><Plus size={16} /> {t("New")}</button>}
    </div>
  );
  if (!gp) return grid(rows, {});
  const inGroup = (r: Row, gid: string) => {
    const val = r.props?.[gp.id];
    if (gp.type === "multi_select") return gid ? (val || []).includes(gid) : !(val || []).length;
    return gid ? val === gid : !val;
  };
  const groups = [...(gp.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
    { id: "", name: `${t("No")} ${gp.name}`, color: "default" }]
    .map((g) => ({ ...g, rows: rows.filter((r) => inGroup(r, g.id)) }))
    .filter((g) => g.rows.length || ((view as any).show_empty && g.id));
  return (
    <div className="cn-gal-groups">
      {groups.map((g) => {
        const shut = closed.includes(g.id);
        return (
          <section key={g.id || "_none"} className="cn-gal-group">
            <button type="button" className="cn-gal-head" onClick={() => setClosed(shut ? closed.filter((x) => x !== g.id) : [...closed, g.id])}>
              <ChevronRight size={15} className={shut ? "" : "open"} />
              <span className={`cn-chip c-${g.color}`}>{g.name}</span>
              <span className="cn-muted">{g.rows.length}</span>
            </button>
            {!shut && grid(g.rows, g.id ? { [gp.id]: gp.type === "multi_select" ? [g.id] : g.id } : {})}
          </section>
        );
      })}
    </div>
  );
}

// ================================================================== calendar
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarView({ rows, schema, view, readOnly, onRow, onAdd, onSchema, onView, open }: ViewProps) {
  const app = useApp();
  const dateProps = schema.properties.filter((p) => p.type === "date" || p.type === "created_time" || p.type === "edited_time");
  const dp = schema.properties.find((p) => p.id === view.date_prop) || dateProps[0];
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selDay, setSelDay] = useState<string>(today());
  const [over, setOver] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    if (!dp) return m;
    for (const r of rows) {
      const v = valueOf(r, dp.id, schema);
      if (!v) continue;
      const startS = typeof v === "string" ? ymd(new Date(v)) : (v.start || "").slice(0, 10);
      const endS = typeof v === "string" ? startS : (v.end || v.start || "").slice(0, 10);
      if (!startS) continue;
      const d = new Date(startS + "T00:00:00"), end = new Date(endS + "T00:00:00");
      for (let i = 0; i < 62 && d <= end; i++) {
        const k = ymd(d);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
        d.setDate(d.getDate() + 1);
      }
    }
    return m;
  }, [rows, dp, schema]);
  if (!dp) {
    return (
      <div className="cn-empty-view">
        <p>{t("Calendar by")}…</p>
        {!readOnly && <button type="button" className="cn-btn primary" onClick={() => {
          const p: Property = { id: newId(), name: t("Date"), type: "date" };
          onSchema({ ...schema, properties: [...schema.properties, p] });
          onView({ ...view, date_prop: p.id });
        }}><Plus size={14} /> {t("Date")}</button>}
      </div>
    );
  }
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7;                 // weeks start on Monday
  const start = new Date(first);
  start.setDate(1 - offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  const weeks = days[35].getMonth() !== month.getMonth() ? 5 : 6;
  const label = month.toLocaleDateString(LANG === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" });
  const wd = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(LANG === "fr" ? "fr-FR" : "en-US", { weekday: "short" }));
  const editable = !readOnly && dp.type === "date";
  const moveTo = (id: string, day: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const v = r.props?.[dp.id] || {};
    const time = (v.start || "").slice(10);
    let end = v.end;
    if (end && v.start) {
      const delta = (new Date(day).getTime() - new Date(v.start.slice(0, 10)).getTime()) / 864e5;
      const e = new Date(end.slice(0, 10) + "T00:00:00");
      e.setDate(e.getDate() + delta);
      end = ymd(e) + end.slice(10);
    }
    onRow(id, { props: { [dp.id]: { start: day + time, ...(end ? { end } : {}) } } });
  };
  const sel = byDay.get(selDay) || [];
  return (
    <div className="cn-cal">
      <div className="cn-cal-head">
        <strong className="cn-cal-month">{label}</strong>
        <span className="grow" />
        <button type="button" className="cn-btn sm ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelDay(today()); }}>{t("Today")}</button>
        <button type="button" className="cn-icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <button type="button" className="cn-icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="cn-cal-grid">
        {wd.map((d) => <div key={d} className="cn-cal-wd">{d}</div>)}
        {days.slice(0, weeks * 7).map((d) => {
          const k = ymd(d);
          const items = byDay.get(k) || [];
          return (
            <div key={k} className={`cn-cal-day ${d.getMonth() !== month.getMonth() ? "out" : ""} ${k === today() ? "today" : ""} ${k === selDay ? "sel" : ""} ${over === k ? "over" : ""}`}
              onClick={() => setSelDay(k)}
              onDragOver={(e) => { if (editable) { e.preventDefault(); setOver(k); } }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/carnet-row"); if (id) moveTo(id, k); }}>
              <div className="cn-cal-num"><span className="n">{d.getDate()}</span>
                {editable && <button type="button" className="cn-cal-add" onClick={(e) => { e.stopPropagation(); onAdd({ ...presetFromFilters(view, schema), [dp.id]: { start: k } }, true); }}><Plus size={12} /></button>}
              </div>
              <div className="cn-cal-items">
                {items.slice(0, app.mobile ? 3 : 4).map((r) => (
                  <div key={r.id} className="cn-cal-ev" draggable={editable} onClick={(e) => { e.stopPropagation(); open(r.id); }}
                    onDragStart={(e) => { e.dataTransfer.setData("text/carnet-row", r.id); }}>
                    {app.mobile ? "" : <>{r.icon ? r.icon + " " : ""}{r.title || t("Untitled")}</>}
                  </div>
                ))}
                {items.length > (app.mobile ? 3 : 4) && <div className="cn-cal-more">+{items.length - (app.mobile ? 3 : 4)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {app.mobile && (
        <div className="cn-cal-daylist">
          {sel.map((r) => <div key={r.id} className="cn-list-row" onClick={() => open(r.id)}><span className="ic">{r.icon || <FileText size={15} />}</span><span className="tx">{r.title || t("Untitled")}</span></div>)}
          {!sel.length && <div className="cn-muted pad">{t("No results")}</div>}
          {editable && <div className="cn-list-row add" onClick={() => onAdd({ ...presetFromFilters(view, schema), [dp.id]: { start: selDay } }, true)}><Plus size={15} /> {t("New")}</div>}
        </div>
      )}
      {rows.filter((r) => !valueOf(r, dp.id, schema)).length > 0 && (
        <details className="cn-cal-nodate">
          <summary>{t("No date")} ({rows.filter((r) => !valueOf(r, dp.id, schema)).length})</summary>
          {rows.filter((r) => !valueOf(r, dp.id, schema)).map((r) => (
            <div key={r.id} className="cn-cal-ev" draggable={editable} onClick={() => open(r.id)} onDragStart={(e) => e.dataTransfer.setData("text/carnet-row", r.id)}>
              {r.icon ? r.icon + " " : ""}{r.title || t("Untitled")}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
