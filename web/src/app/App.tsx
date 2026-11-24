import { useEffect, useState } from "react";
import {
  Menu as MenuIcon, ChevronsRight, FileText, Star, MoreHorizontal, Pencil, BookOpen, Copy, CornerUpRight, Trash2, History,
  FileDown, Printer, Lock, Unlock, LayoutTemplate, MoveHorizontal, CaseSensitive, Link2, X, Maximize2, RotateCcw, Type,
} from "lucide-react";
import { api, BASE, BOOT, Page } from "../api";
import { AppProvider, pagePath, useApp } from "./store";
import { Sidebar } from "./Sidebar";
import { HistoryModal, Login, MoveDialog, SearchPalette, SettingsModal, TemplatesPanel, TrashPanel } from "./Dialogs";
import { PageView } from "../page/PageView";
import { relTime, t } from "../i18n";
import { MenuItem, MenuLabel, MenuSep, Popover } from "../ui/Popover";
import { seedWelcome } from "./welcome";
import { ErrorBoundary } from "./ErrorBoundary";

function useSaveState() {
  const [s, setS] = useState<"saving" | "saved" | "error" | "">("");
  useEffect(() => {
    let h: any;
    const on = (e: Event) => {
      const v = (e as CustomEvent).detail;
      setS(v);
      clearTimeout(h);
      if (v === "saved") h = setTimeout(() => setS(""), 1500);
    };
    addEventListener("carnet:save", on);
    return () => removeEventListener("carnet:save", on);
  }, []);
  return s;
}

function useModeFor(page: { id: string; locked?: boolean } | null, mobile: boolean) {
  const [mode, setMode] = useState<Record<string, "edit" | "read">>({});
  const def = page?.locked ? "read" : mobile ? "read" : "edit";
  return {
    mode: page ? mode[page.id] || def : "edit",
    set: (m: "edit" | "read") => page && setMode((x) => ({ ...x, [page.id]: m })),
  };
}

