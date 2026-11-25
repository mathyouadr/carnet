// Table of contents on the right of the page: a small tab that unfolds a panel listing the headings
// (and lines written in bold as titles). Hidden while the chat panel is open, which uses the same side.
import { useEffect, useRef, useState } from "react";
import { TableOfContents, X } from "lucide-react";
import { t } from "../i18n";
import { activeIndex, buildToc, TocItem } from "./toc";

const OPEN_KEY = "carnet:toc-open";

export function Outline({ editor, host, mobile, hidden }: { editor: any; host: React.RefObject<HTMLDivElement | null>; mobile: boolean; hidden: boolean }) {
  const [items, setItems] = useState<TocItem[]>(() => buildToc(editor.document));
  const [open, setOpenState] = useState(() => !mobile && localStorage.getItem(OPEN_KEY) === "1");
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const setOpen = (v: boolean) => { setOpenState(v); if (!mobile) localStorage.setItem(OPEN_KEY, v ? "1" : "0"); };

  // follow the page as it is written
  useEffect(() => {
    setItems(buildToc(editor.document));
    let timer = 0;
    const off = editor.onChange?.(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setItems(buildToc(editor.document)), 250);
    });
    return () => { clearTimeout(timer); if (typeof off === "function") off(); };
  }, [editor]);

  const shown = items.length >= 2 && !hidden;
  const panel = shown && open;

  // desktop: the page moves left so the panel never covers the text
  useEffect(() => {
    const on = panel && !mobile;
    document.documentElement.classList.toggle("cn-outline-on", on);
    return () => document.documentElement.classList.remove("cn-outline-on");
  }, [panel, mobile]);

  const blockEl = (id: string) => host.current?.querySelector(`.bn-block-outer[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;

  // highlight the section being read
  useEffect(() => {
    if (!panel) return;
    const area = host.current?.closest(".cn-scroll") as HTMLElement | null;
    if (!area) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = area.getBoundingClientRect();
      const tops = items.map((i) => blockEl(i.id)?.getBoundingClientRect().top ?? Infinity);
      // at the very bottom the last sections can never reach the reading line: take the last one on screen
      const bottom = area.scrollTop > 0 && area.scrollTop + area.clientHeight >= area.scrollHeight - 4;
      setActive(activeIndex(tops, bottom ? r.bottom - 40 : r.top + 120));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => { area.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [panel, items]);   // eslint-disable-line

  // keep the highlighted entry visible in a long list
  useEffect(() => {
    list.current?.querySelector(".cn-outline-item.on")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Escape closes the panel (unless a menu is open)
  useEffect(() => {
    if (!panel) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".cn-pop")) setOpen(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [panel]);  // eslint-disable-line

  const go = (id: string) => {
    const el = blockEl(id);
    const area = host.current?.closest(".cn-scroll") as HTMLElement | null;
    if (!el || !area) return;
    const y = el.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop - 24;
    area.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    el.classList.remove("cn-outline-flash");
    void el.offsetWidth;                                 // restart the animation
    el.classList.add("cn-outline-flash");
    window.setTimeout(() => el.classList.remove("cn-outline-flash"), 1600);
    if (mobile) setOpen(false);
  };

  if (!shown) return null;
  if (!panel)
    return (
      <button type="button" className="cn-outline-tab" title={t("Table of contents")} aria-label={t("Table of contents")} onClick={() => setOpen(true)}>
        <TableOfContents size={16} />
      </button>
    );
  return (
    <>
      {mobile && <div className="cn-outline-bg" onClick={() => setOpen(false)} />}
      <nav className="cn-outline" aria-label={t("Table of contents")}>
        <div className="cn-outline-top">
          <TableOfContents size={15} /><span>{t("Table of contents")}</span>
          <span className="cn-chat-sp" />
          <button type="button" className="cn-chat-ic" title={t("Close")} aria-label={t("Close")} onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
        <div className="cn-outline-list" ref={list}>
          {items.map((i, n) => (
            <button key={i.id} type="button" className={`cn-outline-item l${i.level} ${i.kind}${n === active ? " on" : ""}`}
              style={{ paddingLeft: 10 + i.level * 14 }} title={i.text} onClick={() => go(i.id)}>
              {i.text}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
