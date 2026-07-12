import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sdkPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../packages/sdk-package/package.json"), "utf8"));
const npmPublication = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../packages/compatibility/npm-publication.json"), "utf8"));
const sdkTag = `v${sdkPackage.version}`;
const sdkTarball = `haya-inc-clawsembly-${sdkPackage.version}.tgz`;
const npmPublished = npmPublication.status === "published";
const sdkRegistryLabel = npmPublished ? "Install alpha from npm ↗" : "npm bootstrap pending · manifest ↗";
const sdkRegistryHref = npmPublished
  ? `https://www.npmjs.com/package/@haya-inc/clawsembly/v/${sdkPackage.version}`
  : "./downloads/sdk-release.json";
const sdkDistributionStatus = npmPublished
  ? `npm alpha published with provenance · npm install @haya-inc/clawsembly@${sdkPackage.version}`
  : "npm bootstrap pending · verified GitHub and Pages tarballs are available now";

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
        .replaceAll("__CLAWSEMBLY_SDK_TAG__", sdkTag)
        .replaceAll("__CLAWSEMBLY_SDK_REGISTRY_LABEL__", sdkRegistryLabel)
        .replaceAll("__CLAWSEMBLY_SDK_REGISTRY_HREF__", sdkRegistryHref)
        .replaceAll("__CLAWSEMBLY_SDK_DISTRIBUTION_STATUS__", sdkDistributionStatus);
    }
  }],
  build: {
    outDir: resolve(import.meta.dirname, "../../dist"),
    emptyOutDir: true
  }
});
