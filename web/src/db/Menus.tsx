import { useState } from "react";
import { ArrowDown, ArrowUp, EyeOff, Trash2, Filter as FilterIcon, ChevronRight, Plus, Pencil } from "lucide-react";
import type { Filter, Property, PropType, Schema, Sort, View } from "../api";
import { useApp } from "../app/store";
import { t } from "../i18n";
import { MenuItem, MenuLabel, MenuSep, Popover } from "../ui/Popover";
import { defaultStatusOptions, newId, opsFor, TITLE, TYPES, typeIcon } from "./model";
import { Chip } from "./Cell";

/** Header menu of a property: rename, change type, options, sort, filter, hide, delete. */
export function PropertyMenu({ prop, schema, view, onSchema, onView, onClose, isTitle }: {
  prop: Property | null; schema: Schema; view: View; onSchema: (s: Schema) => void; onView: (v: View) => void;
  onClose: () => void; isTitle?: boolean;
}) {
  const app = useApp();
  const [typeOpen, setTypeOpen] = useState<HTMLElement | null>(null);
  const [relOpen, setRelOpen] = useState<HTMLElement | null>(null);
  const pid = isTitle ? TITLE : prop!.id;
  const name = isTitle ? schema.title_name : prop!.name;
  const rename = (v: string) => {
    const n = v.trim();
    if (!n || n === name) return;
    onSchema(isTitle ? { ...schema, title_name: n } : { ...schema, properties: schema.properties.map((p) => (p.id === pid ? { ...p, name: n } : p)) });
  };
  const upd = (patch: Partial<Property>) => onSchema({ ...schema, properties: schema.properties.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });
  const sort = (dir: "asc" | "desc") => { onView({ ...view, sorts: [{ prop: pid, dir }, ...(view.sorts || []).filter((s) => s.prop !== pid)] }); onClose(); };
  const databases = app.tree.filter((p) => p.kind === "database");
  return (
    <div className="cn-propmenu">
      <div className="pad">
        <input className="cn-input" defaultValue={name} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { rename((e.target as HTMLInputElement).value); onClose(); } }}
          onBlur={(e) => rename(e.target.value)} />
      </div>
      {!isTitle && prop && (
        <>
          <MenuItem icon={typeIcon(prop.type, 15)} right={<ChevronRight size={14} />} onClick={(e) => setTypeOpen(e.currentTarget as HTMLElement)}>
            {t("Type")}: {t(TYPES.find((x) => x.type === prop.type)?.label || "")}
          </MenuItem>
          {prop.type === "number" && (
            <div className="pad row"><span className="cn-muted">{t("Format")}</span>
              <select className="cn-input" value={prop.format || "number"} onChange={(e) => upd({ format: e.target.value })}>
                <option value="number">{t("Number")}</option><option value="percent">{t("Percent")}</option>
                <option value="euro">{t("Euro")}</option><option value="dollar">{t("Dollar")}</option>
              </select></div>
          )}
          {prop.type === "date" && (
            <label className="cn-toggle-row pad"><input type="checkbox" checked={!!prop.time} onChange={(e) => upd({ time: e.target.checked })} /> {t("Include time")}</label>
          )}
          {prop.type === "relation" && (
            <MenuItem icon={typeIcon("relation", 15)} right={<ChevronRight size={14} />} onClick={(e) => setRelOpen(e.currentTarget as HTMLElement)}>
              {t("Link to database")}: {prop.database_id ? app.titleOf(prop.database_id) : "—"}
            </MenuItem>
          )}
          {(prop.type === "select" || prop.type === "multi_select" || prop.type === "status") && (prop.options || []).length > 0 && (
            <div className="cn-propmenu-opts">
              <MenuLabel>{t("Options")}</MenuLabel>
              {(prop.options || []).map((o) => <div key={o.id} className="pad-x"><Chip o={o} /></div>)}
            </div>
          )}
          <MenuSep />
        </>
      )}
      <MenuItem icon={<ArrowUp size={15} />} onClick={() => sort("asc")}>{t("Sort ascending")}</MenuItem>
      <MenuItem icon={<ArrowDown size={15} />} onClick={() => sort("desc")}>{t("Sort descending")}</MenuItem>
      <MenuItem icon={<FilterIcon size={15} />} onClick={() => {
        const ops = opsFor(isTitle ? "title" : prop!.type);
        onView({ ...view, filters: [...(view.filters || []), { prop: pid, op: ops[0].op, value: "" }] });
        onClose();
      }}>{t("Filter")}</MenuItem>
      {!isTitle && (
        <>
          <MenuItem icon={<EyeOff size={15} />} onClick={() => { onView({ ...view, hidden: [...(view.hidden || []), pid] }); onClose(); }}>{t("Hide in view")}</MenuItem>
          <MenuSep />
          <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { onSchema({ ...schema, properties: schema.properties.filter((p) => p.id !== pid) }); onClose(); }}>{t("Delete property")}</MenuItem>
        </>
      )}
      {typeOpen && prop && (
        <Popover anchor={typeOpen} onClose={() => setTypeOpen(null)} placement="right-start" width={220}>
          {TYPES.map((ty) => (
            <MenuItem key={ty.type} icon={typeIcon(ty.type, 15)} active={ty.type === prop.type} onClick={() => {
              const patch: Partial<Property> = { type: ty.type };
              if (ty.type === "status" && !(prop.options || []).length) patch.options = defaultStatusOptions();
              if ((ty.type === "select" || ty.type === "multi_select") && !prop.options) patch.options = [];
              upd(patch);
              setTypeOpen(null);
            }}>{t(ty.label)}</MenuItem>
          ))}
        </Popover>
      )}
      {relOpen && prop && (
        <Popover anchor={relOpen} onClose={() => setRelOpen(null)} placement="right-start" width={240}>
          <MenuLabel>{t("Choose a database")}</MenuLabel>
          {databases.map((d) => (
            <MenuItem key={d.id} icon={<span>{d.icon || "🗂️"}</span>} active={d.id === prop.database_id}
              onClick={() => { upd({ database_id: d.id }); setRelOpen(null); }}>{d.title || t("Untitled")}</MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

export function AddProperty({ schema, onSchema, onClose, onAdded }: { schema: Schema; onSchema: (s: Schema) => void; onClose: () => void; onAdded?: (p: Property) => void }) {
  const [name, setName] = useState("");
  const add = (type: PropType) => {
    const label = TYPES.find((x) => x.type === type)!.label;
    const p: Property = { id: newId(), name: name.trim() || t(label), type };
    if (type === "select" || type === "multi_select") p.options = [];
    if (type === "status") p.options = defaultStatusOptions();
    onSchema({ ...schema, properties: [...schema.properties, p] });
    onAdded?.(p);
    onClose();
  };
  return (
    <div>
      <div className="pad"><input className="cn-input" autoFocus placeholder={t("Property name")} value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") add("text"); }} /></div>
      <MenuLabel>{t("Type")}</MenuLabel>
      <div className="cn-scroll-menu">
        {TYPES.map((ty) => <MenuItem key={ty.type} icon={typeIcon(ty.type, 15)} onClick={() => add(ty.type)}>{t(ty.label)}</MenuItem>)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ filters
export function propsList(schema: Schema): { id: string; name: string; type: PropType | "title"; prop?: Property }[] {
  return [{ id: TITLE, name: schema.title_name, type: "title" }, ...schema.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, prop: p }))];
}

export function FilterEditor({ f, schema, onChange, onDelete }: { f: Filter; schema: Schema; onChange: (f: Filter) => void; onDelete: () => void }) {
  const app = useApp();
  const all = propsList(schema);
  const cur = all.find((x) => x.id === f.prop) || all[0];
  const ops = opsFor(cur.type);
  const op = ops.find((o) => o.op === f.op) || ops[0];
  const p = cur.prop;
  return (
    <div className="cn-filter-ed pad">
      <div className="row">
        <select className="cn-input" value={cur.id} onChange={(e) => {
          const nx = all.find((x) => x.id === e.target.value)!;
          onChange({ prop: nx.id, op: opsFor(nx.type)[0].op, value: "" });
        }}>{all.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className="cn-input" value={op.op} onChange={(e) => onChange({ ...f, op: e.target.value })}>
          {ops.map((o) => <option key={o.op} value={o.op}>{t(o.label)}</option>)}
        </select>
        <button type="button" className="cn-icon-btn" onClick={onDelete} title={t("Delete filter")}><Trash2 size={15} /></button>
      </div>
      {op.needs && (
        (p && (p.type === "select" || p.type === "status" || p.type === "multi_select")) ? (
          <select className="cn-input" value={f.value || ""} onChange={(e) => onChange({ ...f, value: e.target.value })}>
            <option value="">—</option>{(p.options || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : p && p.type === "relation" ? (
          <select className="cn-input" value={f.value || ""} onChange={(e) => onChange({ ...f, value: e.target.value })}>
            <option value="">—</option>
            {app.tree.filter((x) => (p.database_id ? x.parent_id === p.database_id : true)).slice(0, 300).map((x) => <option key={x.id} value={x.id}>{x.title || t("Untitled")}</option>)}
          </select>
        ) : (cur.type === "date" || cur.type === "created_time" || cur.type === "edited_time") ? (
          <div className="row">
            <input className="cn-input" type="date" value={f.value === "today" ? "" : f.value || ""} onChange={(e) => onChange({ ...f, value: e.target.value })} />
            <button type="button" className={`cn-btn sm ${f.value === "today" ? "primary" : ""}`} onClick={() => onChange({ ...f, value: "today" })}>{t("Today")}</button>
          </div>
        ) : (
          <input className="cn-input" autoFocus value={f.value ?? ""} type={cur.type === "number" ? "number" : "text"} onChange={(e) => onChange({ ...f, value: e.target.value })} />
        )
      )}
    </div>
  );
}

export function filterLabel(f: Filter, schema: Schema): string {
  const all = propsList(schema);
  const cur = all.find((x) => x.id === f.prop);
  if (!cur) return "?";
  const op = opsFor(cur.type).find((o) => o.op === f.op);
  let v = f.value ?? "";
  if (cur.prop?.options && v) v = cur.prop.options.find((o) => o.id === v)?.name || v;
  if (v === "today") v = t("Today");
  return `${cur.name} ${t(op?.label || "")}${op?.needs ? " " + v : ""}`.trim();
}

export function SortEditor({ view, schema, onView }: { view: View; schema: Schema; onView: (v: View) => void }) {
  const sorts = view.sorts || [];
  const all = propsList(schema);
  const set = (i: number, s: Sort | null) => onView({ ...view, sorts: s ? sorts.map((x, j) => (j === i ? s : x)) : sorts.filter((_, j) => j !== i) });
  return (
    <div className="pad cn-sort-ed">
      {sorts.map((s, i) => (
        <div key={i} className="row">
          <select className="cn-input" value={s.prop} onChange={(e) => set(i, { ...s, prop: e.target.value })}>
            {all.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className="cn-input" value={s.dir} onChange={(e) => set(i, { ...s, dir: e.target.value as any })}>
            <option value="asc">{t("Ascending")}</option><option value="desc">{t("Descending")}</option>
          </select>
          <button type="button" className="cn-icon-btn" onClick={() => set(i, null)}><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" className="cn-btn ghost sm" onClick={() => onView({ ...view, sorts: [...sorts, { prop: TITLE, dir: "asc" }] })}>
        <Plus size={14} /> {t("Add a sort")}
      </button>
    </div>
  );
}

export function VisibilityEditor({ view, schema, onView, onSchema }: { view: View; schema: Schema; onView: (v: View) => void; onSchema: (s: Schema) => void }) {
  const hidden = new Set(view.hidden || []);
  const [add, setAdd] = useState<HTMLElement | null>(null);
  return (
    <div>
      <MenuLabel>{t("Properties")}</MenuLabel>
      {schema.properties.map((p) => (
        <label key={p.id} className="cn-mi">
          <span className="cn-mi-ic">{typeIcon(p.type, 15)}</span>
          <span className="cn-mi-tx">{p.name}</span>
          <input type="checkbox" checked={!hidden.has(p.id)} onChange={(e) => {
            const h = new Set(hidden);
            if (e.target.checked) h.delete(p.id); else h.add(p.id);
            onView({ ...view, hidden: [...h] });
          }} />
        </label>
      ))}
      <MenuSep />
      <MenuItem icon={<Plus size={15} />} onClick={(e) => setAdd(e.currentTarget as HTMLElement)}>{t("Add a property")}</MenuItem>
      {add && <Popover anchor={add} onClose={() => setAdd(null)} placement="right-start" width={240}><AddProperty schema={schema} onSchema={onSchema} onClose={() => setAdd(null)} /></Popover>}
    </div>
  );
}

export function RenameInline({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  return (
    <div className="pad row"><Pencil size={14} />
      <input className="cn-input" defaultValue={value} autoFocus onKeyDown={(e) => { if (e.key === "Enter") onDone((e.target as HTMLInputElement).value); }}
        onBlur={(e) => onDone(e.target.value)} />
    </div>
  );
}
