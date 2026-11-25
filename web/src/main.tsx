import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";
import "./styles.css";
import { App } from "./app/App";
import { applyTheme } from "./app/theme";
import { LANG } from "./i18n";
import { installClientLog } from "./app/clientLog";

document.documentElement.lang = LANG;
applyTheme();
installClientLog(() => dispatchEvent(new Event("carnet:stale")));
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
