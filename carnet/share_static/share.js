// Public link pages: turn the LaTeX of [data-latex] elements into formulas (KaTeX is loaded just before).
(function () {
  function run() {
    if (!window.katex) return;
    document.querySelectorAll("[data-latex]").forEach(function (el) {
      try {
        window.katex.render(el.getAttribute("data-latex") || "", el, {
          displayMode: el.classList.contains("block"), throwOnError: false, output: "html",
        });
      } catch (e) { /* keep the LaTeX source as text */ }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
