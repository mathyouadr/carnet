// Public links (/s/...) are plain HTML pages: they load KaTeX from carnet/static/share/katex to show formulas.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "node_modules", "katex", "dist");
const dst = join(here, "..", "..", "carnet", "static", "share", "katex");
mkdirSync(join(dst, "fonts"), { recursive: true });
for (const f of ["katex.min.js", "katex.min.css"]) cpSync(join(src, f), join(dst, f));
cpSync(join(src, "fonts"), join(dst, "fonts"), { recursive: true, filter: (p) => !p.endsWith(".ttf") && !p.endsWith(".woff") || p.endsWith("fonts") });
console.log("KaTeX copied to", dst);
