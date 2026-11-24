// Pure data logic for databases (values, filters, sorts, type changes). No React, no i18n: testable in node.
import type { Filter, Option, Property, PropType, Row, Schema, Sort, View } from "../api";

export const TITLE = "__title";

/** Raw value of a property for a row (title, computed times included). */
export function valueOf(row: Row, propId: string, schema: Schema): any {
  if (propId === TITLE) return row.title;
  const p = schema.properties.find((x) => x.id === propId);
  if (!p) return undefined;
  if (p.type === "created_time") return row.created_at;
  if (p.type === "edited_time") return row.updated_at;
  return row.props?.[propId];
}

export function optionName(p: Property, id: string) {
  return p.options?.find((o) => o.id === id)?.name ?? "";
}

/** A value that should be a list (multi-select, relation) as a list: old or converted data may hold a scalar. */
export function asList(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === "" || v === false) return [];
  return [v];
}

/** Value as plain text: search, sorting by text, CSV-like display. */
export function textOf(row: Row, propId: string, schema: Schema, titles?: (id: string) => string): string {
  const v = valueOf(row, propId, schema);
  if (propId === TITLE) return v || "";
  const p = schema.properties.find((x) => x.id === propId)!;
  if (v === undefined || v === null) return "";
  switch (p.type) {
    case "select": case "status": return optionName(p, v);
    case "multi_select": return asList(v).map((x) => optionName(p, x)).join(", ");
    case "checkbox": return v ? "✓" : "";
    case "date": return typeof v === "string" ? v : v.start || "";
    case "relation": return asList(v).map((x) => (titles ? titles(x) : x)).join(", ");
    default: return String(v);
  }
}

export function isEmpty(v: any) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && !v.start && Object.keys(v).length === 0);
}

export type Op = { op: string; label: string; needs: boolean };
export function opsFor(type: PropType | "title"): Op[] {
  const empty = [{ op: "empty", label: "is empty", needs: false }, { op: "not_empty", label: "is not empty", needs: false }];
  switch (type) {
    case "number": return [{ op: "eq", label: "=", needs: true }, { op: "ne", label: "≠", needs: true }, { op: "gt", label: ">", needs: true },
      { op: "lt", label: "<", needs: true }, { op: "gte", label: "≥", needs: true }, { op: "lte", label: "≤", needs: true }, ...empty];
    case "select": case "status": return [{ op: "is", label: "is", needs: true }, { op: "is_not", label: "is not", needs: true }, ...empty];
    case "multi_select": case "relation": return [{ op: "contains", label: "contains", needs: true }, { op: "not_contains", label: "does not contain", needs: true }, ...empty];
    case "checkbox": return [{ op: "checked", label: "is checked", needs: false }, { op: "unchecked", label: "is not checked", needs: false }];
    case "date": case "created_time": case "edited_time": return [{ op: "is", label: "is", needs: true }, { op: "before", label: "before", needs: true },
      { op: "after", label: "after", needs: true }, { op: "on_before", label: "on or before", needs: true }, { op: "on_after", label: "on or after", needs: true }, ...empty];
    default: return [{ op: "contains", label: "contains", needs: true }, { op: "not_contains", label: "does not contain", needs: true },
      { op: "is", label: "is", needs: true }, { op: "is_not", label: "is not", needs: true }, ...empty];
  }
}

