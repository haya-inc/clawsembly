#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules", "playwright-report", "test-results"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [path];
  });
}

function localMarkdownTargets(source) {
  const targets = [];
  const pattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    targets.push(decodeURIComponent(raw.split("#")[0]));
  }
  return targets;
}

const root = process.cwd();
const required = [
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/compatibility.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  ".github/workflows/compatibility.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/runtime-browser.yml",
  "scripts/validate-workflows.mjs",
  "apps/web/public/_headers",
  "netlify.toml",
  "vercel.json",
  "apps/web/public/data/compatibility.json",
  "apps/web/public/data/compatibility-badge.svg",
  "apps/web/public/data/release-history.json",
  "apps/web/public/social-preview.png",
  "packages/compatibility/report.schema.json",
  "packages/compatibility/release-history.schema.json",
  "packages/compatibility/browserpod-evidence.schema.json",
  "packages/capability-broker/capability-manifest.schema.json",
  "packages/capability-broker/capability-audit.schema.json",
  "packages/embed-sdk/permission-prompt.mjs",
  "packages/embed-sdk/permission-prompt.d.mts",
  "packages/embed-sdk/embed-manifest.mjs",
  "packages/embed-sdk/embed-manifest.d.mts",
  "packages/embed-sdk/report-loader.mjs",
  "packages/embed-sdk/report-loader.d.mts",
  "packages/embed-sdk/report-loader.test.mjs",
  "packages/embed-sdk/boot.mjs",
  "packages/embed-sdk/boot.d.mts",
  "packages/embed-sdk/public-api.test.mjs",
  "packages/embed-sdk/gateway-client.mjs",
  "packages/embed-sdk/gateway-client.d.mts",
  "packages/embed-sdk/gateway-device-token-vault.mjs",
  "packages/embed-sdk/gateway-device-token-vault.d.mts",
  "packages/embed-sdk/gateway-pairing-prompt.mjs",
  "packages/embed-sdk/gateway-pairing-prompt.d.mts",
  "packages/sdk-package/package.json",
  "packages/sdk-package/README.md",
  "examples/sdk-host/README.md",
  "examples/sdk-host/index.html",
  "examples/sdk-host/package.json",
  "examples/sdk-host/tsconfig.json",
  "examples/sdk-host/vite.config.mjs",
  "examples/sdk-host/src/launch-decision.ts",
  "examples/sdk-host/src/main.ts",
  "examples/sdk-host/src/report-pin.ts",
  "examples/sdk-host/src/styles.css",
  "examples/sdk-host/src/styles.d.ts",
  "scripts/build-sdk-package.mjs",
  "scripts/build-pages.mjs",
  "scripts/generate-sdk-host-report-pin.mjs",
  "scripts/serve-sdk-host-example.mjs",
  "packages/compatibility/src/sdk-host-report-pin.mjs",
  "packages/compatibility/src/sdk-host-report-pin.test.mjs",
  "tests/browser/sdk-host-example.spec.ts",
  "packages/browser-runtime/openclaw-installer.mjs",
  "packages/browser-runtime/openclaw-installer.d.mts",
  "packages/browser-runtime/openclaw-gateway.mjs",
  "packages/browser-runtime/openclaw-gateway.d.mts",
  "apps/web/public/schemas/capability-manifest.schema.json",
  "apps/web/public/schemas/capability-audit.schema.json",
  "dist/index.html",
  "dist/data/compatibility.json",
  "dist/data/compatibility-badge.svg",
  "dist/data/release-history.json",
  "dist/schemas/capability-manifest.schema.json",
  "dist/schemas/capability-audit.schema.json",
  "dist/sdk-host/index.html"
];

const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) throw new Error(`Release files are missing: ${missing.join(", ")}`);

const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (manifest.private !== true) throw new Error("The compatibility lab must remain a private npm package.");
if (manifest.license !== "MIT") throw new Error("package.json must declare the repository MIT license.");
if (manifest.repository?.url !== "https://github.com/haya-inc/clawsembly.git") {
  throw new Error("package.json repository metadata is missing or incorrect.");
}

const builtIndex = readFileSync(resolve(root, "dist/index.html"), "utf8");
for (const expected of ["/clawsembly/mark.svg", "/clawsembly/assets/", "https://haya-inc.github.io/clawsembly/social-preview.png"]) {
  if (!builtIndex.includes(expected)) throw new Error(`GitHub Pages build is missing ${expected}.`);
}
const structuredData = builtIndex.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
if (!structuredData) throw new Error("The Pages build is missing JSON-LD structured data.");
const structuredDataHash = createHash("sha256").update(structuredData).digest("base64");
if (!builtIndex.includes(`'sha256-${structuredDataHash}'`)) {
  throw new Error("The Content Security Policy hash does not match the JSON-LD block.");
}
const builtHeaders = readFileSync(resolve(root, "dist/_headers"), "utf8");
for (const expected of ["Content-Security-Policy:", "Referrer-Policy: strict-origin-when-cross-origin", "X-Content-Type-Options: nosniff"]) {
  if (!builtHeaders.includes(expected)) throw new Error(`The deployment headers are missing ${expected}.`);
}

const sdkHostIndex = readFileSync(resolve(root, "dist/sdk-host/index.html"), "utf8");
if (!sdkHostIndex.includes("Clawsembly launch inspector")) {
  throw new Error("The Pages build is missing the packed-SDK host example.");
}
const sdkHostJavaScript = readdirSync(resolve(root, "dist/sdk-host/assets"))
  .filter((name) => name.endsWith(".js"));
if (sdkHostJavaScript.length !== 1) throw new Error("The Pages SDK host bundle is ambiguous.");
const sdkHostBundle = readFileSync(resolve(root, "dist/sdk-host/assets", sdkHostJavaScript[0]), "utf8");
for (const expected of ["Provider boot blocked", "Not attempted", "report status is"]) {
  if (!sdkHostBundle.includes(expected)) throw new Error(`The Pages SDK host is missing ${expected}.`);
}

const socialPreview = readFileSync(resolve(root, "apps/web/public/social-preview.png"));
if (socialPreview.readUInt32BE(16) !== 1200 || socialPreview.readUInt32BE(20) !== 630) {
  throw new Error("The social preview must be a 1200×630 PNG.");
}

const markdownFiles = walk(root)
  .filter((path) => extname(path) === ".md")
  .filter((path) => !path.includes("/node_modules/") && !path.includes("/.git/") && !path.includes("/test-results/"));
const broken = [];
for (const file of markdownFiles) {
  const source = readFileSync(file, "utf8");
  for (const target of localMarkdownTargets(source)) {
    if (!existsSync(resolve(file, "..", target))) {
      broken.push(`${relative(root, file)} -> ${target}`);
    }
  }
}
if (broken.length) throw new Error(`Broken local documentation links:\n${broken.join("\n")}`);

process.stdout.write(`Release readiness passed: ${required.length} files and ${markdownFiles.length} Markdown documents checked.\n`);
