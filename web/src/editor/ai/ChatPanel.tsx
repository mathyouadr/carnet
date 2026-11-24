// Chat panel next to the page: questions and answers about the page, with a choice of model.
// It never edits the page by itself (the ✨ button and /ia do that); an answer can be inserted by hand.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, CornerDownLeft, Square, Trash2, X, MessageCircle } from "lucide-react";
import { BOOT } from "../../api";
import { t } from "../../i18n";
import { sanitize } from "../sanitize";
import { aiBlocks, aiChatStream, AIError } from "./stream";
import type { AIMessage } from "./stream";
import { historyFor } from "./policy";
import { mdPreview, stripFence } from "./text";

const MODEL_KEY = "carnet:chat-model";

function errText(e: any): string {
  if (e instanceof AIError) return e.code === "too_many_requests" ? t("Too many AI requests at the moment, try again shortly") : t("AI request failed");
  if (e instanceof TypeError) return t("AI server unreachable");
  return t("AI request failed");
}

export function ChatPanel({ editor, pageId, onClose }: { editor: any; pageId: string; onClose: () => void }) {
  const models = BOOT.ai?.models?.length ? BOOT.ai.models : [BOOT.ai?.name || "AI"];
  const [model, setModel] = useState(() => {
    const saved = localStorage.getItem(MODEL_KEY) || "";
    return models.includes(saved) ? saved : models[0];
  });
  const [msgs, setMsgs] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ctrl = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    const history = historyFor(msgs);
    setMsgs((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    setInput(""); setError(""); setBusy(true);
    const c = new AbortController();
    ctrl.current = c;
    let text = "";
    try {
      await aiChatStream({ page_id: pageId, message, model, context: editor.document, history }, (d) => {
        text += d;
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: text }]);
      }, c.signal);
    } catch (e: any) {
      if (!c.signal.aborted) setError(errText(e));
    } finally {
      setBusy(false);
      if (!text) setMsgs((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
    }
  };

  const stop = () => ctrl.current?.abort();

  /** Insert an answer under the block the cursor is on (the user's choice: the chat itself never writes). */
  const insert = async (content: string) => {
    try {
      const blocks = sanitize(await aiBlocks(stripFence(content)));
      if (!blocks.length) return;
      const ref = editor.getTextCursorPosition().block.id;
      editor.transact(() => editor.insertBlocks(blocks, ref, "after"));
    } catch { setError(t("AI request failed")); }
  };

  return (
    <aside className="cn-chat" aria-label={t("Chat")}>
      <div className="cn-chat-top">
        <MessageCircle size={16} />
        <select value={model} onChange={(e) => { setModel(e.target.value); localStorage.setItem(MODEL_KEY, e.target.value); }}
          aria-label={t("Model")} disabled={busy}>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="cn-chat-sp" />
        {!!msgs.length && <button type="button" className="cn-chat-ic" title={t("New conversation")} aria-label={t("New conversation")}
          onClick={() => { stop(); setMsgs([]); setError(""); }}><Trash2 size={15} /></button>}
        <button type="button" className="cn-chat-ic" title={t("Close")} aria-label={t("Close")} onClick={() => { stop(); onClose(); }}><X size={16} /></button>
      </div>
      <div className="cn-chat-body">
        {!msgs.length && <div className="cn-chat-empty">{t("Ask a question about this page. To change the page, use the AI button or /ia.")}</div>}
        {msgs.map((m, i) => m.role === "user"
          ? <div key={i} className="cn-chat-msg user">{m.content}</div>
          : <div key={i} className="cn-chat-msg bot">
              {m.content
                ? <div className="cn-ai-md" dangerouslySetInnerHTML={{ __html: mdPreview(stripFence(m.content)) }} />
                : <span className="cn-ai-thinking">…</span>}
              {m.content && !(busy && i === msgs.length - 1) && (
                <button type="button" className="cn-chat-ins" onClick={() => insert(m.content)}><CornerDownLeft size={13} />{t("Insert below")}</button>)}
            </div>)}
        {error && <div className="cn-ai-error">{error}</div>}
        <div ref={end} />
      </div>
      <div className="cn-chat-in">
        <textarea ref={field} rows={1} value={input} placeholder={t("Message…")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        {busy
          ? <button type="button" className="cn-ai-send" aria-label={t("Stop")} onClick={stop}><Square size={14} /></button>
          : <button type="button" className="cn-ai-send" aria-label={t("Send")} disabled={!input.trim()} onClick={send}><ArrowUp size={16} /></button>}
      </div>
    </aside>
  );
}
