// Spelling and grammar checker (LanguageTool on the server, no AI): underlines the mistakes, lists them in a
// side panel and offers corrections on right-click. Nothing is sent until the user asks for a check.
import { useCallback, useEffect, useRef, useState } from "react";
import { BookPlus, Check, EyeOff, RotateCw, SpellCheck, X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { MenuItem, MenuSep, Popover } from "../ui/Popover";
import { context, filterDict, isSpelling, joinSegments, locate, PLACEHOLDER, relocate } from "./grammar";
import type { Issue } from "./grammar";

export type GIssue = Issue & { blockId: string; idx: number };
type Seg = { el: HTMLElement; blockId: string; idx: number };

const DICT_KEY = "carnet:dict";
const dict = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(DICT_KEY) || "[]")); } catch { return new Set<string>(); } };

// ---- DOM text of the editor ------------------------------------------------------------------------------
function ownInline(bc: Element): HTMLElement[] {
  return Array.from(bc.querySelectorAll<HTMLElement>(".bn-inline-content")).filter((e) => e.closest(".bn-block-content") === bc);
}

function segments(root: HTMLElement, only?: Set<string>): Seg[] {
  const out: Seg[] = [];
  root.querySelectorAll<HTMLElement>(".bn-editor .bn-block-content").forEach((bc) => {
    if (bc.getAttribute("data-content-type") === "codeBlock") return;
    const outer = bc.closest(".bn-block-outer");
    const id = outer?.getAttribute("data-id");
    if (!id) return;
    if (only) {                                          // the block or one of its parents is in the scope
      let ok = false;
      for (let o: Element | null = outer; o && !ok; o = o.parentElement?.closest(".bn-block-outer") || null) ok = only.has(o.getAttribute("data-id") || "");
      if (!ok) return;
    }
    ownInline(bc).forEach((el, idx) => out.push({ el, blockId: id, idx }));
  });
  return out;
}

function segEl(root: HTMLElement, blockId: string, idx: number): HTMLElement | null {
  const outer = root.querySelector(`.bn-block-outer[data-id="${CSS.escape(blockId)}"]`);
  const bc = outer?.querySelector(":scope > .bn-block > .bn-block-content");
  return bc ? ownInline(bc)[idx] || null : null;
}

type Piece = { node: Text; start: number };
/** Text of a segment as LanguageTool sees it: atoms (mentions, maths) become one placeholder character. */
function readSeg(el: HTMLElement): { text: string; pieces: Piece[] } {
  let text = "";
  const pieces: Piece[] = [];
  const walk = (n: Node) => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) { pieces.push({ node: c as Text, start: text.length }); text += (c as Text).data; }
      else if (c.nodeType === Node.ELEMENT_NODE) {
        const e = c as HTMLElement;
        if (e.tagName === "BR") { if (!e.classList.contains("ProseMirror-trailingBreak")) text += "\n"; }
        else if (e.getAttribute("contenteditable") === "false") text += PLACEHOLDER;
        else walk(e);
      }
    });
  };
  walk(el);
  return { text, pieces };
}

function rangeIn(el: HTMLElement, at: number, len: number): Range | null {
  const { pieces } = readSeg(el);
  const find = (pos: number, end: boolean) => pieces.find((p) => (end ? p.start < pos : p.start <= pos) && pos <= p.start + p.node.data.length);
  const a = find(at, false), b = find(at + len, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, at - a.start);
  r.setEnd(b.node, at + len - b.start);
  return r;
}

// ---- underlines (CSS Custom Highlight API), shared by every editor on screen (page + peek) ------------------
const painted = new Map<symbol, { spell: Range[]; gram: Range[]; cur: Range[] }>();
function paint() {
  const reg = (CSS as any).highlights;
  const H = (window as any).Highlight;
  if (!reg || !H) return;
  const all = { spell: [] as Range[], gram: [] as Range[], cur: [] as Range[] };
  painted.forEach((v) => { all.spell.push(...v.spell); all.gram.push(...v.gram); all.cur.push(...v.cur); });
  reg.set("cn-spell", new H(...all.spell));
  reg.set("cn-gram", new H(...all.gram));
  reg.set("cn-gram-cur", new H(...all.cur));
}

