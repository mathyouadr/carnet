import { useRef, useState } from "react";
import { Star, StarOff, Copy, CornerUpRight, Link2, ExternalLink, Trash2 } from "lucide-react";
import { api, Summary } from "../api";
import { pagePath, useApp } from "./store";
import { t } from "../i18n";
import { MenuItem, MenuSep, Popover } from "../ui/Popover";
import { MoveDialog } from "./Dialogs";

export type MenuAnchor = HTMLElement | DOMRect;

/** The actions of a page, as a popover anchored to an element or to a point (right-click, long press). */
export function PageMenu({ page, anchor, onClose }: { page: Summary; anchor: MenuAnchor; onClose: () => void }) {
  const app = useApp();
  const [move, setMove] = useState(false);
  const link = () => navigator.clipboard?.writeText(location.origin + pagePath(page.id)).then(() => app.toast(t("Link copied")));
  if (move) return <MoveDialog page={page} onClose={onClose} />;
  return (
    <Popover anchor={anchor} onClose={onClose} width={240}>
      {app.pageId !== page.id && <MenuItem icon={<ExternalLink size={15} />} onClick={() => { app.navigate(page.id); onClose(); }}>{t("Open")}</MenuItem>}
      {page.readonly ? (
        <MenuItem icon={<Link2 size={15} />} onClick={() => { link(); onClose(); }}>{t("Copy link")}</MenuItem>
      ) : <>
        <MenuItem icon={page.favorite ? <StarOff size={15} /> : <Star size={15} />} onClick={async () => {
          onClose();
          try { await api.post(`/api/pages/${page.id}`, { favorite: !page.favorite }); await app.refresh(); }
          catch (e: any) { app.toast(String(e?.message || e)); }
        }}>{page.favorite ? t("Remove from favorites") : t("Add to favorites")}</MenuItem>
        <MenuItem icon={<Link2 size={15} />} onClick={() => { link(); onClose(); }}>{t("Copy link")}</MenuItem>
        <MenuItem icon={<Copy size={15} />} onClick={async () => {
          onClose();
          try { const c = await api.post(`/api/pages/${page.id}/duplicate`); await app.refresh(); app.navigate(c.id); }
          catch (e: any) { app.toast(String(e?.message || e)); }
        }}>{t("Duplicate")}</MenuItem>
        <MenuItem icon={<CornerUpRight size={15} />} onClick={() => setMove(true)}>{t("Move to")}</MenuItem>
        <MenuSep />
        <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { app.trashPage(page.id); onClose(); }}>{t("Move to trash")}</MenuItem>
      </>}
    </Popover>
  );
}

/** Props that open a menu on right-click, and on a long press for touch (iOS never fires contextmenu). */
export function useContextTrigger(open: (at: DOMRect) => void) {
  const timer = useRef<number>(0);
  const fired = useRef(false);
  const clear = () => { clearTimeout(timer.current); };
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (fired.current) { fired.current = false; return; }
      open(new DOMRect(e.clientX, e.clientY, 0, 0));
    },
    onTouchStart: (e: React.TouchEvent) => {
      const tt = e.touches[0];
      clear();
      timer.current = window.setTimeout(() => { fired.current = true; open(new DOMRect(tt.clientX, tt.clientY, 0, 0)); }, 520);
    },
    onTouchMove: clear, onTouchEnd: clear, onTouchCancel: clear,
  };
}