function Topbar({ mode, setMode, page, onRestored }: { mode: "edit" | "read"; setMode: (m: "edit" | "read") => void; page: Page | null; onRestored: () => void }) {
  const app = useApp();
  const save = useSaveState();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [hist, setHist] = useState(false);
  const [move, setMove] = useState(false);
  const s = page ? app.byId.get(page.id) : undefined;
  const crumbs = page?.path || [];
  const opt = page?.options || {};
  const fail = (e: any) => app.toast(t("Your changes could not be saved: {msg}").replace("{msg}", String(e?.message || e)));
  const setOpt = async (o: Record<string, any>) => {
    if (!page) return;
    try {
      await api.post(`/api/pages/${page.id}`, { options: o });
      onRestored();
    } catch (e) { fail(e); }
  };
  return (
    <header className="cn-top">
      {(!app.sidebar || app.mobile) && (
        <button type="button" className="cn-icon-btn" title={t("Open sidebar")} onClick={() => app.setSidebar(true)}>
          {app.mobile ? <MenuIcon size={19} /> : <ChevronsRight size={18} />}
        </button>
      )}
      <nav className="cn-crumbs">
        {crumbs.map((c, i) => (
          <span key={c.id} className="cn-crumb">
            {i > 0 && <span className="sep">/</span>}
            <a onClick={() => app.navigate(c.id)}>{c.icon && <span className="ic">{c.icon}</span>}{(app.byId.get(c.id)?.title ?? c.title) || t("Untitled")}</a>
          </span>
        ))}
      </nav>
      <span className="grow" />
      {page && (
        <>
          <span className={`cn-save ${save}`}>{save === "saving" ? t("Saving…") : save === "error" ? t("Offline: changes kept, retrying…") : save === "saved" ? t("Saved") : !app.mobile ? `${t("Edited")} ${relTime(s?.updated_at || page.updated_at)}` : ""}</span>
          {page.readonly ? (
            <span className="cn-ro-badge" title={page.source?.path || ""}><FileText size={14} /> <span>{t("Markdown file · read only")}</span></span>
          ) : (
          <div className="cn-mode" role="group">
            <button type="button" className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")} title="Ctrl+Shift+L"><Pencil size={14} /> <span>{t("Edit")}</span></button>
            <button type="button" className={mode === "read" ? "on" : ""} onClick={() => setMode("read")} title="Ctrl+Shift+L"><BookOpen size={14} /> <span>{t("Read")}</span></button>
          </div>
          )}
          {!page.readonly && <button type="button" className={`cn-icon-btn ${s?.favorite ? "fav" : ""}`} title={s?.favorite ? t("Remove from favorites") : t("Add to favorites")}
            onClick={async () => { try { await api.post(`/api/pages/${page.id}`, { favorite: !s?.favorite }); await app.refresh(); } catch (e) { fail(e); } }}>
            <Star size={17} fill={s?.favorite ? "currentColor" : "none"} />
          </button>}
          <button type="button" className="cn-icon-btn" onClick={(e) => setMenu(e.currentTarget)}><MoreHorizontal size={18} /></button>
        </>
      )}
      {menu && page && page.readonly && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={260} placement="bottom-end">
          <MenuItem icon={<Link2 size={15} />} onClick={() => { navigator.clipboard?.writeText(location.origin + pagePath(page.id)).then(() => app.toast(t("Link copied"))); setMenu(null); }}>{t("Copy link")}</MenuItem>
          <MenuItem icon={<FileDown size={15} />} onClick={() => { location.href = `${BASE}/api/pages/${page.id}/export.md`; setMenu(null); }}>{t("Export as Markdown")}</MenuItem>
          <MenuItem icon={<Printer size={15} />} onClick={() => { setMenu(null); setTimeout(() => print(), 300); }}>{t("Export as PDF")}</MenuItem>
        </Popover>
      )}
      {menu && page && !page.readonly && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={260} placement="bottom-end">
          <MenuLabel>{t("Font")}</MenuLabel>
          <div className="cn-fonts">
            {([["", "Ag", "Default"], ["serif", "Ag", "Serif"], ["mono", "Ag", "Mono"]] as const).map(([k, g, l]) => (
              <button type="button" key={k} className={`f-${k || "default"} ${(opt.font || "") === k ? "on" : ""}`} onClick={() => setOpt({ font: k })}><b>{g}</b><span>{t(l)}</span></button>
            ))}
          </div>
          <MenuItem icon={<Type size={15} />} right={<input type="checkbox" readOnly checked={!!opt.small_text} />} onClick={() => setOpt({ small_text: !opt.small_text })}>{t("Small text")}</MenuItem>
          <MenuItem icon={<MoveHorizontal size={15} />} right={<input type="checkbox" readOnly checked={!!opt.full_width} />} onClick={() => setOpt({ full_width: !opt.full_width })}>{t("Full width")}</MenuItem>
          <MenuItem icon={opt.locked ? <Unlock size={15} /> : <Lock size={15} />} onClick={() => { setOpt({ locked: !opt.locked }); setMode(opt.locked ? "edit" : "read"); setMenu(null); }}>{opt.locked ? t("Unlock page") : t("Lock page")}</MenuItem>
          <MenuSep />
          <MenuItem icon={<Link2 size={15} />} onClick={() => { navigator.clipboard?.writeText(location.origin + pagePath(page.id)).then(() => app.toast(t("Link copied"))); setMenu(null); }}>{t("Copy link")}</MenuItem>
          <MenuItem icon={<Copy size={15} />} onClick={async () => { setMenu(null); try { const c = await api.post(`/api/pages/${page.id}/duplicate`); await app.refresh(); app.navigate(c.id); } catch (e) { fail(e); } }}>{t("Duplicate")}</MenuItem>
          <MenuItem icon={<CornerUpRight size={15} />} onClick={() => { setMove(true); setMenu(null); }}>{t("Move to")}</MenuItem>
          <MenuItem icon={<LayoutTemplate size={15} />} onClick={async () => { setMenu(null); try { await api.post(`/api/pages/${page.id}`, { is_template: !page.is_template }); await app.refresh(); onRestored(); } catch (e) { fail(e); } }}>
            {page.is_template ? t("Stop being a template") : t("Turn into template")}
          </MenuItem>
          <MenuItem icon={<History size={15} />} onClick={() => { setHist(true); setMenu(null); }}>{t("Page history")}</MenuItem>
          <MenuSep />
          <MenuItem icon={<FileDown size={15} />} onClick={() => { location.href = `${BASE}/api/pages/${page.id}/export.md`; setMenu(null); }}>{t("Export as Markdown")}</MenuItem>
          <MenuItem icon={<Printer size={15} />} onClick={() => { setMenu(null); setMode("read"); setTimeout(() => print(), 300); }}>{t("Export as PDF")}</MenuItem>
          <MenuSep />
          <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { app.trashPage(page.id); setMenu(null); }}>{t("Move to trash")}</MenuItem>
        </Popover>
      )}
      {hist && page && <HistoryModal pageId={page.id} onClose={() => setHist(false)} onRestored={onRestored} />}
      {move && page && <MoveDialog page={page} onClose={() => setMove(false)} />}
    </header>
  );
}

