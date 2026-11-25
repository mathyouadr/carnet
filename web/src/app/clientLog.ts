// Errors seen in the browser are sent to the server log (POST /api/client-log): a button that "does nothing"
// usually hides an uncaught error, and the browser console is gone once the tab is closed.
import { BASE } from "../api";

let sent = 0;
const MAX = 20;                       // per page load: a loop of errors must not flood the log
const seen = new Set<string>();

export function reportError(kind: string, err: unknown) {
  const e = err as any;
  const message = String(e?.message ?? e ?? "").slice(0, 300);
  const key = kind + message;
  if (sent >= MAX || seen.has(key)) return;
  seen.add(key); sent++;
  const body = JSON.stringify({ kind, message, stack: String(e?.stack ?? "").slice(0, 1200), url: location.pathname });
  try {
    fetch(BASE + "/api/client-log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never let the reporter itself throw */ }
}

/** A Carnet update (new build) removes the old code chunks: an open tab can no longer load them and parts of the
 *  page stop answering until it is reloaded. Vite signals it with `vite:preloadError`. */
export function installClientLog(onStale: () => void) {
  addEventListener("error", (e) => reportError("error", e.error || e.message));
  addEventListener("unhandledrejection", (e) => reportError("rejection", e.reason));
  addEventListener("vite:preloadError", (e: any) => {
    reportError("stale", e?.payload || "chunk load failed");
    onStale();
  });
}
