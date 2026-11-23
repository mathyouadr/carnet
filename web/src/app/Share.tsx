import { useEffect, useState } from "react";
import { Globe, Copy, ExternalLink } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { Modal } from "../ui/Popover";
import { useApp } from "./store";

type ShareInfo = { shared: boolean; token?: string; path?: string; url?: string; created_at?: string; inherited?: { id: string; title: string } | null };

/** The public link of a page: anyone who has it reads the page and its sub-pages, nothing else. */
export function shareLink(s: ShareInfo) {
  if (!s.shared) return "";
  return s.url || location.origin + (s.path || "");
}

export function ShareDialog({ pageId, onClose, onChange }: { pageId: string; onClose: () => void; onChange: () => void }) {
  const app = useApp();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<ShareInfo>(`/api/pages/${pageId}/share`).then(setInfo).catch(() => setInfo({ shared: false })); }, [pageId]);
  const toggle = async () => {
    if (!info || busy) return;
    setBusy(true);
    try {
      const out = info.shared ? await api.del<ShareInfo>(`/api/pages/${pageId}/share`) : await api.post<ShareInfo>(`/api/pages/${pageId}/share`);
      setInfo(out);
      onChange();
      app.toast(out.shared ? t("Public link created") : t("Public link removed"));
    } catch (e: any) {
      app.toast(e.message || "error");
    } finally { setBusy(false); }
  };
  const link = info ? shareLink(info) : "";
  const local = !!info?.shared && !info.url;
  return (
    <Modal onClose={onClose}>
      <div className="cn-share">
        <h2><Globe size={18} /> {t("Share to the web")}</h2>
        <label className="cn-share-row">
          <span>
            <b>{t("Public link")}</b>
            <small>{t("Anyone with the link can read this page and its sub-pages. They can't edit anything or see your other pages.")}</small>
          </span>
          <input type="checkbox" className="cn-switch" checked={!!info?.shared} disabled={!info || busy} onChange={toggle} />
        </label>
        {!info?.shared && info?.inherited && (
          <small className="cn-share-note"><Globe size={12} /> {t("Already public through the link of")} « <a onClick={() => { onClose(); app.navigate(info.inherited!.id); }}>{info.inherited.title || t("Untitled")}</a> ».</small>
        )}
        {info?.shared && (
          <>
            <div className="cn-share-link">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="cn-btn primary" onClick={() => navigator.clipboard?.writeText(link).then(() => app.toast(t("Link copied")))}>
                <Copy size={14} /> {t("Copy")}
              </button>
              <a className="cn-btn" href={link} target="_blank" rel="noopener noreferrer" title={t("Open")}><ExternalLink size={14} /></a>
            </div>
            {local && <small className="cn-share-note">{t("This link only works where Carnet itself is reachable: set CARNET_SHARE_URL to publish it.")}</small>}
            <small className="cn-share-note">{t("Turning the link off makes it stop working at once. Turning it on again gives a new link.")}</small>
          </>
        )}
      </div>
    </Modal>
  );
}
