// Chat answers as HTML: Markdown (mdPreview, escaped) plus maths rendered with KaTeX, as in the page itself.
import katex from "katex";

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])([^$\n]*?[^\s$\\])\$(?!\d)/g;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: true, strict: "ignore", trust: false, output: "html" });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

/** Safe HTML for a chat answer. Maths are pulled out before the Markdown pass (it would mangle `_`, `*`, `<`) and put back after. */
export function chatHtml(md: string, preview: (md: string) => string): string {
  const maths: string[] = [];
  const text = md.replace(MATH, (_m, a, b, c, d) => {
    const display = a !== undefined || b !== undefined;
    maths.push(render((a ?? b ?? c ?? d).trim(), display));
    return `\uE000${maths.length - 1}\uE001`;
  });
  return preview(text).replace(/\uE000(\d+)\uE001/g, (_m, i) => maths[Number(i)] ?? "");
}
