import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronRight, ChevronsLeft, Plus, Search, Trash2, Settings, MoreHorizontal, Star, StarOff, Copy, FileText,
  Table2, LayoutTemplate, SquarePen, CornerUpRight, Link2,
} from "lucide-react";
import { api, BOOT, Summary } from "../api";
import { pagePath, useApp } from "./store";
import { t } from "../i18n";
import { MenuItem, MenuSep, Popover } from "../ui/Popover";
import { MoveDialog } from "./Dialogs";

const EXP_KEY = "carnet:expanded";

function useExpanded() {
  const [set, setSet] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(EXP_KEY) || "[]")));
  const toggle = (id: string, v?: boolean) => setSet((s) => {
    const n = new Set(s);
    if (v ?? !n.has(id)) n.add(id); else n.delete(id);
    localStorage.setItem(EXP_KEY, JSON.stringify([...n].slice(-500)));
    return n;
  });
  return { has: (id: string) => set.has(id), toggle };
}

type DropPos = { id: string; where: "before" | "inside" | "after" } | null;

export function Sidebar({ onTrash, onSettings, onTemplates }: { onTrash: (e: React.MouseEvent) => void; onSettings: () => void; onTemplates: (e: React.MouseEvent) => void }) {
  const app = useApp();
  const exp = useExpanded();
  const [menu, setMenu] = useState<{ el: HTMLElement; p: Summary } | null>(null);
  const [move, setMove] = useState<Summary | null>(null);
  const [drop, setDrop] = useState<DropPos>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const roots = app.children(null).filter((p) => !p.is_template && !p.readonly);
  const mdRoots = app.children(null).filter((p) => p.readonly);
  const favs = useMemo(() => app.tree.filter((p) => p.favorite).sort((a, b) => (a.favorite || 0) - (b.favorite || 0)), [app.tree]);

  // keep the current page visible: expand its ancestors
  useEffect(() => {
    let cur = app.pageId ? app.byId.get(app.pageId) : undefined;
    let guard = 0;
    while (cur?.parent_id && guard++ < 50) {
      if (!exp.has(cur.parent_id)) exp.toggle(cur.parent_id, true);
      cur = app.byId.get(cur.parent_id);
    }
  }, [app.pageId, app.tree.length]);  // eslint-disable-line

  const addChild = async (parent: Summary | null) => {
    if (parent) exp.toggle(parent.id, true);
    if (parent?.kind === "database") await app.createPage({ parent_id: parent.id, title: "" });
    else await app.createPage({ parent_id: parent?.id ?? null, title: "" });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/carnet-page");
    const d = drop;
    setDrop(null);
    setDragId(null);
    if (!id || !d || id === d.id) return;
    const target = app.byId.get(d.id);
    if (!target) return;
    try {
      if (d.where === "inside") {
        await api.post(`/api/pages/${id}/move`, { parent_id: target.id });
        exp.toggle(target.id, true);
      } else {
        const sibs = app.children(target.parent_id).filter((s) => s.id !== id);
        const idx = sibs.findIndex((s) => s.id === target.id) + (d.where === "after" ? 1 : 0);
        await api.post(`/api/pages/${id}/move`, { parent_id: target.parent_id, index: idx });
      }
      await app.refresh();
    } catch (err: any) { app.toast(String(err.message)); }
  };

  const renderNode = (p: Summary, depth: number): React.ReactNode => {
    const kids = app.children(p.id).filter((c) => !c.is_template);
    const open = exp.has(p.id);
    const active = app.pageId === p.id;
    const isRowParent = p.kind === "database";
    const shown = isRowParent ? kids.slice(0, 50) : kids;
    const dp = drop?.id === p.id ? drop.where : null;
    return (
      <Fragment key={p.id}>
        <div className={`cn-node ${active ? "active" : ""} ${dp ? "drop-" + dp : ""} ${dragId === p.id ? "dragging" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={!p.readonly}
          onDragStart={(e) => { e.dataTransfer.setData("text/carnet-page", p.id); e.dataTransfer.effectAllowed = "move"; setDragId(p.id); }}
          onDragEnd={() => { setDragId(null); setDrop(null); }}
          onDragOver={(e) => {
            if (!dragId || dragId === p.id || p.readonly) return;
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const dragged = app.byId.get(dragId);
            const canInside = !(p.kind === "database" && dragged?.kind === "database");
            const where = y < 0.28 ? "before" : y > 0.72 || !canInside ? "after" : "inside";
            if (drop?.id !== p.id || drop.where !== where) setDrop({ id: p.id, where });
          }}
          onDrop={onDrop}
          onClick={() => app.navigate(p.id)}>
          {kids.length ? (
            <button type="button" className={`cn-node-tog ${open ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); exp.toggle(p.id); }}>
              <ChevronRight size={14} />
            </button>
          ) : <span className="cn-node-tog ph" />}
          <span className="cn-node-ic">{p.icon || (p.kind === "database" ? <Table2 size={15} /> : <FileText size={15} />)}</span>
          <a className="cn-node-tx" href={pagePath(p.id)} onClick={(e) => e.preventDefault()} draggable={false}>{p.title || t("Untitled")}</a>
          <span className="cn-node-act">
            <button type="button" title={t("More")} onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, p }); }}><MoreHorizontal size={15} /></button>
            {!p.readonly && <button type="button" title={t("Add a sub-page")} onClick={(e) => { e.stopPropagation(); addChild(p); }}><Plus size={15} /></button>}
          </span>
        </div>
        {open && shown.map((c) => renderNode(c, depth + 1))}
        {open && isRowParent && kids.length > 50 && <div className="cn-node-empty" style={{ paddingLeft: 26 + depth * 14 }}>+{kids.length - 50}…</div>}
      </Fragment>
    );
  };

  return (
    <aside className={`cn-sidebar ${app.sidebar ? "open" : ""}`}>
      <div className="cn-side-head">
        <span className="cn-ws-ic">{(BOOT.title || "C")[0]}</span>
        <span className="cn-ws-name">{BOOT.title}</span>
        <button type="button" className="cn-icon-btn" title={t("Close sidebar")} onClick={() => app.setSidebar(false)}><ChevronsLeft size={17} /></button>
        <button type="button" className="cn-icon-btn" title={t("New page")} onClick={() => addChild(null)}><SquarePen size={16} /></button>
      </div>
      <div className="cn-side-nav">
        <button type="button" className="cn-side-item" onClick={() => app.setSearchOpen(true)}><Search size={16} /> <span>{t("Search")}</span><kbd>Ctrl K</kbd></button>
      </div>
      <div className="cn-side-scroll" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}>
        {favs.length > 0 && (
          <div className="cn-side-sec">
            <div className="cn-side-label">{t("Favorites")}</div>
            {favs.map((p) => (
              <div key={"f" + p.id} className={`cn-node ${app.pageId === p.id ? "active" : ""}`} style={{ paddingLeft: 6 }} onClick={() => app.navigate(p.id)}>
                <span className="cn-node-tog ph" />
                <span className="cn-node-ic">{p.icon || <FileText size={15} />}</span>
                <span className="cn-node-tx">{p.title || t("Untitled")}</span>
              </div>
            ))}
          </div>
        )}
        <div className="cn-side-sec">
          <div className="cn-side-label">{t("Pages")}
            <button type="button" className="cn-icon-btn" title={t("Add a page")} onClick={() => addChild(null)}><Plus size={14} /></button>
          </div>
          {roots.map((p) => renderNode(p, 0))}
          <button type="button" className="cn-side-item muted" onClick={() => addChild(null)}><Plus size={15} /> <span>{t("Add a page")}</span></button>
        </div>
        {mdRoots.map((r) => (
          <div className="cn-side-sec" key={"md" + r.id}>
            <div className="cn-side-label" title={t("Markdown files, read only")}>{r.icon ? r.icon + " " : ""}{r.title} <span className="cn-side-ro">.md</span></div>
            {app.children(r.id).map((p) => renderNode(p, 0))}
          </div>
        ))}
      </div>
      <div className="cn-side-foot">
        <button type="button" className="cn-side-item" onClick={onTemplates}><LayoutTemplate size={16} /> <span>{t("Templates")}</span></button>
        <button type="button" className="cn-side-item" onClick={onTrash}><Trash2 size={16} /> <span>{t("Trash")}</span></button>
        <button type="button" className="cn-side-item" onClick={onSettings}><Settings size={16} /> <span>{t("Settings")}</span></button>
      </div>
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} width={240}>
          {menu.p.readonly ? (
            <MenuItem icon={<Link2 size={15} />} onClick={() => {
              navigator.clipboard?.writeText(location.origin + pagePath(menu.p.id)).then(() => app.toast(t("Link copied")));
              setMenu(null);
            }}>{t("Copy link")}</MenuItem>
          ) : <>
          <MenuItem icon={menu.p.favorite ? <StarOff size={15} /> : <Star size={15} />} onClick={async () => {
            await api.post(`/api/pages/${menu.p.id}`, { favorite: !menu.p.favorite });
            app.refresh(); setMenu(null);
          }}>{menu.p.favorite ? t("Remove from favorites") : t("Add to favorites")}</MenuItem>
          <MenuItem icon={<Link2 size={15} />} onClick={() => {
            navigator.clipboard?.writeText(location.origin + pagePath(menu.p.id)).then(() => app.toast(t("Link copied")));
            setMenu(null);
          }}>{t("Copy link")}</MenuItem>
          <MenuItem icon={<Copy size={15} />} onClick={async () => {
            const c = await api.post(`/api/pages/${menu.p.id}/duplicate`);
            await app.refresh(); app.navigate(c.id); setMenu(null);
          }}>{t("Duplicate")}</MenuItem>
          <MenuItem icon={<CornerUpRight size={15} />} onClick={() => { setMove(menu.p); setMenu(null); }}>{t("Move to")}</MenuItem>
          <MenuSep />
          <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { app.trashPage(menu.p.id); setMenu(null); }}>{t("Move to trash")}</MenuItem>
          </>}
        </Popover>
      )}
      {move && <MoveDialog page={move} onClose={() => setMove(null)} />}
    </aside>
  );
}
