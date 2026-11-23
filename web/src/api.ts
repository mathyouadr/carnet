// API client. Every path is relative to the app base (<base href> is injected by the server).
export const BOOT: {
  base: string; protected: boolean; loggedIn: boolean; version: string; title: string; lang: string;
  theme: string; maxUploadMb: number;
} = (window as any).CARNET || { base: "", protected: false, loggedIn: true, version: "dev", title: "Carnet", lang: "", theme: "", maxUploadMb: 50 };

export const BASE = BOOT.base || "";

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Writes go out one at a time, in order: a new select option must reach the server before the row using it.
let queue: Promise<unknown> = Promise.resolve();

function call<T = any>(method: string, path: string, body?: any): Promise<T> {
  if (method === "GET") return send<T>(method, path, body);
  const p = queue.then(() => send<T>(method, path, body));
  queue = p.catch(() => undefined);
  return p;
}

async function send<T = any>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && BOOT.protected) location.reload();
    throw new ApiError(res.status, data?.error || res.statusText, data);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => call<T>("GET", p),
  post: <T = any>(p: string, b: any = {}) => call<T>("POST", p, b),
  del: <T = any>(p: string, b?: any) => call<T>("DELETE", p, b),
  async upload(file: File | Blob, name: string, pageId?: string): Promise<{ url: string }> {
    const res = await fetch(BASE + "/api/files", {
      method: "POST", body: file, credentials: "same-origin",
      headers: { "X-Carnet-Upload": "1", "X-Filename": encodeURIComponent(name), "Content-Type": (file as File).type || "application/octet-stream", ...(pageId ? { "X-Page-Id": pageId } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || "upload failed");
    return data;
  },
  async importFile(file: File, parentId: string | null, databases: boolean) {
    const q = new URLSearchParams();
    if (parentId) q.set("parent_id", parentId);
    if (!databases) q.set("databases", "0");
    const res = await fetch(BASE + "/api/import?" + q, {
      method: "POST", body: file, credentials: "same-origin",
      headers: { "X-Carnet-Upload": "1", "X-Filename": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || "import failed");
    return data;
  },
};

/** Stored file URLs are "/files/<id>/<name>": make them absolute for the current base. */
export function fileUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("/files/")) return BASE + url;
  return url;
}

// ------------------------------------------------------------------ types
export type Summary = {
  id: string; parent_id: string | null; kind: "page" | "database"; title: string; icon: string;
  position: number; favorite: number | null; is_template: number; inline: number; updated_at: string;
  created_at: string; is_row?: boolean;
  /** page read from a Markdown folder (CARNET_MD_FOLDERS): shown, never edited */
  readonly?: boolean; source?: { folder: string; path: string };
};

export type PropType = "text" | "number" | "select" | "multi_select" | "status" | "date" | "checkbox" | "url" |
  "email" | "phone" | "relation" | "created_time" | "edited_time";

export type Option = { id: string; name: string; color: string; group?: "todo" | "doing" | "done" };
export type Property = { id: string; name: string; type: PropType; options?: Option[]; database_id?: string; format?: string; time?: boolean };
export type Schema = { title_name: string; properties: Property[] };
export type Filter = { prop: string; op: string; value?: any };
export type Sort = { prop: string; dir: "asc" | "desc" };
export type View = {
  id: string; name: string; type: "table" | "board" | "list" | "gallery" | "calendar";
  filters?: Filter[]; filter_mode?: "and" | "or"; sorts?: Sort[]; hidden?: string[]; widths?: Record<string, number>;
  group_by?: string; date_prop?: string; card_cover?: "cover" | "content" | "none"; card_size?: "small" | "medium" | "large";
  wrap?: boolean; order?: string[]; collapsed?: string[];
  /** shown only through a linked view block, not in the database's own tabs */
  embed_only?: boolean;
};
export type Row = Summary & { props: Record<string, any>; cover: string; has_content: boolean; preview: string };

export type Page = Summary & {
  cover: string; content: any[]; props: Record<string, any>; options: Record<string, any>; rev: number;
  trashed_at: string | null; in_trash: boolean; path: { id: string; title: string; icon: string; kind: string }[];
  schema?: Schema; views?: View[]; rows?: Row[];
  database?: { id: string; title: string; icon: string; schema: Schema };
  backlinks: Summary[]; children: Summary[];
  share?: { token: string; created_at: string } | null;
};
