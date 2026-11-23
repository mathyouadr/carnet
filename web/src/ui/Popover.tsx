import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

/** A floating panel anchored to an element (or a point), closed by Escape or a click outside. */
export function Popover({ anchor, onClose, children, placement = "bottom-start", className = "", width, offset = 4 }: {
  anchor: HTMLElement | DOMRect | null; onClose: () => void; children: ReactNode;
  placement?: "bottom-start" | "bottom-end" | "right-start" | "top-start"; className?: string; width?: number; offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // not visibility:hidden: autoFocus must work on the first render
  const [style, setStyle] = useState<CSSProperties>({ top: 0, left: 0, opacity: 0 });
  const mobileSheet = matchMedia("(max-width: 760px)").matches;

  useLayoutEffect(() => {
    if (mobileSheet) { setStyle({}); return; }
    const place = () => {
      const el = ref.current;
      if (!el || !anchor) return;
      const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = innerWidth, vh = innerHeight;
      let left = placement === "bottom-end" ? r.right - w : placement === "right-start" ? r.right + offset : r.left;
      let top = placement === "right-start" ? r.top : placement === "top-start" ? r.top - h - offset : r.bottom + offset;
      if (top + h > vh - 8) top = Math.max(8, placement === "right-start" ? vh - h - 8 : r.top - h - offset);
      if (top < 8) top = 8;
      left = Math.max(8, Math.min(left, vw - w - 8));
      setStyle({ top, left, opacity: 1 });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    addEventListener("resize", place);
    return () => { ro.disconnect(); removeEventListener("resize", place); };
  }, [anchor, placement, offset, mobileSheet]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const el = ref.current;
      const target = e.target as Node;
      if (!el || el.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      // a nested popover (portal) counts as inside
      if ((target as HTMLElement).closest?.(".cn-pop")) {
        const pops = Array.from(document.querySelectorAll(".cn-pop"));
        if (pops.indexOf((target as HTMLElement).closest(".cn-pop")!) > pops.indexOf(el)) return;
      }
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const timer = setTimeout(() => document.addEventListener("pointerdown", down, true), 0);
    document.addEventListener("keydown", key, true);
    return () => { clearTimeout(timer); document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);

  return createPortal(
    <>
      {mobileSheet && <div className="cn-sheet-backdrop" onPointerDown={(e) => { e.preventDefault(); onClose(); }} />}
      <div ref={ref} className={`cn-pop ${mobileSheet ? "cn-sheet" : ""} ${className}`} style={{ ...style, ...(width && !mobileSheet ? { width } : {}) }}
        onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, danger, right, active, disabled }: {
  icon?: ReactNode; children: ReactNode; onClick?: (e: React.MouseEvent) => void; danger?: boolean; right?: ReactNode;
  active?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" className={`cn-mi ${danger ? "danger" : ""} ${active ? "active" : ""}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="cn-mi-ic">{icon}</span>}
      <span className="cn-mi-tx">{children}</span>
      {right && <span className="cn-mi-r">{right}</span>}
    </button>
  );
}

export function MenuSep() {
  return <div className="cn-msep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="cn-mlabel">{children}</div>;
}

export function Modal({ onClose, children, className = "", wide }: { onClose: () => void; children: ReactNode; className?: string; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="cn-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`cn-modal ${wide ? "wide" : ""} ${className}`} role="dialog">{children}</div>
    </div>,
    document.body,
  );
}

/** Hook: [anchor element, open(e), close] for popovers opened by a click. */
export function usePop<T = HTMLElement>() {
  const [anchor, setAnchor] = useState<HTMLElement | DOMRect | null>(null);
  const extra = useRef<T | null>(null);
  return {
    anchor,
    data: extra.current,
    open: (e: React.MouseEvent | HTMLElement | DOMRect, data?: T) => {
      extra.current = data ?? null;
      setAnchor(e instanceof HTMLElement || e instanceof DOMRect ? e : (e.currentTarget as HTMLElement));
    },
    close: () => setAnchor(null),
  };
}

export const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
