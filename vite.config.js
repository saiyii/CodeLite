import { defineConfig } from "vite";

// Tauri expects a fixed, predictable dev server port.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: "dist",
    // Monaco's core chunk is inherently large (it ships editing support for
    // dozens of languages); that's expected here, not a regression to chase.
    chunkSizeWarningLimit: 4000,
  },
});
