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


export * from "./logic";
