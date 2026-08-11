import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";
import {
  enforceJavaScriptChunkBudget,
  failOnCircularChunk,
  JAVASCRIPT_CHUNK_BUDGET_KB,
  resolveManualChunk,
} from "./scripts/vite-chunk-strategy.mjs";

// Tauri 的默认开发地址使用 localhost。显式绑定 IPv4 回环地址，避免部分系统仅监听
// IPv6 回环后 WebView 无法加载前端；远程调试仍由 Tauri_DEV_HOST 明确指定。
const host = process.env.TAURI_DEV_HOST ?? '127.0.0.1';

export default defineConfig({
  plugins: [react(), tailwindcss(), enforceJavaScriptChunkBudget()],
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
    host,
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST,
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
    // lazy-loaded PDF.js runtime (~513 kB minified). The post-build plugin
    // rejects larger JavaScript chunks instead of leaving an ignorable warning.
    chunkSizeWarningLimit: JAVASCRIPT_CHUNK_BUDGET_KB,
    rollupOptions: {
      onwarn: failOnCircularChunk,
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
});
