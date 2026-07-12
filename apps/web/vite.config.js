import { defineConfig } from "vite";
import { resolve } from "node:path";

const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'sha256-3Y4Yqf39XLm2rQIzZpKLs/EDhqPdsN7AG31xgCEx/QQ='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.openai.com; worker-src 'self' blob:; manifest-src 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
};

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: process.env.CLAWSEMBLY_BASE_PATH ?? "/",
  server: {
    headers: securityHeaders
  },
  preview: {
    headers: securityHeaders
  },
  build: {
    outDir: resolve(import.meta.dirname, "../../dist"),
    emptyOutDir: true
  }
});