function typeOfProp(propId: string, schema: Schema): PropType | "title" {
  if (propId === TITLE) return "title";
  return schema.properties.find((x) => x.id === propId)?.type || "text";
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateKey(v: any): string {
  if (!v) return "";
  if (typeof v === "string") {
    if (v.endsWith("Z")) { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
    return v.slice(0, 10);
  }
  return (v.start || "").slice(0, 10);
}

export function matchFilter(row: Row, f: Filter, schema: Schema): boolean {
  const type = typeOfProp(f.prop, schema);
  const v = valueOf(row, f.prop, schema);
  const want = f.value;
  switch (f.op) {
    case "empty": return isEmpty(v);
    case "not_empty": return !isEmpty(v);
    case "checked": return !!v;
    case "unchecked": return !v;
  }
  if (want === undefined || want === null || want === "") return true;      // incomplete rule: ignore it
  if (type === "number") {
    // an empty cell is not 0: it never matches a numeric comparison
    if (isEmpty(v)) return false;
    const a = Number(v), b = Number(want);
    if (isNaN(a) || isNaN(b)) return false;
    return { eq: a === b, ne: a !== b, gt: a > b, lt: a < b, gte: a >= b, lte: a <= b }[f.op] ?? true;
  }
  if (type === "select" || type === "status") return f.op === "is" ? v === want : v !== want;
  if (type === "multi_select" || type === "relation") {
    const has = asList(v).includes(want);
    return f.op === "contains" ? has : !has;
  }
  if (type === "date" || type === "created_time" || type === "edited_time") {
    const a = dateKey(v), b = want === "today" ? today() : String(want);
    if (!a) return false;
    return { is: a === b, before: a < b, after: a > b, on_before: a <= b, on_after: a >= b }[f.op] ?? true;
  }
  const s = String(type === "title" ? v || "" : textOf(row, f.prop, schema)).toLowerCase();
  const w = String(want).toLowerCase();
  return { contains: s.includes(w), not_contains: !s.includes(w), is: s === w, is_not: s !== w }[f.op] ?? true;
}

export function applyView(rows: Row[], view: View, schema: Schema, search: string, titles?: (id: string) => string): Row[] {
  let out = rows;
  const filters = view.filters || [];
  if (filters.length) {
    out = out.filter((r) => (view.filter_mode === "or" ? filters.some((f) => matchFilter(r, f, schema)) : filters.every((f) => matchFilter(r, f, schema))));
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    out = out.filter((r) => (r.title || "").toLowerCase().includes(q) || schema.properties.some((p) => textOf(r, p.id, schema, titles).toLowerCase().includes(q)));
  }
  const sorts = view.sorts || [];
  if (sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of sorts) {
        const c = compare(a, b, s, schema, titles);
        if (!c) continue;
        // empties always go last, whatever the direction
        const empty = isEmpty(valueOf(a, s.prop, schema)) || isEmpty(valueOf(b, s.prop, schema));
        return s.dir === "desc" && !empty ? -c : c;
      }
      return a.position - b.position;
    });
  }
  return out;
}

function compare(a: Row, b: Row, s: Sort, schema: Schema, titles?: (id: string) => string): number {
  const type = typeOfProp(s.prop, schema);
  const va = valueOf(a, s.prop, schema), vb = valueOf(b, s.prop, schema);
  if (isEmpty(va) && isEmpty(vb)) return 0;
  if (isEmpty(va)) return 1;
  if (isEmpty(vb)) return -1;
  if (type === "number") return Number(va) - Number(vb);
  if (type === "checkbox") return (va ? 1 : 0) - (vb ? 1 : 0);
  if (type === "date" || type === "created_time" || type === "edited_time") return (typeof va === "string" ? va : va.start).localeCompare(typeof vb === "string" ? vb : vb.start);
  if (type === "select" || type === "status") {
    const p = schema.properties.find((x) => x.id === s.prop)!;
    const ia = p.options?.findIndex((o) => o.id === va) ?? 0, ib = p.options?.findIndex((o) => o.id === vb) ?? 0;
    return ia - ib;
  }
  return textOf(a, s.prop, schema, titles).localeCompare(textOf(b, s.prop, schema, titles), undefined, { numeric: true, sensitivity: "base" });
}


/** Values a new row gets from the view's filters ("AND" only), so it shows up where it was created.
 *  Several `contains` rules on the same multi-select/relation accumulate. */
export function propsFromFilters(view: View, schema: Schema): Record<string, any> {
  const out: Record<string, any> = {};
  if (view.filter_mode === "or") return out;
  for (const f of view.filters || []) {
    const p = schema.properties.find((x) => x.id === f.prop);
    if (!p || f.value === undefined || f.value === null || f.value === "") continue;
    if ((p.type === "select" || p.type === "status") && f.op === "is") out[p.id] = f.value;
    else if ((p.type === "multi_select" || p.type === "relation") && f.op === "contains") out[p.id] = [...asList(out[p.id]), f.value];
    else if (p.type === "checkbox") out[p.id] = f.op === "checked";
    else if (p.type === "number" && f.op === "eq") out[p.id] = Number(f.value);
    else if (["text", "url", "email", "phone"].includes(p.type) && (f.op === "is" || f.op === "eq")) out[p.id] = f.value;
    else if (p.type === "date" && f.op === "is") out[p.id] = { start: f.value === "today" ? today() : f.value };
  }
  for (const f of view.filters || []) {
    const p = schema.properties.find((x) => x.id === f.prop);
    if (p?.type === "checkbox" && !(p.id in out)) out[p.id] = f.op === "checked";
  }
  return out;
}

