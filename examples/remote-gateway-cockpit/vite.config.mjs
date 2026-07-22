import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  server: {
    host: "127.0.0.1",
    port: 5178,
    // The Gateway allowlists this exact origin; a silently drifting port
    // would break gateway.controlUi.allowedOrigins guidance.
    strictPort: true,
    fs: {
      allow: [resolve(import.meta.dirname, "../..")]
    }
  }
});
