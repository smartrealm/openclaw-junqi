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
    // Keep the budget close to Vite's default while allowing the standalone,
    // lazy-loaded PDF.js runtime (~513 kB minified). Larger regressions still warn.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/generated/providerCatalog.generated")) {
            return "provider-catalog";
          }
          if (
            id.includes("/src/services/gateway/modelCatalog") ||
            id.includes("/src/services/gateway/modelLoaders")
          ) {
            return "model-runtime";
          }
          if (
            id.includes("/src/services/gateway/types") ||
            id.includes("/src/services/gateway/messageRouter") ||
            id.includes("/src/services/gateway/GatewayStateMachine") ||
            id.includes("/src/services/gateway/configResolvers")
          ) {
            return "gateway-primitives";
          }
          if (id.includes("/src/theme/") && !id.includes("/src/theme/useTheme")) {
            return "theme-core";
          }
          if (id.includes("/src/processing/")) {
            return "message-processing";
          }
          if (id.includes("/src/stores/calendarStore")) {
            return "store-calendar";
          }
          if (id.includes("/src/stores/skillsStore")) {
            return "store-skills";
          }
          if (id.includes("/src/stores/notificationStore")) {
            return "store-notifications";
          }
          if (id.includes("/src/stores/petStore")) {
            return "store-pet";
          }
          if (id.includes("/src/stores/bootSequenceStore")) {
            return "store-boot";
          }
          if (id.includes("/src/stores/app-store")) {
            return "store-app";
          }
          if (id.includes("/src/stores/settingsStore")) {
            return "store-settings";
          }
          if (id.includes("/src/stores/gatewayDataStore")) {
            return "store-gateway-data";
          }
          if (id.includes("/src/stores/workshopStore")) {
            return "store-workshop";
          }
          if (
            id.includes("/src/stores/workspaceStore") ||
            id.includes("/src/stores/sessionHistoryStore") ||
            id.includes("/src/stores/providerAccountsStore")
          ) {
            return "feature-stores";
          }
          // Vendor splits for heavy libs.
          if (id.includes("node_modules")) {
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/") ||
              id.includes("/node_modules/use-sync-external-store/")
            ) {
              return "react-vendor";
            }
            if (
              id.includes("/node_modules/i18next/") ||
              id.includes("/node_modules/react-i18next/")
            ) {
              return "i18n-vendor";
            }
            if (id.includes("pdfjs-dist")) return "pdfjs";
            if (id.includes("@xterm")) return "xterm";
            if (id.includes("@uiw/react-codemirror") || id.includes("@uiw/codemirror")) return "codemirror-ui";
            if (id.includes("@codemirror/lang-") || id.includes("@codemirror/legacy-modes")) {
              const match = id.match(/node_modules\/@codemirror\/(?:lang-|legacy-modes\/mode\/)([^/]+)/);
              return match ? `cm-lang-${match[1].replace(/\.[mc]?[jt]s$/, '')}` : "cm-lang";
            }
            if (id.includes("@codemirror")) return "codemirror-core";
            if (id.includes("recharts")) return "charts-recharts";
            if (id.includes("d3-")) {
              const match = id.match(/node_modules\/(d3-[^/]+)/);
              return match ? `charts-${match[1]}` : "charts-d3";
            }
            if (id.includes("framer-motion")) return "motion";
            if (id.includes("@phosphor-icons")) return "icons";
            if (id.includes("@dnd-kit")) return "dnd";
            if (id.includes("react-syntax-highlighter")) return "syntax-highlighter";
            if (id.includes("react-markdown") || id.includes("remark-gfm")) return "markdown";
          }
          // Keep tightly-coupled internal modules in ONE named chunk to avoid
          // circular cross-chunk dependencies (barrel ↔ sub-modules). Returning
          // undefined lets Rollup still split them; a shared chunk name forces
          // them together and eliminates the "broken execution order" warning.
          if (
            id.includes("/src/services/gateway/") ||
            id.includes("/src/theme/useTheme") ||
            id.includes("/src/stores/")
          ) {
            return "app-core";
          }
        },
      },
    },
  },
});
