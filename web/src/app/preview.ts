/** Read-only HTML of a page's blocks (page history). Every value is escaped: blocks come from the API as-is. */

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export type PreviewOpts = { base: string; tex: (latex: string, display: boolean) => { html: string; error: string } };

const COLOR = /^[a-z_]{1,20}$/;

function inlineHtml(c: any, o: PreviewOpts): string {
  return (Array.isArray(c) ? c : []).map((x: any) => {
    if (!x || typeof x !== "object") return "";
    if (x.type === "text") {
      let s = esc(x.text);
      if (x.styles?.bold) s = `<b>${s}</b>`;
      if (x.styles?.italic) s = `<i>${s}</i>`;
      if (x.styles?.code) s = `<code>${s}</code>`;
      if (x.styles?.strike) s = `<s>${s}</s>`;
      return s;
    }
    if (x.type === "link") return `<u>${inlineHtml(x.content, o)}</u>`;
    if (x.type === "pageMention") return `<span class="cn-mention">${esc(x.props?.title || "")}</span>`;
    if (x.type === "inlineMath") return o.tex(String(x.props?.latex || ""), false).html;
    return "";
  }).join("");
}

export function blocksPreview(blocks: any, o: PreviewOpts): string {
  return (Array.isArray(blocks) ? blocks : []).map((b: any) => {
    if (!b || typeof b !== "object") return "";
    const c = inlineHtml(b.content, o);
    const kids = b.children?.length ? `<div style="margin-left:24px">${blocksPreview(b.children, o)}</div>` : "";
    switch (b.type) {
      case "heading": {
        const n = Number(b.props?.level);
        const lv = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 1;
        return `<h${lv}>${c}</h${lv}>${kids}`;
      }
      case "bulletListItem": return `<div>• ${c}</div>${kids}`;
      case "numberedListItem": return `<div>1. ${c}</div>${kids}`;
      case "checkListItem": return `<div>${b.props?.checked ? "☑" : "☐"} ${c}</div>${kids}`;
      case "quote": return `<blockquote>${c}</blockquote>${kids}`;
      case "callout": {
        const color = COLOR.test(String(b.props?.color || "")) ? b.props.color : "default";
        return `<div class="cn-callout bg-${color}"><span>${esc(b.props?.emoji || "")}</span> ${c}</div>${kids}`;
      }
      case "codeBlock": return `<pre>${c}</pre>`;
      case "math": return o.tex(String(b.props?.latex || ""), true).html;
      case "diagram": return `<pre>${esc(String(b.props?.code || ""))}</pre>`;
      case "whiteboard": return b.props?.data ? `<p><em>✎ Whiteboard</em></p>` : "";
      case "divider": return "<hr>";
      case "image": {
        const url = String(b.props?.url || "");
        return `<img src="${esc(url.startsWith("/files/") ? o.base + url : url)}" style="max-width:100%">`;
      }
      case "table": return `<table>${(b.content?.rows || []).map((r: any) => `<tr>${(r?.cells || []).map((cell: any) =>
        `<td>${inlineHtml(Array.isArray(cell) ? cell : cell?.content, o)}</td>`).join("")}</tr>`).join("")}</table>`;
      default: return `<p>${c}</p>${kids}`;
    }
  }).join("");
}
