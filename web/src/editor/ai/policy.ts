// Pure decisions of the AI menu (no React, no DOM: also run by `node --test`).

export const AI_HISTORY_MESSAGES = 6;      // messages sent back to the server (it keeps 8)
const HISTORY_CHARS = 4000;
export const SELECTION_LIMIT = 20000;      // same limit as the server (carnet/ai.py)

/** The conversation sent with a follow-up: the newest messages, clipped, so the request stays small. */
export function historyFor(history: { role: "user" | "assistant"; content: string }[]) {
  return history.slice(-AI_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS) }));
}

/** What the conversation shows for a request: the user's own words (a custom request is just its prompt). */
export function askedText(command: string, prompt: string, label: string): string {
  if (command === "custom") return prompt;
  return prompt ? `${label}: ${prompt}` : label;
}

/** A rewrite is applied only when the answer is complete and the text is still the one it was asked about. */
export function canReplace(s: { rewrite: boolean; partial: boolean; stale: boolean }): boolean {
  return s.rewrite && !s.partial && !s.stale;
}

/** Identity of the blocks an answer is about: ids and content (a count would miss edits). */
export function fingerprint(blocks: any[]): string {
  return JSON.stringify(blocks);
}

/** Space typed on a virtual keyboard (Android: keydown reports "Unidentified", the input carries the space). */
export function isSpaceInput(data: string | null | undefined, inputType: string): boolean {
  return data === " " && inputType === "insertText";
}

/** Rewrites over the limit are refused by the server: the selection must never be clipped. */
export function selectionTooLong(markdown: string): boolean {
  return markdown.length > SELECTION_LIMIT;
}
