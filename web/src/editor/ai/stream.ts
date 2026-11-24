// Client for the AI routes: POST api/ai (server-sent events) and POST api/ai/blocks.
import { api, BASE } from "../../api";
import { SSEParser } from "./text";

export type AIMessage = { role: "user" | "assistant"; content: string };
export type AIRequest = {
  page_id: string; command: string; prompt?: string; selection: any[]; context: any[]; history?: AIMessage[];
};

/** A failure reported by the server as a code (English, never shown as is: the menu translates it). */
export class AIError extends Error {
  code: string;
  status: number | undefined;
  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type ChatRequest = { page_id: string; message: string; model: string; context: any[]; history: AIMessage[] };

export async function aiChatStream(req: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<void> {
  return aiStream(req as any, { onSelection: () => {}, onDelta }, signal, "/api/ai/chat");
}

export async function aiStream(
  req: AIRequest,
  h: { onSelection(md: string): void; onDelta(text: string): void },
  signal: AbortSignal,
  path = "/api/ai",
): Promise<void> {
  const res = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
    credentials: "same-origin", signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new AIError(typeof data.error === "string" ? data.error : "unreachable", res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const parser = new SSEParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const ev of parser.feed(dec.decode(value, { stream: true }))) {
      if (typeof ev.selection_md === "string") h.onSelection(ev.selection_md);
      else if (typeof ev.delta === "string") h.onDelta(ev.delta);
      else if (ev.error) throw new AIError(String(ev.error), typeof ev.status === "number" ? ev.status : undefined);
      else if (ev.done) return;
    }
  }
  throw new AIError("interrupted");
}

export async function aiBlocks(markdown: string): Promise<any[]> {
  return (await api.post<{ blocks: any[] }>("/api/ai/blocks", { markdown })).blocks;
}
