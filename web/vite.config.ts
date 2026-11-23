import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Python server serves the build from carnet/static and injects <base href="{base}/">,
// so every asset URL stays relative and the app works under any sub-path (/notes, /...).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../carnet/static",
    emptyOutDir: true,
    assetsDir: "assets",
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8044", "/files": "http://127.0.0.1:8044" },
  },
});
