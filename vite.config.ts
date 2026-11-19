/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Copy PDF.js CMaps / standard fonts / wasm so CJK PDFs render fully offline. */
function pdfjsAssets() {
  const copy = () => {
    const src = resolve(__dirname, "node_modules/pdfjs-dist");
    const dst = resolve(__dirname, "public/pdfjs");
    for (const d of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
      if (!existsSync(resolve(dst, d)) && existsSync(resolve(src, d))) {
        mkdirSync(dst, { recursive: true });
        cpSync(resolve(src, d), resolve(dst, d), { recursive: true });
      }
    }
  };
  return { name: "leafor-pdfjs-assets", buildStart: copy, configureServer: copy };
}

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
