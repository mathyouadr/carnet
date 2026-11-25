import { useState } from "react";
import { FileText, Plus, Table2, X, Copy, XCircle, ArrowRightToLine } from "lucide-react";
import { useApp } from "./store";
import { t } from "../i18n";
import { MenuItem, Popover } from "../ui/Popover";

/** Desktop tab bar above the page, like Notion desktop or a file explorer.
 *  Ctrl/Cmd + click or middle click on any page link opens it in a new tab; middle click on a tab closes it;
 *  tabs can be reordered by drag and drop, and a page dragged from the sidebar opens in a new tab. */
export function TabBar() {
  const app = useApp();
  const { list, active } = app.tabs;
  const [menu, setMenu] = useState<{ at: DOMRect; k: string } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [mark, setMark] = useState<number | null>(null);     // drop position (index before which the tab lands)
  const single = list.length <= 1;

  const newTab = () => { app.openTab(app.pageId); app.setSearchOpen(true); };
  const posFrom = (e: React.DragEvent, i: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? i : i + 1;
  };
  const accepts = (e: React.DragEvent) => !!drag || e.dataTransfer.types.includes("text/carnet-page");
  const onDrop = (e: React.DragEvent, at: number) => {
    e.preventDefault();
    if (drag) app.moveTab(drag, at);
    else {
      const id = e.dataTransfer.getData("text/carnet-page");
      if (id) app.openTab(id);
    }
    setDrag(null); setMark(null);
  };

  return (
    <div className="cn-ptabs" role="tablist"
      onDoubleClick={(e) => { if (e.target === e.currentTarget) newTab(); }}
      onDragOver={(e) => { if (accepts(e) && e.target === e.currentTarget) { e.preventDefault(); setMark(list.length); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMark(null); }}
      onDrop={(e) => onDrop(e, mark ?? list.length)}>
      {list.map((tab, i) => {
        const p = tab.id ? app.byId.get(tab.id) : undefined;
        const title = tab.id ? (p ? p.title || t("Untitled") : t("Untitled")) : t("New tab");
        const on = tab.k === active;
        return (
          <div key={tab.k} role="tab" aria-selected={on} title={title}
            className={`cn-ptab ${on ? "on" : ""} ${drag === tab.k ? "drag" : ""} ${mark === i ? "mark-l" : ""} ${mark === i + 1 && i === list.length - 1 ? "mark-r" : ""}`}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/carnet-tab", tab.k); e.dataTransfer.effectAllowed = "move"; setDrag(tab.k); }}
            onDragEnd={() => { setDrag(null); setMark(null); }}
            onDragOver={(e) => { if (!accepts(e)) return; e.preventDefault(); e.stopPropagation(); setMark(posFrom(e, i)); }}
            onDrop={(e) => { e.stopPropagation(); onDrop(e, posFrom(e, i)); }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onClick={() => app.switchTab(tab.k)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); app.closeTab(tab.k); } }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ at: new DOMRect(e.clientX, e.clientY, 0, 0), k: tab.k }); }}>
            <span className="ic">{p?.icon || (p?.kind === "database" ? <Table2 size={14} /> : <FileText size={14} />)}</span>
            <span className="tx">{title}</span>
            {!single && (
              <button type="button" className="x" title={t("Close tab")} aria-label={t("Close tab")}
                onClick={(e) => { e.stopPropagation(); app.closeTab(tab.k); }}><X size={14} /></button>
            )}
          </div>
        );
      })}
      <button type="button" className="cn-ptab-add" title={t("New tab")} aria-label={t("New tab")} onClick={newTab}><Plus size={16} /></button>
      {menu && (() => {
        const tab = list.find((x) => x.k === menu.k);
        if (!tab) return null;
        const last = list[list.length - 1].k === tab.k;
        const close = () => setMenu(null);
        return (
          <Popover anchor={menu.at} onClose={close} width={240}>
            <MenuItem icon={<Plus size={15} />} onClick={() => { close(); newTab(); }}>{t("New tab")}</MenuItem>
            <MenuItem icon={<Copy size={15} />} onClick={() => { close(); app.switchTab(tab.k); app.openTab(tab.id); }}>{t("Duplicate tab")}</MenuItem>
            {!single && <MenuItem icon={<X size={15} />} onClick={() => { close(); app.closeTab(tab.k); }}>{t("Close tab")}</MenuItem>}
            {!single && <MenuItem icon={<XCircle size={15} />} onClick={() => { close(); app.closeOtherTabs(tab.k); }}>{t("Close other tabs")}</MenuItem>}
            {!last && <MenuItem icon={<ArrowRightToLine size={15} />} onClick={() => { close(); app.closeRightTabs(tab.k); }}>{t("Close tabs to the right")}</MenuItem>}
          </Popover>
        );
      })()}
    </div>
  );
}
