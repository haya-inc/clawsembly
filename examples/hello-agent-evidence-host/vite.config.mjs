import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    },
    fs: {
      allow: [resolve(import.meta.dirname, "../..")]
    }
  }
});
