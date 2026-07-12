import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sdkPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../packages/sdk-package/package.json"), "utf8"));
const sdkTag = `v${sdkPackage.version}`;
const sdkTarball = `haya-inc-clawsembly-${sdkPackage.version}.tgz`;

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
  plugins: [{
    name: "clawsembly-sdk-release-links",
    transformIndexHtml(html) {
      return html
        .replaceAll("__CLAWSEMBLY_SDK_TARBALL__", sdkTarball)
        .replaceAll("__CLAWSEMBLY_SDK_TAG__", sdkTag);
    }
  }],
  build: {
    outDir: resolve(import.meta.dirname, "../../dist"),
    emptyOutDir: true
  }
});
