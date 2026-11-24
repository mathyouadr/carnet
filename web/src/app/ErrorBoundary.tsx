import { Component, type ReactNode } from "react";
import { t } from "../i18n";

/** Root guard: a render error shows a message and a reload button instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error("Carnet render error:", err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="cn-page-missing cn-crash" role="alert">
        <h2>{t("Something went wrong")}</h2>
        <p>{t("The page could not be shown. Reloading usually fixes it.")}</p>
        <button type="button" className="cn-btn" onClick={() => location.reload()}>{t("Reload")}</button>
      </div>
    );
  }
}
