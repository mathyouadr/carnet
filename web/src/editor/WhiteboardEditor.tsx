// Loaded lazily (React.lazy): Excalidraw and its stylesheet are heavy.
import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToSvg } from "@excalidraw/excalidraw";

// Fonts are served by Carnet itself (public/assets/excalidraw), never from a CDN.
(window as any).EXCALIDRAW_ASSET_PATH = new URL("assets/excalidraw/", document.baseURI).href;

export type Scene = { elements: any[]; bg: string };

export function parseScene(data: string): Scene {
  try {
    const j = JSON.parse(data);
    const bg = typeof j.appState?.viewBackgroundColor === "string" && /^(#[0-9a-f]{3,8}|transparent)$/i.test(j.appState.viewBackgroundColor) ? j.appState.viewBackgroundColor : "#ffffff";
    // elements come from the API as-is: only objects, and only http(s) links (no javascript: in the exported SVG)
    const els = (Array.isArray(j.elements) ? j.elements : []).filter((e: any) => e && typeof e === "object" && typeof e.type === "string")
      .map((e: any) => (e.link && !/^https?:\/\//i.test(String(e.link)) ? { ...e, link: null } : e));
    return { elements: els, bg };
  } catch { return { elements: [], bg: "#ffffff" }; }
}

export function sceneJson(elements: readonly any[], bg: string): string {
  const live = elements.filter((e) => !e.isDeleted);
  return live.length ? JSON.stringify({ type: "excalidraw", version: 2, elements: live, appState: { viewBackgroundColor: bg } }) : "";
}

export async function sceneSvg(data: string, dark: boolean): Promise<string> {
  const s = parseScene(data);
  if (!s.elements.some((e) => !e.isDeleted)) return "";
  const svg = await exportToSvg({
    elements: s.elements.filter((e) => !e.isDeleted),
    appState: { viewBackgroundColor: dark ? "#1e1e1e" : s.bg, exportWithDarkMode: dark, exportBackground: false } as any,
    files: null, exportPadding: 12,
  });
  svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
  svg.removeAttribute("style");
  return svg.outerHTML;
}

export default function WhiteboardEditor({ data, dark, readOnly, onChange }: { data: string; dark: boolean; readOnly: boolean; onChange: (json: string) => void }) {
  const s = parseScene(data);
  let bg = s.bg;
  return (
    <Excalidraw
      initialData={{ elements: s.elements, appState: { viewBackgroundColor: s.bg }, scrollToContent: true } as any}
      theme={dark ? "dark" : "light"} langCode="fr-FR" viewModeEnabled={readOnly}
      UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } } as any}
      onChange={(els, app) => { if (readOnly) return; bg = (app as any).viewBackgroundColor || bg; onChange(sceneJson(els as any, bg)); }}
    />
  );
}
