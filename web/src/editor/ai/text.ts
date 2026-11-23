// Pure helpers for the AI assistant (no imports: also run by `node --test`).

/** Server-sent events: feed text chunks, get the JSON of each complete `data:` event. */
export class SSEParser {
  private buf = "";
  feed(chunk: string): any[] {
    this.buf += chunk;
    const out: any[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data) continue;
      try { out.push(JSON.parse(data)); } catch { /* not JSON: ignore */ }
    }
    return out;
  }
}

export type DiffPart = { op: "eq" | "del" | "ins"; text: string };

const MAX_TOKENS = 4000;

/** Word-level diff (LCS on words and spaces); adjacent parts with the same op are merged. */
export function wordDiff(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/).filter((x) => x !== "");
  const B = b.split(/(\s+)/).filter((x) => x !== "");
  if (A.length > MAX_TOKENS || B.length > MAX_TOKENS) {
    return [...(a ? [{ op: "del" as const, text: a }] : []), ...(b ? [{ op: "ins" as const, text: b }] : [])];
  }
  const n = A.length, m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { push("eq", A[i]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { push("ins", B[j]); j++; }
    else { push("del", A[i]); i++; }
  }
  // "del" before "ins" when both replace the same spot (reads better: ~~old~~ new)
  for (let k = 0; k + 1 < out.length; k++) {
    if (out[k].op === "ins" && out[k + 1].op === "del") { const t = out[k]; out[k] = out[k + 1]; out[k + 1] = t; }
  }
  return out;
}

/** Remove one code fence wrapping the whole answer (```markdown … ```), keep inner code blocks. */
export function stripFence(s: string): string {
  const t = s.trim();
  const m = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  if (m && !m[1].includes("\n```")) return m[1].trim();
  return t;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => `<u>${b || a}</u>`)
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "<u>$1</u>");
}

/** Light Markdown → HTML for the answer preview (escaped first; the real conversion happens server-side on insert). */
export function mdPreview(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  let code: string[] | null = null;
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw)) { out.push(`<pre>${esc(code.join("\n"))}</pre>`); code = null; } else code.push(raw);
      continue;
    }
    if (/^```/.test(raw)) { closeList(); code = []; continue; }
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) { closeList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) {
      closeList(); out.push(`<div>${m[1] === " " ? "☐" : "☑"} ${inline(m[2])}</div>`); continue;
    }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if ((m = /^>\s?(?:\[![a-z]+\]\s*)?(.*)$/i.exec(line))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  if (code) out.push(`<pre>${esc(code.join("\n"))}</pre>`);
  closeList();
  return out.join("");
}

/** Markdown without inline markers (for the word diff of rewrites). */
export function mdPlain(md: string): string {
  return md
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1").replace(/==([^=]+)==/g, "$1").replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
