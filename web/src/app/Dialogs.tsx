import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Table2, Search as SearchIcon, RotateCcw, Trash2, Upload, Download, Sun, Moon, Monitor, Clock, LogOut, Plus, LayoutTemplate, CornerDownLeft } from "lucide-react";
import { api, BASE, BOOT, Summary } from "../api";
import { useApp } from "./store";
import { fmtStamp, LANG, relTime, t } from "../i18n";
import { MenuItem, Modal } from "../ui/Popover";
import { setThemePref, themePref } from "./theme";
import { renderTex } from "../editor/schema";
import { blocksPreview as preview } from "./preview";

// ------------------------------------------------------------------ move
export function MoveDialog({ page, onClose }: { page: Summary; onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const forbidden = useMemo(() => {
    const out = new Set([page.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of app.tree) if (p.parent_id && out.has(p.parent_id) && !out.has(p.id)) { out.add(p.id); grew = true; }
    }
    return out;
  }, [app.tree, page.id]);
  const cands = app.tree.filter((p) => !forbidden.has(p.id) && !p.is_row && !p.is_template && !(p.kind === "database" && page.kind === "database") &&
    (p.title || t("Untitled")).toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const go = async (parent: string | null) => {
    try {
      await api.post(`/api/pages/${page.id}/move`, { parent_id: parent });
      await app.refresh();
      onClose();
    } catch (e: any) { app.toast(String(e.message)); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="cn-palette">
        <div className="cn-palette-in"><SearchIcon size={17} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Choose where to move")} /></div>
        <div className="cn-palette-list">
          <MenuItem icon={<CornerDownLeft size={15} />} onClick={() => go(null)}>{t("Top level")}</MenuItem>
          {cands.map((p) => (
            <MenuItem key={p.id} icon={<span>{p.icon || (p.kind === "database" ? <Table2 size={15} /> : <FileText size={15} />)}</span>} onClick={() => go(p.id)}
              right={<span className="cn-muted">{app.byId.get(p.parent_id || "")?.title || ""}</span>}>{p.title || t("Untitled")}</MenuItem>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ search palette (Ctrl+K)
function Snippet({ s }: { s: string }) {
  const parts = s.split(/(\u0002[^\u0003]*\u0003)/);
  return <>{parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await api.get(`/api/search?q=${encodeURIComponent(q)}&limit=25`);
        if (n === seq.current) { setRes(r.results); setSel(0); }
      } catch { /* offline */ }
    }, q ? 120 : 0);
    return () => clearTimeout(h);
  }, [q]);
  const open = (id: string) => { onClose(); app.navigate(id); };
  return (
    <Modal onClose={onClose} className="top">
      <div className="cn-palette">
        <div className="cn-palette-in"><SearchIcon size={17} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search pages…")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") {
                e.preventDefault();
                if (sel < res.length && res[sel]) open(res[sel].id);
                else if (q.trim()) { onClose(); app.createPage({ title: q.trim() }); }
              }
            }} />
        </div>
        <div className="cn-palette-list">
          {!q && <div className="cn-mlabel">{t("Recent")}</div>}
          {res.map((r, i) => (
            <button type="button" key={r.id} className={`cn-hit ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => open(r.id)}>
              <span className="ic">{r.icon || (r.kind === "database" ? <Table2 size={16} /> : <FileText size={16} />)}</span>
              <span className="body">
                <span className="title">{r.title || t("Untitled")}{r.path?.length ? <span className="path"> — {r.path.join(" / ")}</span> : null}</span>
                {r.snippet && <span className="snip"><Snippet s={r.snippet} /></span>}
              </span>
              {!q && <span className="cn-muted when">{relTime(r.updated_at)}</span>}
            </button>
          ))}
          {q.trim() && (
            <button type="button" className={`cn-hit ${sel === res.length ? "sel" : ""}`} onMouseEnter={() => setSel(res.length)} onClick={() => { onClose(); app.createPage({ title: q.trim() }); }}>
              <span className="ic"><Plus size={16} /></span><span className="body"><span className="title">{t("New page")} « {q.trim()} »</span></span>
            </button>
          )}
          {q && !res.length && <div className="cn-muted pad">{t("No results")}</div>}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ trash
export function TrashPanel({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const load = () => api.get("/api/trash").then((r) => setItems(r.results));
  useEffect(() => { load(); }, []);
  const shown = (items || []).filter((p) => (p.title || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="cn-trash">
      <div className="pad"><input className="cn-input" autoFocus placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="cn-trash-list">
        {items && !items.length && <div className="cn-muted pad">{t("Trash is empty")}</div>}
        {shown.map((p) => (
          <div key={p.id} className="cn-trash-row">
            <span className="ic">{p.icon || <FileText size={15} />}</span>
            <span className="tx" onClick={() => { app.navigate(p.id); onClose(); }}>
              {p.title || t("Untitled")}
              {p.path?.length > 0 && <small>{p.path.map((x: any) => x.title || t("Untitled")).join(" / ")}</small>}
            </span>
            <button type="button" className="cn-icon-btn" title={t("Restore")} onClick={async () => { await api.post(`/api/pages/${p.id}/restore`); load(); app.refresh(); }}><RotateCcw size={15} /></button>
            <button type="button" className="cn-icon-btn" title={t("Delete forever")} onClick={async () => {
              if (!confirm(`${t("Delete forever")} : ${p.title || t("Untitled")} ?`)) return;
              await api.del(`/api/pages/${p.id}?forever=1`); load();
            }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <div className="cn-trash-foot">
        <span className="cn-muted">{t("Pages in the trash are deleted after 30 days.")}</span>
        {!!items?.length && <button type="button" className="cn-btn sm danger" onClick={async () => {
          if (!confirm(t("Empty trash") + " ?")) return;
          await api.post("/api/trash/empty"); load();
        }}>{t("Empty trash")}</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ templates
export function TemplatesPanel({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const tpls = app.tree.filter((p) => p.is_template && !p.is_row && !app.byId.get(p.parent_id || "")?.is_template);
  return (
    <div>
      {!tpls.length && <div className="cn-muted pad">{t("No templates yet: open a page's ⋯ menu > Turn into template.")}</div>}
      {tpls.map((p) => (
        <MenuItem key={p.id} icon={<span>{p.icon || <LayoutTemplate size={15} />}</span>}
          right={<button type="button" className="cn-btn sm" onClick={async (e) => {
            e.stopPropagation();
            // the new page goes next to the page being read (at the top level when none is a plain page)
            const here = app.byId.get(app.pageId || "");
            const parent = here && here.kind === "page" && !here.is_row && !here.is_template ? here.parent_id : null;
            try {
              const np = await api.post(`/api/templates/${p.id}/use`, { parent_id: parent });
              await app.refresh(); app.navigate(np.id); onClose();
            } catch (err: any) { app.toast(String(err?.message)); }
          }}>{t("Use template")}</button>}
          onClick={() => { app.navigate(p.id); onClose(); }}>{p.title || t("Untitled")}</MenuItem>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ history
export function HistoryModal({ pageId, onClose, onRestored }: { pageId: string; onClose: () => void; onRestored: () => void }) {
  const app = useApp();
  const [list, setList] = useState<any[] | null>(null);
  const [cur, setCur] = useState<any>(null);
  const [md, setMd] = useState("");
  useEffect(() => { api.get(`/api/pages/${pageId}/versions`).then((r) => { setList(r.results); if (r.results[0]) pick(r.results[0].id); }); }, [pageId]);  // eslint-disable-line
  const pick = async (id: number) => {
    const v = await api.get(`/api/versions/${id}`);
    setCur(v);
    setMd(blocksPreview(v.content));
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="cn-history">
        <div className="cn-history-preview">
          {cur ? <><h1>{cur.icon} {cur.title || t("Untitled")}</h1><div className="cn-history-body" dangerouslySetInnerHTML={{ __html: md }} /></>
            : <div className="cn-muted pad">{list && !list.length ? t("No history yet: versions are kept every 10 minutes while you edit.") : t("Loading…")}</div>}
        </div>
        <div className="cn-history-side">
          <div className="cn-mlabel">{t("Page history")}</div>
          <div className="cn-history-list">
            {(list || []).map((v) => (
              <button type="button" key={v.id} className={`cn-hist-item ${cur?.id === v.id ? "on" : ""}`} onClick={() => pick(v.id)}>
                <Clock size={14} /> <span>{fmtStamp(v.created_at)}</span><small>{relTime(v.created_at)}</small>
              </button>
            ))}
          </div>
          <div className="row pad">
            <button type="button" className="cn-btn" onClick={onClose}>{t("Close")}</button>
            <button type="button" className="cn-btn primary" disabled={!cur} onClick={async () => {
              await api.post(`/api/versions/${cur.id}/restore`);
              app.toast(t("Version restored"));
              onRestored();
              onClose();
            }}>{t("Restore this version")}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function blocksPreview(blocks: any[]): string {
  return preview(blocks, { base: BASE, tex: renderTex });
}

// ------------------------------------------------------------------ settings
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [theme, setTheme] = useState(themePref());
  const [busy, setBusy] = useState("");
  const [dbs, setDbs] = useState(true);
  const [lang, setLang] = useState(localStorage.getItem("carnet:lang") || "");
  const forced = !!BOOT.theme;
  return (
    <Modal onClose={onClose}>
      <div className="cn-settings">
        <h2>{t("Settings")}</h2>
        {!forced && (
          <section>
            <h3>{t("Theme")}</h3>
            <div className="cn-seg">
              {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([k, I, l]) => (
                <button type="button" key={k} className={theme === k ? "on" : ""} onClick={() => { setTheme(k); setThemePref(k); }}><I size={15} /> {t(l)}</button>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3>{t("Language")}</h3>
          <div className="cn-seg">
            {([["", "Auto"], ["fr", "Français"], ["en", "English"]] as const).map(([k, l]) => (
              <button type="button" key={k} className={lang === k ? "on" : ""} onClick={() => {
                setLang(k);
                if (k) localStorage.setItem("carnet:lang", k); else localStorage.removeItem("carnet:lang");
                location.reload();
              }}>{l}</button>
            ))}
          </div>
        </section>
        <section>
          <h3>{t("Import")}</h3>
          <p className="cn-muted">{t("A .zip of your vault / Notion \"Markdown & CSV\" export, or a .md file.")}</p>
          <label className="cn-toggle-row"><input type="checkbox" checked={dbs} onChange={(e) => setDbs(e.target.checked)} /> {t("Folders of notes with properties become databases")}</label>
          <label className={`cn-btn ${busy ? "disabled" : ""}`}>
            <Upload size={15} /> {busy || t("Choose a file")}
            <input type="file" accept=".zip,.md,.markdown,.txt" hidden disabled={!!busy} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(t("Importing…"));
              try {
                const r = await api.importFile(f, null, dbs);
                await app.refresh();
                app.toast(`${t("Imported")} : ${r.pages + r.templates} ${t("pages")}, ${r.databases} ${t("databases")}, ${r.files} ${t("files")}`);
                if (r.root_id) app.navigate(r.root_id);
                onClose();
              } catch (err: any) { app.toast(String(err.message)); }
              setBusy("");
            }} />
          </label>
        </section>
        <section>
          <h3>{t("Export")}</h3>
          <a className="cn-btn" href={`${BASE}/api/export.zip`} download><Download size={15} /> {t("Export everything (Markdown .zip)")}</a>
        </section>
        <section className="cn-about">
          <h3>{t("About")}</h3>
          <p className="cn-muted">Carnet {BOOT.version} — <a href="https://github.com/mathyouadr/carnet" target="_blank" rel="noreferrer">github.com/mathyouadr/carnet</a> · AGPL-3.0</p>
          <p className="cn-muted">{LANG === "fr" ? "Raccourcis" : "Shortcuts"} : Ctrl+K {t("Search").toLowerCase()} · Ctrl+Alt+N {t("New page").toLowerCase()} · Ctrl+Shift+L {t("Read").toLowerCase()}/{t("Edit").toLowerCase()} · / {LANG === "fr" ? "commandes" : "commands"} · @ {t("Mention a page").toLowerCase()}</p>
          {BOOT.protected && <button type="button" className="cn-btn" onClick={async () => { await api.post("/api/logout"); location.reload(); }}><LogOut size={15} /> {t("Log out")}</button>}
        </section>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ login
export function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="cn-login">
      <form onSubmit={async (e) => {
        e.preventDefault();
        try { await api.post("/api/login", { password: pw }); location.reload(); } catch (x: any) { setErr(x.status === 429 ? String(x.message) : t("Wrong password")); }
      }}>
        <div className="cn-login-logo">{(BOOT.title || "C")[0]}</div>
        <h1>{BOOT.title}</h1>
        <input className="cn-input" type="password" autoFocus autoComplete="current-password" placeholder={t("Password")} value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="cn-btn primary block">{t("Sign in")}</button>
        {err && <div className="cn-err">{err}</div>}
      </form>
    </div>
  );
}
