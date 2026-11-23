import { useEffect, useMemo, useRef, useState } from "react";
import { loadFrimousseData, searchEmojis } from "@blocknote/core/emoji-data";
import type { FrimousseEmojiData } from "@blocknote/core/emoji-data";
import { LANG, t } from "../i18n";
import { api, fileUrl } from "../api";

let cache: Promise<FrimousseEmojiData> | null = null;
function emojiData() {
  if (!cache) cache = loadFrimousseData(LANG).catch(() => loadFrimousseData("en"));
  return cache;
}

const RECENT_KEY = "carnet:recent-emoji";

export function EmojiPicker({ onPick, onRemove }: { onPick: (e: string) => void; onRemove?: () => void }) {
  const [data, setData] = useState<FrimousseEmojiData | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { emojiData().then(setData); setTimeout(() => input.current?.focus(), 30); }, []);
  const recent: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  const list = useMemo(() => {
    if (!data) return [];
    const base = data.emojis.filter((e) => !e.countryFlag || q);
    if (q.trim()) return searchEmojis(base, q, LANG).slice(0, 400);
    return cat === null ? base.slice(0, 600) : base.filter((e) => e.category === cat);
  }, [data, q, cat]);
  const pick = (e: string) => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recent.filter((x) => x !== e)].slice(0, 24)));
    onPick(e);
  };
  return (
    <div className="cn-emoji">
      <div className="cn-emoji-top">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search")} className="cn-input" />
        <button type="button" className="cn-btn ghost" title={t("Random")}
          onClick={() => data && pick(data.emojis[Math.floor(Math.random() * data.emojis.length)].emoji)}>🎲</button>
        {onRemove && <button type="button" className="cn-btn ghost" onClick={onRemove}>{t("Remove")}</button>}
      </div>
      {!q && data && (
        <div className="cn-emoji-cats">
          <button type="button" className={cat === null ? "on" : ""} onClick={() => setCat(null)}>★</button>
          {data.categories.map((c) => (
            <button type="button" key={c.index} className={cat === c.index ? "on" : ""} title={c.label}
              onClick={() => setCat(c.index)}>{data.emojis.find((e) => e.category === c.index)?.emoji}</button>
          ))}
        </div>
      )}
      <div className="cn-emoji-grid">
        {!q && cat === null && recent.length > 0 && recent.map((e) => (
          <button type="button" key={"r" + e} onClick={() => pick(e)}>{e}</button>
        ))}
        {!q && cat === null && recent.length > 0 && <div className="cn-emoji-break" />}
        {list.map((e) => <button type="button" key={e.emoji} title={e.label} onClick={() => pick(e.emoji)}>{e.emoji}</button>)}
        {!data && <div className="cn-muted">{t("Loading…")}</div>}
      </div>
    </div>
  );
}

export const GRADIENTS = [
  "linear-gradient(120deg,#f6d365,#fda085)", "linear-gradient(120deg,#a1c4fd,#c2e9fb)",
  "linear-gradient(120deg,#d4fc79,#96e6a1)", "linear-gradient(120deg,#84fab0,#8fd3f4)",
  "linear-gradient(120deg,#fccb90,#d57eeb)", "linear-gradient(120deg,#e0c3fc,#8ec5fc)",
  "linear-gradient(120deg,#fa709a,#fee140)", "linear-gradient(120deg,#30cfd0,#330867)",
  "linear-gradient(120deg,#5ee7df,#b490ca)", "linear-gradient(120deg,#0f2027,#2c5364)",
  "linear-gradient(120deg,#232526,#414345)", "linear-gradient(120deg,#ff9a9e,#fecfef)",
  "#e3e2e0", "#eee0da", "#fadec9", "#fdecc8", "#dbeddb", "#d3e5ef", "#e8deee", "#f5e0e9", "#ffe2dd", "#2f3437",
];

export function coverStyle(cover: string): React.CSSProperties {
  if (!cover) return {};
  if (cover.startsWith("linear-gradient") || cover.startsWith("#")) return { background: cover };
  return { backgroundImage: `url("${fileUrl(cover).replace(/"/g, "%22")}")` };
}

export function CoverPicker({ onPick, onRemove, pageId }: { onPick: (c: string) => void; onRemove: () => void; pageId?: string }) {
  const [tab, setTab] = useState<"gallery" | "upload" | "link">("gallery");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="cn-cover-pick">
      <div className="cn-tabs">
        {(["gallery", "upload", "link"] as const).map((k) => (
          <button type="button" key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {t(k === "gallery" ? "Gallery" : k === "upload" ? "Upload" : "Link")}
          </button>
        ))}
        <span className="grow" />
        <button type="button" onClick={onRemove}>{t("Remove")}</button>
      </div>
      {tab === "gallery" && (
        <div className="cn-cover-grid">
          {GRADIENTS.map((g) => <button type="button" key={g} style={{ background: g }} onClick={() => onPick(g)} />)}
        </div>
      )}
      {tab === "upload" && (
        <label className="cn-btn block">
          {t("Choose a file")}
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { onPick((await api.upload(f, f.name, pageId)).url); } catch { setErr(t("Upload failed")); }
          }} />
        </label>
      )}
      {tab === "link" && (
        <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) onPick(url.trim()); }} className="row">
          <input className="cn-input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("Paste a link to an image")} />
          <button className="cn-btn primary">{t("OK")}</button>
        </form>
      )}
      {err && <div className="cn-err">{err}</div>}
    </div>
  );
}
