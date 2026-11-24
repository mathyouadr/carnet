import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Trash2, X, Plus, ArrowUpRight } from "lucide-react";
import type { Option, Property, Row, Schema } from "../api";
import { useApp } from "../app/store";
import { fmtDate, fmtStamp, t } from "../i18n";
import { MenuItem, MenuSep, Popover } from "../ui/Popover";
import { asList, fmtNumber, newId, OPTION_COLORS, today, valueOf } from "./model";
import { safeHref } from "../safe";

export function Chip({ o, onRemove }: { o?: Option; onRemove?: () => void }) {
  if (!o) return null;
  return (
    <span className={`cn-chip c-${o.color || "default"}`}>
      {o.name}
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }}><X size={11} /></button>}
    </span>
  );
}

/** Read-only display of a value. */
export function ValueView({ prop, value, compact }: { prop: Property; value: any; compact?: boolean }) {
  const app = useApp();
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return null;
  switch (prop.type) {
    case "select": case "status": return <Chip o={prop.options?.find((o) => o.id === value)} />;
    case "multi_select": return <span className="cn-chips">{asList(value).map((id) => <Chip key={id} o={prop.options?.find((o) => o.id === id)} />)}</span>;
    case "checkbox": return <span className={`cn-check ${value ? "on" : ""}`}>{value && <Check size={12} strokeWidth={3} />}</span>;
    case "date": {
      // a value converted from another type may be a bare string: show it as it is
      if (typeof value === "string") return <span>{fmtDate(value)}</span>;
      return <span>{fmtDate(value?.start)}{value?.end ? " → " + fmtDate(value.end) : ""}</span>;
    }
    case "created_time": case "edited_time": return <span className="cn-muted">{fmtStamp(String(value))}</span>;
    case "number": return <span className="num">{fmtNumber(value, prop.format)}</span>;
    case "url": { const href = safeHref(value); if (!href) return <span className="cn-text">{String(value)}</span>;
      return <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="cn-link">{compact ? String(value).replace(/^https?:\/\/(www\.)?/, "") : value}</a>; }
    case "email": return <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} className="cn-link">{value}</a>;
    case "phone": return <a href={`tel:${value}`} onClick={(e) => e.stopPropagation()} className="cn-link">{value}</a>;
    case "relation": return (
      <span className="cn-chips">{asList(value).map((id: string) => {
        const p = app.byId.get(id);
        return p ? <a key={id} className="cn-rel" onClick={(e) => { e.stopPropagation(); app.setPeek(id); }}>{p.icon || "📄"} {p.title || t("Untitled")}</a> : null;
      })}</span>
    );
    default: return <span className="cn-text">{String(value)}</span>;
  }
}

