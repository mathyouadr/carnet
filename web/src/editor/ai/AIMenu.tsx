// "Ask AI" menu (Notion AI style): pick a command or type a request, watch the answer stream in,
// then Replace / Insert / Insert below / Retry / Discard. The document only changes on accept.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Sparkles, SpellCheck, WandSparkles, Minimize2, Maximize2, Feather, CircleHelp, Languages, ScrollText, PenLine,
  ListChecks, ArrowUp, Square, RotateCcw, Check, CornerDownLeft, X,
} from "lucide-react";
import { BOOT } from "../../api";
import { Popover } from "../../ui/Popover";
import { t } from "../../i18n";
import { sanitize } from "../sanitize";
import { aiBlocks, aiStream } from "./stream";
import type { AIMessage, AIRequest } from "./stream";
import { stripFence, wordDiff } from "./text";

type Cmd = { id: string; label: string; icon: ReactNode };
const SELECTION_CMDS: Cmd[] = [
  { id: "improve", label: "Improve writing", icon: <WandSparkles size={16} /> },
  { id: "fix", label: "Fix spelling & grammar", icon: <SpellCheck size={16} /> },
  { id: "shorter", label: "Make shorter", icon: <Minimize2 size={16} /> },
  { id: "longer", label: "Make longer", icon: <Maximize2 size={16} /> },
  { id: "simplify", label: "Simplify", icon: <Feather size={16} /> },
  { id: "explain", label: "Explain", icon: <CircleHelp size={16} /> },
  { id: "translate_fr", label: "Translate to French", icon: <Languages size={16} /> },
  { id: "translate_en", label: "Translate to English", icon: <Languages size={16} /> },
  { id: "summarize", label: "Summarize", icon: <ScrollText size={16} /> },
];
const PAGE_CMDS: Cmd[] = [
  { id: "continue", label: "Continue writing", icon: <PenLine size={16} /> },
  { id: "summarize_page", label: "Summarize the page", icon: <ScrollText size={16} /> },
  { id: "action_items", label: "Action items from the page", icon: <ListChecks size={16} /> },
];
const REWRITE = new Set(["improve", "fix", "shorter", "longer", "simplify", "translate_fr", "translate_en"]);
const WHOLE_PAGE = new Set(["summarize_page", "action_items"]);
const AROUND = 30;

export const aiName = () => BOOT.ai?.name || "AI";
const withName = (s: string) => t(s).replace("{name}", aiName());

/** Index in `doc` (top level) of the block holding `id`, itself or as a descendant. */
function topIndex(doc: any[], id: string): number {
  const has = (b: any): boolean => b.id === id || (b.children || []).some(has);
  return doc.findIndex(has);
}

type Phase = "choose" | "stream" | "done" | "error";

