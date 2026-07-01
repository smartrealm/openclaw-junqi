import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  ssr: { noExternal: ['@tauri-apps/api'] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splits for heavy libs.
          if (id.includes("node_modules")) {
            if (id.includes("react-syntax-highlighter")) return "syntax-highlighter";
            if (id.includes("react-markdown") || id.includes("remark-gfm")) return "markdown";
          }
          // Keep tightly-coupled internal modules in ONE named chunk to avoid
          // circular cross-chunk dependencies (barrel ↔ sub-modules). Returning
          // undefined lets Rollup still split them; a shared chunk name forces
          // them together and eliminates the "broken execution order" warning.
          if (
            id.includes("/src/services/gateway/") ||
            id.includes("/src/theme/") ||
            id.includes("/src/stores/")
          ) {
            return "app-core";
          }
        },
      },
    },
  },
});