// ---- the hook -------------------------------------------------------------------------------------------
export function useGrammar(editor: any, host: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [issues, setIssues] = useState<GIssue[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  const me = useRef(Symbol("grammar"));
  const ignored = useRef(new Set<string>());
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  const rangeOf = useCallback((i: GIssue) => {
    const el = host.current && segEl(host.current, i.blockId, i.idx);
    return el ? rangeIn(el, i.at, i.str.length) : null;
  }, [host]);

  // a new page: start again
  useEffect(() => {
    setIssues([]); setOpen(false); setChecked(false); setError(""); setCur(null); ignored.current = new Set();
    return () => { painted.delete(me.current); paint(); };
  }, [editor]);

  // underline again after every change, following the text that moved
  useEffect(() => {
    if (!issues.length && !painted.has(me.current)) return;
    const draw = () => {
      const spell: Range[] = [], gram: Range[] = [], c: Range[] = [];
      for (const i of issuesRef.current) {
        const r = rangeOf(i);
        if (!r) continue;
        (isSpelling(i) ? spell : gram).push(r);
        if (i.key === cur) c.push(r);
      }
      painted.set(me.current, { spell, gram, cur: c });
      paint();
    };
    draw();
    let timer = 0;
    const off = editor.onChange?.(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const root = host.current;
        if (!root) return;
        const next: GIssue[] = [];
        for (const i of issuesRef.current) {
          const el = segEl(root, i.blockId, i.idx);
          const at = el ? relocate(readSeg(el).text, i.at, i.str) : -1;
          if (at >= 0) next.push(at === i.at ? i : { ...i, at });
        }
        if (next.length !== issuesRef.current.length || next.some((n, k) => n !== issuesRef.current[k])) setIssues(next);
        else draw();
      }, 200);
    });
    return () => { clearTimeout(timer); if (typeof off === "function") off(); };
  }, [issues, cur, editor, rangeOf]);   // eslint-disable-line

  /** Check the whole page, or only some blocks (and their children). */
  const check = useCallback(async (only?: string[]) => {
    const root = host.current;
    if (!root || !enabled) return;
    setOpen(true); setBusy(true); setError("");
    const scope = only?.length ? new Set(only) : undefined;
    const segs = segments(root, scope);
    const texts = segs.map((s) => readSeg(s.el).text);
    const { text, starts } = joinSegments(texts);
    try {
      let found: GIssue[] = [];
      if (text.replace(new RegExp(PLACEHOLDER, "g"), "").trim()) {
        const r = await api.post<{ matches: any[] }>("/api/grammar", { text });
        found = locate(r.matches || [], texts, starts).map((i) => {
          const s = segs[i.seg];
          return { ...i, blockId: s.blockId, idx: s.idx, key: `${s.blockId}:${s.idx}:${i.at}:${i.rule}` };
        });
        found = filterDict(found, dict()).filter((i) => !ignored.current.has(i.str + "|" + i.rule));
      }
      if (scope) {
        const ids = new Set(segs.map((s) => s.blockId));
        const order = new Map(segments(root).map((s, n) => [s.blockId + ":" + s.idx, n]));
        const pos = (i: GIssue) => (order.get(i.blockId + ":" + i.idx) ?? 0) * 1e6 + i.at;
        setIssues((prev) => [...prev.filter((p) => !ids.has(p.blockId)), ...found].sort((a, b) => pos(a) - pos(b)));
      } else setIssues(found);
      setChecked(true);
    } catch (e: any) {
      setError(e?.status === 413 ? t("This page is too long to be checked at once: select a part of it.") : t("The spelling checker is unavailable."));
    } finally { setBusy(false); }
  }, [host, enabled]);

  const drop = (i: GIssue) => setIssues((prev) => prev.filter((p) => p.key !== i.key));

  /** Put the suggestion in place of the mistake (one undoable edit, formatting kept). */
  const apply = useCallback((i: GIssue, repl: string) => {
    const r = rangeOf(i);
    const view = editor.prosemirrorView;
    if (!r || !view) return false;
    const from = view.posAtDOM(r.startContainer, r.startOffset), to = view.posAtDOM(r.endContainer, r.endOffset);
    if (view.state.doc.textBetween(from, to) !== i.str) return false;
    view.dispatch(view.state.tr.insertText(repl, from, to));
    const delta = repl.length - i.str.length;
    setIssues((prev) => prev.filter((p) => p !== i).map((p) => (p.blockId === i.blockId && p.idx === i.idx && p.at > i.at ? { ...p, at: p.at + delta } : p)));
    return true;
  }, [editor, rangeOf]);

  const ignore = (i: GIssue) => { ignored.current.add(i.str + "|" + i.rule); setIssues((prev) => prev.filter((p) => !(p.str === i.str && p.rule === i.rule))); };
  const learn = (i: GIssue) => {
    const d = dict(); d.add(i.str.toLowerCase());
    localStorage.setItem(DICT_KEY, JSON.stringify([...d]));
    setIssues((prev) => prev.filter((p) => !(isSpelling(p) && p.str.toLowerCase() === i.str.toLowerCase())));
  };

  /** The mistake under the pointer (right-click), if any. */
  const issueAt = useCallback((x: number, y: number): GIssue | null => {
    for (const i of issuesRef.current) {
      const r = rangeOf(i);
      if (r && Array.from(r.getClientRects()).some((b) => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2)) return i;
    }
    return null;
  }, [rangeOf]);

  /** Scroll to a mistake and mark it. */
  const show = useCallback((i: GIssue) => {
    setCur(i.key);
    const r = rangeOf(i);
    const area = host.current?.closest(".cn-scroll") as HTMLElement | null;
    if (!r || !area) return;
    const b = r.getBoundingClientRect(), a = area.getBoundingClientRect();
    if (b.top < a.top + 60 || b.bottom > a.bottom - 60) area.scrollTo({ top: area.scrollTop + b.top - a.top - a.height / 3, behavior: "smooth" });
  }, [rangeOf, host]);

  const clear = () => { setIssues([]); setOpen(false); setChecked(false); setCur(null); };
  return { enabled, issues, open, setOpen, busy, error, checked, check, apply, ignore, learn, drop, issueAt, show, clear, rangeOf, cur };
}
export type Grammar = ReturnType<typeof useGrammar>;

