import { useEffect, useState } from "react";

export type ThemeName = "light" | "dark";

export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setThemePref(pref: "light" | "dark" | "system") {
  localStorage.setItem("carnet:theme", pref);
  applyTheme();
}

export function themePref(): "light" | "dark" | "system" {
  return ((window as any).CARNET?.theme as any) || (localStorage.getItem("carnet:theme") as any) || "system";
}

export function applyTheme() {
  const p = themePref();
  const v = p === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : p;
  document.documentElement.dataset.theme = v;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", v === "dark" ? "#191919" : "#ffffff");
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (themePref() === "system") applyTheme(); });

export function useTheme(): ThemeName {
  const [th, setTh] = useState<ThemeName>(currentTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTh(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return th;
}
