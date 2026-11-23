// Client for the AI routes: POST api/ai (server-sent events) and POST api/ai/blocks.
import { api, BASE } from "../../api";
import { SSEParser } from "./text";

export type AIMessage = { role: "user" | "assistant"; content: string };
export type AIRequest = {
  page_id: string; command: string; prompt?: string; selection: any[]; context: any[]; history?: AIMessage[];
};

export async function aiStream(
  req: AIRequest,
  h: { onSelection(md: string): void; onDelta(text: string): void },
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(BASE + "/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
    credentials: "same-origin", signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || "AI request failed");
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
      else if (ev.error) throw new Error(String(ev.error));
      else if (ev.done) return;
    }
  }
  throw new Error("AI answer interrupted");
}

export async function aiBlocks(markdown: string): Promise<any[]> {
  return (await api.post<{ blocks: any[] }>("/api/ai/blocks", { markdown })).blocks;
}
