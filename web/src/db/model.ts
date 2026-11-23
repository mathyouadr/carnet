import type { Filter, Option, Property, PropType, Row, Schema, Sort, View } from "../api";
import { t } from "../i18n";
import {
  Type, Hash, CircleChevronDown, Tags, Loader, Calendar, SquareCheck, Link, AtSign, Phone, ArrowUpRight, Clock, History,
} from "lucide-react";
import { createElement } from "react";

export const TYPES: { type: PropType; label: string; icon: any }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "number", label: "Number", icon: Hash },
  { type: "select", label: "Select", icon: CircleChevronDown },
  { type: "multi_select", label: "Multi-select", icon: Tags },
  { type: "status", label: "Status", icon: Loader },
  { type: "date", label: "Date", icon: Calendar },
  { type: "checkbox", label: "Checkbox", icon: SquareCheck },
  { type: "url", label: "URL", icon: Link },
  { type: "email", label: "Email", icon: AtSign },
  { type: "phone", label: "Phone", icon: Phone },
  { type: "relation", label: "Relation", icon: ArrowUpRight },
  { type: "created_time", label: "Created time", icon: Clock },
  { type: "edited_time", label: "Last edited time", icon: History },
];

export function typeIcon(type: PropType | "title", size = 14) {
  if (type === "title") return createElement(Type, { size });
  const m = TYPES.find((x) => x.type === type);
  return createElement(m ? m.icon : Type, { size });
}

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export function newId(n = 6) {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const x of r) s += a[x % a.length];
  return s;
}

export function defaultStatusOptions(): Option[] {
  return [
    { id: newId(), name: t("To do"), color: "gray", group: "todo" },
    { id: newId(), name: t("In progress"), color: "blue", group: "doing" },
    { id: newId(), name: t("Done"), color: "green", group: "done" },
  ];
}

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

/** Value as plain text: search, sorting by text, CSV-like display. */
export function textOf(row: Row, propId: string, schema: Schema, titles?: (id: string) => string): string {
  const v = valueOf(row, propId, schema);
  if (propId === TITLE) return v || "";
  const p = schema.properties.find((x) => x.id === propId)!;
  if (v === undefined || v === null) return "";
  switch (p.type) {
    case "select": case "status": return optionName(p, v);
    case "multi_select": return (v as string[]).map((x) => optionName(p, x)).join(", ");
    case "checkbox": return v ? "✓" : "";
    case "date": return v.start || "";
    case "relation": return (v as string[]).map((x) => (titles ? titles(x) : x)).join(", ");
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
    const a = Number(v), b = Number(want);
    if (v === undefined || v === null || isNaN(a)) return f.op === "ne";
    return { eq: a === b, ne: a !== b, gt: a > b, lt: a < b, gte: a >= b, lte: a <= b }[f.op] ?? true;
  }
  if (type === "select" || type === "status") return f.op === "is" ? v === want : v !== want;
  if (type === "multi_select" || type === "relation") {
    const has = Array.isArray(v) && v.includes(want);
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
        if (c) return s.dir === "desc" ? -c : c;
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

export function fmtNumber(v: any, format?: string) {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  const loc = document.documentElement.lang || undefined;
  if (format === "percent") return n.toLocaleString(loc, { maximumFractionDigits: 2 }) + " %";
  if (format === "euro") return n.toLocaleString(loc, { style: "currency", currency: "EUR" });
  if (format === "dollar") return n.toLocaleString(loc, { style: "currency", currency: "USD" });
  return n.toLocaleString(loc, { maximumFractionDigits: 6 });
}