const kindLabel = (i: GIssue) => (isSpelling(i) ? t("Spelling") : i.type === "style" || i.category === "STYLE" || i.category === "REDUNDANCY" ? t("Style") : i.category === "TYPOGRAPHY" || i.category === "PUNCTUATION" ? t("Typography") : t("Grammar"));

// ---- side panel -----------------------------------------------------------------------------------------
export function GrammarPanel({ g, readText }: { g: Grammar; readText: (i: GIssue) => string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".cn-pop")) g.setOpen(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [g.setOpen]);  // eslint-disable-line
  return (
    <aside className="cn-gram" aria-label={t("Spelling and grammar")}>
      <div className="cn-gram-top">
        <SpellCheck size={16} /><span>{t("Spelling and grammar")}</span>
        {g.checked && !g.busy && <span className="cn-gram-n">{g.issues.length}</span>}
        <span className="cn-chat-sp" />
        <button type="button" className="cn-chat-ic" title={t("Check again")} aria-label={t("Check again")} disabled={g.busy} onClick={() => g.check()}><RotateCw size={15} /></button>
        <button type="button" className="cn-chat-ic" title={t("Close")} aria-label={t("Close")} onClick={() => g.setOpen(false)}><X size={16} /></button>
      </div>
      <div className="cn-gram-body">
        {g.busy && <div className="cn-chat-empty">{t("Checking…")}</div>}
        {!g.busy && g.error && <div className="cn-chat-empty">{g.error}</div>}
        {!g.busy && !g.error && g.checked && !g.issues.length && <div className="cn-gram-ok"><Check size={16} /> {t("No mistake found")}</div>}
        {!g.busy && g.issues.map((i) => {
          const c = context(readText(i), i.at, i.str.length);
          return (
            <div key={i.key} className={`cn-gram-item ${isSpelling(i) ? "spell" : "gram"} ${g.cur === i.key ? "on" : ""}`} onClick={() => g.show(i)}>
              <div className="cn-gram-kind">{kindLabel(i)}{i.short ? ` · ${i.short}` : ""}</div>
              <div className="cn-gram-ctx">{c.before}<mark>{c.err}</mark>{c.after}</div>
              <div className="cn-gram-msg">{i.message}</div>
              <div className="cn-gram-acts" onClick={(e) => e.stopPropagation()}>
                {i.replacements.slice(0, 4).map((r) => (
                  <button key={r} type="button" className="cn-gram-fix" onClick={() => g.apply(i, r)}>{r || t("(delete)")}</button>
                ))}
                <button type="button" className="cn-chat-ins" onClick={() => g.ignore(i)}><EyeOff size={13} /> {t("Ignore")}</button>
                {isSpelling(i) && <button type="button" className="cn-chat-ins" onClick={() => g.learn(i)}><BookPlus size={13} /> {t("Add to dictionary")}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ---- right-click on an underlined word ------------------------------------------------------------------
export function GrammarMenu({ g, issue, at, onClose }: { g: Grammar; issue: GIssue; at: DOMRect; onClose: () => void }) {
  const run = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Popover anchor={at} onClose={onClose} width={260}>
      <div className="cn-gram-menu-msg">{issue.message}</div>
      {issue.replacements.slice(0, 5).map((r) => (
        <MenuItem key={r} icon={<Check size={15} />} onClick={run(() => g.apply(issue, r))}><b>{r || t("(delete)")}</b></MenuItem>
      ))}
      <MenuSep />
      <MenuItem icon={<EyeOff size={15} />} onClick={run(() => g.ignore(issue))}>{t("Ignore")}</MenuItem>
      {isSpelling(issue) && <MenuItem icon={<BookPlus size={15} />} onClick={run(() => g.learn(issue))}>{t("Add to dictionary")}</MenuItem>}
      <MenuItem icon={<SpellCheck size={15} />} onClick={run(() => g.check())}>{t("Check the whole page")}</MenuItem>
    </Popover>
  );
}

/** Text of an issue's segment now (for the context shown in the list). */
export function segText(root: HTMLElement | null, i: GIssue): string {
  const el = root && segEl(root, i.blockId, i.idx);
  return el ? readSeg(el).text : i.str;
}