export function AIMenu({ editor, pageId, blockIds, hasSelection, onClose }: {
  editor: any; pageId: string; blockIds: string[]; hasSelection: boolean; onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState("");
  const [selMd, setSelMd] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [followup, setFollowup] = useState("");
  const [last, setLast] = useState<{ command: string; prompt: string; history: AIMessage[] } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const anchor = useMemo(() => {
    const id = blockIds[blockIds.length - 1];
    return (editor.domElement?.querySelector(`[data-id="${id}"]`) as HTMLElement | null) || null;
  }, [editor, blockIds]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const close = () => { ctrl.current?.abort(); onClose(); };

  const cmds = hasSelection ? SELECTION_CMDS : PAGE_CMDS;
  const q = query.trim().toLowerCase();
  const rows: Cmd[] = [
    ...(q ? [{ id: "custom", label: `${t("Ask")} « ${query.trim()} »`, icon: <Sparkles size={16} /> }] : []),
    ...cmds.filter((c) => !q || t(c.label).toLowerCase().includes(q) || c.label.toLowerCase().includes(q)),
  ];

  const blocksNow = () => blockIds.map((id) => editor.getBlock(id)).filter(Boolean);

  const buildRequest = (command: string, prompt: string, history: AIMessage[]): AIRequest => {
    const doc: any[] = editor.document;
    let context: any[];
    if (WHOLE_PAGE.has(command)) context = doc;
    else {
      const i = Math.max(0, topIndex(doc, blockIds[0]));
      const j = Math.max(i, topIndex(doc, blockIds[blockIds.length - 1]));
      context = doc.slice(Math.max(0, i - AROUND), j + AROUND + 1);
    }
    return { page_id: pageId, command, prompt, selection: hasSelection ? blocksNow() : [], context, history };
  };

  const run = async (command: string, prompt = "", history: AIMessage[] = []) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLast({ command, prompt, history });
    setAnswer(""); setError(""); setStale(false); setFollowup("");
    setPhase("stream");
    let text = "";
    try {
      await aiStream(buildRequest(command, prompt, history), {
        onSelection: (md) => setSelMd(md),
        onDelta: (d) => { text += d; setAnswer(text); },
      }, c.signal);
      if (c.signal.aborted) return;
      if (!stripFence(text)) throw new Error(t("Empty answer"));
      setPhase("done");
    } catch (e: any) {
      if (c.signal.aborted) return;
      setError(e?.message || String(e));
      setPhase("error");
    }
  };

  const cmdLabel = (id: string) => [...SELECTION_CMDS, ...PAGE_CMDS].find((c) => c.id === id)?.label || id;

  const sendFollowup = () => {
    if (!last || !followup.trim()) return;
    const asked = last.prompt ? `${cmdLabel(last.command)}: ${last.prompt}` : cmdLabel(last.command);
    run("custom", followup.trim(), [...last.history, { role: "user", content: asked }, { role: "assistant", content: answer }]);
  };

  /** mode: "replace" the selection, "insert" (generation: after the blocks, or instead of an empty line), "below". */
  const apply = async (mode: "replace" | "insert" | "below") => {
    try {
      const blocks = sanitize(await aiBlocks(stripFence(answer)));
      if (!blocks.length) throw new Error(t("Empty answer"));
      const present = blocksNow();
      if (present.length !== blockIds.length) {
        if (mode === "below" && stale) {
          const ref = editor.getTextCursorPosition().block.id;
          editor.transact(() => editor.insertBlocks(blocks, ref, "after"));
          return onClose();
        }
        setStale(true);
        setError(t("The text changed in the meantime"));
        return;
      }
      const lastId = blockIds[blockIds.length - 1];
      const only = present.length === 1 ? present[0] : null;
      const emptyLine = !hasSelection && only && only.type === "paragraph" && !(only.content || []).length;
      editor.transact(() => {
        if (mode === "replace" || (mode === "insert" && emptyLine)) editor.replaceBlocks(blockIds, blocks);
        else editor.insertBlocks(blocks, lastId, "after");
      });
      onClose();
      setTimeout(() => editor.focus(), 0);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (phase !== "choose") return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const r = rows[Math.min(active, rows.length - 1)];
      if (r) run(r.id, r.id === "custom" ? query.trim() : "");
    }
  };

  const rewrite = !!last && REWRITE.has(last.command);
  const name = aiName();

  return (
    <Popover anchor={anchor} onClose={close} width={520} className="cn-ai">
      {phase === "choose" && (
        <>
          <div className="cn-ai-ask">
            <Sparkles size={16} className="cn-ai-spark" />
            <input ref={inputRef} autoFocus value={query} placeholder={withName("Ask {name} anything…")}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} />
            <button type="button" className="cn-ai-send" disabled={!query.trim()} aria-label={t("Send")}
              onClick={() => run("custom", query.trim())}><ArrowUp size={16} /></button>
          </div>
          <div className="cn-ai-list">
            {rows.map((r, i) => (
              <button key={r.id + i} type="button" className={`cn-mi ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)} onClick={() => run(r.id, r.id === "custom" ? query.trim() : "")}>
                <span className="cn-mi-ic">{r.icon}</span><span className="cn-mi-tx">{r.id === "custom" ? r.label : t(r.label)}</span>
              </button>
            ))}
            {!rows.length && <div className="cn-ai-empty">{t("Press Enter to ask")}</div>}
          </div>
        </>
      )}

      {phase !== "choose" && (
        <div className="cn-ai-result">
          <div className="cn-ai-answer">
            {phase === "stream" && !answer && <span className="cn-ai-thinking">{withName("{name} is thinking…")}</span>}
            {(phase === "stream" || !rewrite) && answer && <span>{stripFence(answer)}</span>}
            {phase === "done" && rewrite && wordDiff(selMd, stripFence(answer)).map((p, i) =>
              <span key={i} className={p.op === "del" ? "cn-ai-del" : p.op === "ins" ? "cn-ai-ins" : ""}>{p.text}</span>)}
            {phase === "error" && <div className="cn-ai-error">{error}</div>}
          </div>
          {phase === "done" && error && <div className="cn-ai-error">{error}</div>}
          <div className="cn-ai-actions">
            {phase === "stream" && (
              <button type="button" className="cn-ai-btn" onClick={() => { ctrl.current?.abort(); setPhase(answer ? "done" : "choose"); }}>
                <Square size={14} />{t("Stop")}
              </button>
            )}
            {phase === "done" && !stale && rewrite && (
              <button type="button" className="cn-ai-btn primary" onClick={() => apply("replace")}><Check size={14} />{t("Replace")}</button>
            )}
            {phase === "done" && !stale && !rewrite && (
              <button type="button" className="cn-ai-btn primary" onClick={() => apply("insert")}><Check size={14} />{t("Insert")}</button>
            )}
            {phase === "done" && (
              <button type="button" className="cn-ai-btn" onClick={() => apply("below")}><CornerDownLeft size={14} />{t("Insert below")}</button>
            )}
            {(phase === "done" || phase === "error") && last && (
              <button type="button" className="cn-ai-btn" onClick={() => run(last.command, last.prompt, last.history)}>
                <RotateCcw size={14} />{t("Retry")}
              </button>
            )}
            <button type="button" className="cn-ai-btn" onClick={close}><X size={14} />{t("Discard")}</button>
          </div>
          {phase === "done" && (
            <div className="cn-ai-ask cn-ai-follow">
              <input value={followup} placeholder={withName("Tell {name} what to change…")}
                onChange={(e) => setFollowup(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); sendFollowup(); } }} />
              <button type="button" className="cn-ai-send" disabled={!followup.trim()} aria-label={t("Send")} onClick={sendFollowup}>
                <ArrowUp size={16} />
              </button>
            </div>
          )}
          <div className="cn-ai-foot">{name}</div>
        </div>
      )}
    </Popover>
  );
}