function Peek() {
  const app = useApp();
  const [mode, setMode] = useState<"edit" | "read">(app.mobile ? "read" : "edit");
  if (!app.peek) return null;
  const p = app.byId.get(app.peek);
  return (
    <>
      <div className="cn-peek-bg" onClick={() => app.setPeek(null)} />
      <aside className="cn-peek">
        <div className="cn-peek-top">
          <button type="button" className="cn-icon-btn" onClick={() => app.setPeek(null)} title={t("Close")}><X size={18} /></button>
          <button type="button" className="cn-icon-btn" onClick={() => app.navigate(app.peek)} title={t("Open in full page")}><Maximize2 size={16} /></button>
          <span className="grow" />
          <div className="cn-mode">
            <button type="button" className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}><Pencil size={14} /> <span>{t("Edit")}</span></button>
            <button type="button" className={mode === "read" ? "on" : ""} onClick={() => setMode("read")}><BookOpen size={14} /> <span>{t("Read")}</span></button>
          </div>
          {p && <button type="button" className="cn-icon-btn" title={t("Move to trash")} onClick={async () => { const parent = p.parent_id; await app.trashPage(p.id); app.setPeek(null); window.dispatchEvent(new CustomEvent("carnet:changed", { detail: { id: parent } })); }}><Trash2 size={16} /></button>}
        </div>
        <div id="cn-tb-peek" className="cn-tb-slot" />
        <div className="cn-peek-body">
          <PageView key={app.peek} pageId={app.peek} editable={mode === "edit"} peek />
        </div>
      </aside>
    </>
  );
}

function Toasts() {
  const app = useApp();
  return (
    <div className="cn-toasts">
      {app.toasts.map((x) => (
        <div key={x.id} className="cn-toast">{x.text}{x.action && <button type="button" onClick={x.action.run}><RotateCcw size={13} /> {x.action.label}</button>}</div>
      ))}
    </div>
  );
}

