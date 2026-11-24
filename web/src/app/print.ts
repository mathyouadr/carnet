import { applyTheme } from "./theme";

/** Print / "Save as PDF" the open page. Always on the light theme: a dark page would print light text on white. */
export function printPage() {
  document.documentElement.dataset.theme = "light";   // the editor follows it (MutationObserver in useTheme)
  setTimeout(() => {
    try { print(); } finally { setTimeout(applyTheme, 800); }
  }, 600);
}