/** Option id for an option id or an option name (case-insensitive); null when there is none. */
function optionId(p: Property, x: any): string | null {
  const key = String(x ?? "").trim().toLowerCase();
  const o = (p.options || []).find((o) => o.id === x || o.name.trim().toLowerCase() === key);
  return o ? o.id : null;
}

const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

/** A text-like property that becomes a select / multi-select gets one option per distinct text (like Notion),
 *  so its values are kept instead of emptied. Returns the new schema. */
export function withOptionsFor(rows: Row[], oldSchema: Schema, newSchema: Schema, newId: () => string): Schema {
  const properties = newSchema.properties.map((np) => {
    const op = oldSchema.properties.find((x) => x.id === np.id);
    if (!op || op.type === np.type || !["select", "multi_select"].includes(np.type)) return np;
    if (!["text", "url", "email", "phone", "number"].includes(op.type)) return np;
    const options = [...(np.options || [])];
    for (const r of rows) {
      const v = r.props?.[np.id];
      if (v === undefined || v === null || v === "") continue;
      const name = String(v).trim();
      if (!name || options.some((o) => o.name.trim().toLowerCase() === name.toLowerCase())) continue;
      options.push({ id: newId(), name, color: COLORS[options.length % COLORS.length] });
    }
    return { ...np, options };
  });
  return { ...newSchema, properties };
}

/** Convert one value when a property changes type. Unknown shapes become empty rather than crashing. */
export function convertValue(v: any, from: PropType, to: PropType, toProp: Property): any {
  if (v === undefined || v === null || v === "") return to === "checkbox" ? false : null;
  if (from === to) return v;
  const text = (x: any): string => (x && typeof x === "object" && !Array.isArray(x) ? String(x.start ?? "") : Array.isArray(x) ? x.join(", ") : String(x));
  switch (to) {
    case "select": case "status": {
      const first = asList(v)[0];
      return first === undefined ? null : optionId(toProp, first);
    }
    case "multi_select": {
      const ids = asList(v).map((x) => optionId(toProp, x)).filter((x): x is string => !!x);
      return ids.length ? [...new Set(ids)] : [];
    }
    case "number": {
      const n = Number(String(Array.isArray(v) ? v[0] ?? "" : typeof v === "object" ? v.start ?? "" : v).replace(",", "."));
      return String(v).trim() !== "" && Number.isFinite(n) ? n : null;
    }
    case "checkbox": return !!(Array.isArray(v) ? v.length : v);
    case "date": {
      const s = text(v).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { start: s } : null;
    }
    case "relation": return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    default: return text(v);      // text, url, email, phone, created/edited_time (computed anyway)
  }
}

/** Rows whose stored value must be rewritten after the schema changed type: { id, props } with the new values. */
export function changedPropValues(rows: Row[], oldSchema: Schema, newSchema: Schema): { id: string; props: Record<string, any> }[] {
  const out: { id: string; props: Record<string, any> }[] = [];
  for (const np of newSchema.properties) {
    const op = oldSchema.properties.find((x) => x.id === np.id);
    if (!op || op.type === np.type) continue;
    for (const r of rows) {
      const v = r.props?.[np.id];
      if (v === undefined) continue;
      const nv = convertValue(v, op.type, np.type, np);
      if (JSON.stringify(nv) === JSON.stringify(v)) continue;     // already in the new shape
      const cur = out.find((x) => x.id === r.id);
      if (cur) cur.props[np.id] = nv;
      else out.push({ id: r.id, props: { [np.id]: nv } });
    }
  }
  return out.filter((x) => Object.keys(x.props).length > 0);
}