function Main() {
  const app = useApp();
  const [trash, setTrash] = useState<HTMLElement | null>(null);
  const [tpl, setTpl] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [reload, setReload] = useState(0);
  const pid = app.pageId;
  const { mode, set: setMode } = useModeFor(page ? { id: page.id, locked: !!page.options?.locked } : null, app.mobile);

  // home: last page, else the first one, else a welcome page
  useEffect(() => {
    if (pid || !app.tree.length && !(window as any).__carnetLoaded) return;
    const last = localStorage.getItem("carnet:last");
    const first = app.children(null).find((p) => !p.is_template);
    if (last && app.byId.has(last)) app.navigate(last, { replace: true });
    else if (first) app.navigate(first.id, { replace: true });
  }, [pid, app.tree]);  // eslint-disable-line
  useEffect(() => {
    api.get("/api/bootstrap").then(async (b) => {
      (window as any).__carnetLoaded = true;
      if (!b.tree.length && !localStorage.getItem("carnet:seeded")) {
        localStorage.setItem("carnet:seeded", "1");
        const id = await seedWelcome();
        await app.refresh();
        app.navigate(id, { replace: true });
      }
    }).catch(() => {});
  }, []);  // eslint-disable-line

  // page meta for the top bar (title/breadcrumbs/options)
  useEffect(() => {
    if (!pid) { setPage(null); return; }
    // a late answer for the previous page must not land on the current one
    let live = true;
    api.get<Page>(`/api/pages/${pid}`).then((p) => { if (live) setPage(p); }).catch(() => { if (live) setPage(null); });
    return () => { live = false; };
  }, [pid, reload]);
  useEffect(() => {
    const s = page ? app.byId.get(page.id) : null;
    document.title = (s ? `${s.icon ? s.icon + " " : ""}${s.title || t("Untitled")} · ` : "") + BOOT.title;
  }, [page, app.byId]);

  // shortcuts
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); app.setSearchOpen(true); }
      else if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) { e.preventDefault(); app.setSearchOpen(true); }
      else if (mod && e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); app.createPage({ title: "" }); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); setMode(mode === "edit" ? "read" : "edit"); }
      else if (mod && e.key === "\\") { e.preventDefault(); app.setSidebar(!app.sidebar); }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [app, mode, setMode]);

  return (
    <div className={`cn-app ${app.sidebar ? "with-side" : ""} ${app.mobile ? "mobile" : ""} mode-${mode}`}>
      {app.mobile && app.sidebar && <div className="cn-side-backdrop" onClick={() => app.setSidebar(false)} />}
      <Sidebar onTrash={(e) => setTrash(e.currentTarget as HTMLElement)} onTemplates={(e) => setTpl(e.currentTarget as HTMLElement)} onSettings={() => setSettings(true)} />
      <main className="cn-main">
        <Topbar mode={mode} setMode={setMode} page={page} onRestored={() => { setReload((x) => x + 1); window.dispatchEvent(new CustomEvent("carnet:changed", { detail: { id: pid } })); }} />
        <div id="cn-tb-main" className="cn-tb-slot" />
        <div className="cn-scroll">
          {pid ? <PageView key={pid} pageId={pid} editable={mode === "edit" && !page?.in_trash && !page?.readonly} /> : <div className="cn-page-loading" />}
          {page?.in_trash && (
            <div className="cn-trash-banner">{t("This page is in the trash.")}
              <button type="button" className="cn-btn sm" onClick={async () => { try { await api.post(`/api/pages/${page.id}/restore`); await app.refresh(); setReload((x) => x + 1); } catch (e) { app.toast(String((e as any)?.message || e)); } }}>{t("Restore")}</button>
            </div>
          )}
        </div>
      </main>
      <Peek />
      <Toasts />
      {app.searchOpen && <SearchPalette onClose={() => app.setSearchOpen(false)} />}
      {trash && <Popover anchor={trash} onClose={() => setTrash(null)} width={380} placement="right-start"><TrashPanel onClose={() => setTrash(null)} /></Popover>}
      {tpl && <Popover anchor={tpl} onClose={() => setTpl(null)} width={340} placement="right-start"><TemplatesPanel onClose={() => setTpl(null)} /></Popover>}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

export function App() {
  if (BOOT.protected && !BOOT.loggedIn) return <Login />;
  return <ErrorBoundary><AppProvider><Main /></AppProvider></ErrorBoundary>;
}
