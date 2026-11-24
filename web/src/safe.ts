/** URL helpers for content that comes from the API (any client can write any block or value). */

const LINK_OK = /^(https?|mailto|tel):/i;

/** A link target for a URL property: web, mail and phone links; a bare "site.fr" becomes https. Else null. */
export function safeHref(value: unknown): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (LINK_OK.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;     // javascript:, data:, vbscript:…
  return "https://" + v.replace(/^\/+/, "");
}

/** What an embed block may load: a web page (cross-origin) or a file uploaded to Carnet. */
export function safeEmbed(url: unknown): boolean {
  const v = String(url ?? "").trim();
  return /^https?:\/\//i.test(v) || /^\/files\/[a-z0-9]+\//.test(v);
}