// ------------------------------------------------------------------ option picker (select, multi, status)
export function OptionPicker({ prop, value, multi, onChange, onSchema }: {
  prop: Property; value: any; multi: boolean; onChange: (v: any) => void; onSchema: (p: Property) => void;
}) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ o: Option; el: HTMLElement } | null>(null);
  const opts = prop.options || [];
  const sel: string[] = multi ? asList(value) : value ? [value] : [];
  const shown = opts.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const exact = opts.find((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const pick = (id: string) => {
    if (multi) onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else onChange(sel[0] === id ? null : id);
    setQ("");
  };
  const create = () => {
    const name = q.trim();
    if (!name) return;
    if (exact) return pick(exact.id);
    const o: Option = { id: newId(), name, color: OPTION_COLORS[opts.length % OPTION_COLORS.length] };
    onSchema({ ...prop, options: [...opts, o] });
    pick(o.id);
  };
  const updOpt = (o: Option) => onSchema({ ...prop, options: opts.map((x) => (x.id === o.id ? o : x)) });
  return (
    <div className="cn-optpick">
      <div className="cn-optpick-top">
        {sel.map((id) => <Chip key={id} o={opts.find((o) => o.id === id)} onRemove={() => pick(id)} />)}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search or create an option…")}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (shown.length === 1 && !q.trim().length) pick(shown[0].id); else create(); } }} />
      </div>
      <div className="cn-optpick-list">
        {shown.map((o) => (
          <div key={o.id} className={`cn-optrow ${sel.includes(o.id) ? "on" : ""}`} onClick={() => pick(o.id)}>
            <Chip o={o} />
            <span className="grow" />
            {sel.includes(o.id) && <Check size={14} />}
            <button type="button" className="cn-icon-btn" onClick={(e) => { e.stopPropagation(); setEdit({ o, el: e.currentTarget }); }}><MoreHorizontal size={14} /></button>
          </div>
        ))}
        {q.trim() && !exact && (
          <div className="cn-optrow create" onClick={create}><Plus size={14} /> {t("Create")} <Chip o={{ id: "", name: q.trim(), color: OPTION_COLORS[opts.length % OPTION_COLORS.length] }} /></div>
        )}
      </div>
      {edit && (
        <Popover anchor={edit.el} onClose={() => setEdit(null)} placement="right-start" width={220}>
          <div className="pad">
            <input className="cn-input" defaultValue={edit.o.name} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== edit.o.name) updOpt({ ...edit.o, name }); }} />
          </div>
          <MenuItem danger icon={<Trash2 size={15} />} onClick={() => {
            onSchema({ ...prop, options: opts.filter((x) => x.id !== edit.o.id) });
            if (sel.includes(edit.o.id)) onChange(multi ? sel.filter((x) => x !== edit.o.id) : null);
            setEdit(null);
          }}>{t("Delete")}</MenuItem>
          <MenuSep />
          {[...OPTION_COLORS, "default"].map((c) => (
            <MenuItem key={c} active={edit.o.color === c} icon={<span className={`cn-swatch-sq c-${c}`} />}
              onClick={() => { updOpt({ ...edit.o, color: c }); setEdit({ ...edit, o: { ...edit.o, color: c } }); }}>
              {t(c[0].toUpperCase() + c.slice(1) === "Default" ? "Default" : c[0].toUpperCase() + c.slice(1))}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ date picker
export function DatePicker({ prop, value, onChange }: { prop: Property; value: any; onChange: (v: any) => void }) {
  const [time, setTime] = useState<boolean>(!!(value?.start?.length > 10) || !!prop.time);
  const [range, setRange] = useState<boolean>(!!value?.end);
  const start = value?.start || "";
  const end = value?.end || "";
  const norm = (v: string) => (time ? (v.length === 10 ? v + "T09:00" : v.slice(0, 16)) : v.slice(0, 10));
  const set = (s: string, e: string) => onChange(s ? { start: s, ...(range && e ? { end: e } : {}) } : null);
  return (
    <div className="cn-datepick pad">
      <input className="cn-input" type={time ? "datetime-local" : "date"} value={norm(start)} autoFocus
        onChange={(e) => set(e.target.value, end)} />
      {range && <input className="cn-input" type={time ? "datetime-local" : "date"} value={norm(end)} onChange={(e) => set(start, e.target.value)} />}
      <label className="cn-toggle-row"><input type="checkbox" checked={range} onChange={(e) => { setRange(e.target.checked); if (!e.target.checked && start) onChange({ start }); }} /> {t("End date")}</label>
      <label className="cn-toggle-row"><input type="checkbox" checked={time} onChange={(e) => {
        setTime(e.target.checked);
        if (start) onChange({ start: e.target.checked ? (start.length === 10 ? start + "T09:00" : start) : start.slice(0, 10), ...(end ? { end: e.target.checked ? end : end.slice(0, 10) } : {}) });
      }} /> {t("Include time")}</label>
      <div className="row">
        <button type="button" className="cn-btn sm" onClick={() => set(time ? today() + "T" + new Date().toTimeString().slice(0, 5) : today(), end)}>{t("Today")}</button>
        <span className="grow" />
        <button type="button" className="cn-btn sm ghost" onClick={() => onChange(null)}>{t("Clear")}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ relation picker
export function RelationPicker({ prop, value, onChange }: { prop: Property; value: any; onChange: (v: any) => void }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const sel: string[] = asList(value);
  const target = prop.database_id;
  const cands = app.tree.filter((p) => (target ? p.parent_id === target : p.kind === "page" && !p.is_template) &&
    (p.title || "").toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <div className="cn-optpick">
      <div className="cn-optpick-top"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search pages…")} /></div>
      <div className="cn-optpick-list">
        {cands.map((p) => (
          <div key={p.id} className={`cn-optrow ${sel.includes(p.id) ? "on" : ""}`}
            onClick={() => onChange(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>
            <span>{p.icon || "📄"}</span><span className="grow">{p.title || t("Untitled")}</span>{sel.includes(p.id) && <Check size={14} />}
          </div>
        ))}
        {target && q.trim() && (
          <div className="cn-optrow create" onClick={async () => {
            const np = await app.createPage({ parent_id: target, title: q.trim() }, false);
            onChange([...sel, np.id]);
            setQ("");
          }}><Plus size={14} /> {t("New")} « {q.trim()} »</div>
        )}
        {!cands.length && !q && <div className="cn-muted pad">{t("No results")}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editable value (cells & properties panel)
export function PropValue({ prop, row, schema, onChange, onSchema, readOnly, mode = "cell", autoEdit }: {
  prop: Property; row: Row; schema: Schema; onChange: (v: any) => void; onSchema: (p: Property) => void;
  readOnly?: boolean; mode?: "cell" | "panel"; autoEdit?: boolean;
}) {
  const value = valueOf(row, prop.id, schema);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(!!autoEdit);
  const ref = useRef<HTMLDivElement>(null);
  const computed = prop.type === "created_time" || prop.type === "edited_time";
  const inline = ["text", "number", "url", "email", "phone"].includes(prop.type);

  if (prop.type === "checkbox") {
    return (
      <div className={`cn-pv ${mode}`} onClick={() => !readOnly && onChange(!value)}>
        <span className={`cn-check ${value ? "on" : ""} ${readOnly ? "" : "clickable"}`}>{value && <Check size={12} strokeWidth={3} />}</span>
      </div>
    );
  }
  if (inline && editing && !readOnly) {
    return <InlineInput prop={prop} value={value} mode={mode} onDone={(v) => { setEditing(false); if (v !== (value ?? "")) onChange(v === "" ? null : prop.type === "number" ? Number(String(v).replace(",", ".")) : v); }} />;
  }
  return (
    <div ref={ref} className={`cn-pv ${mode} ${readOnly || computed ? "ro" : ""}`} tabIndex={readOnly || computed ? -1 : 0}
      onClick={(e) => {
        if (readOnly || computed) return;
        if ((e.target as HTMLElement).closest("a")) return;
        if (inline) setEditing(true);
        else setAnchor(e.currentTarget);
      }}
      onKeyDown={(e) => { if (e.key === "Enter" && !readOnly && !computed) { if (inline) setEditing(true); else setAnchor(e.currentTarget); } }}>
      <ValueView prop={prop} value={value} compact={mode === "cell"} />
      {(value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) && mode === "panel" && <span className="cn-placeholder">{t("Empty")}</span>}
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={prop.type === "date" ? 260 : 280} offset={-anchor.offsetHeight}>
          {(prop.type === "select" || prop.type === "status" || prop.type === "multi_select") && (
            <OptionPicker prop={prop} value={value} multi={prop.type === "multi_select"} onSchema={onSchema}
              onChange={(v) => { onChange(v); if (prop.type !== "multi_select") setAnchor(null); }} />
          )}
          {prop.type === "date" && <DatePicker prop={prop} value={value} onChange={onChange} />}
          {prop.type === "relation" && <RelationPicker prop={prop} value={value} onChange={onChange} />}
        </Popover>
      )}
    </div>
  );
}

function InlineInput({ prop, value, onDone, mode }: { prop: Property; value: any; onDone: (v: string) => void; mode: string }) {
  const [v, setV] = useState(value === undefined || value === null ? "" : String(value));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const grow = useMemo(() => () => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, []);
  useEffect(grow, [v, grow]);
  return (
    <div className={`cn-pv editing ${mode}`}>
      <textarea ref={ref} rows={1} value={v} inputMode={prop.type === "number" ? "decimal" : prop.type === "email" ? "email" : prop.type === "phone" ? "tel" : prop.type === "url" ? "url" : "text"}
        onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onDone(v.trim()); }
          if (e.key === "Escape") { e.preventDefault(); onDone(value === undefined || value === null ? "" : String(value)); }
        }} />
    </div>
  );
}

export function OpenButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return <button type="button" className="cn-open-btn" onClick={(e) => { e.stopPropagation(); onClick(e); }}><ArrowUpRight size={12} /> {t("Open")}</button>;
}
