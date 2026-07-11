#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules", "playwright-report", "test-results"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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
  "apps/web/public/data/compatibility.json",
  "apps/web/public/data/compatibility-badge.svg",
  "apps/web/public/data/release-history.json",
  "apps/web/public/social-preview.png",
  "packages/compatibility/report.schema.json",
  "packages/compatibility/release-history.schema.json",
  "dist/index.html",
  "dist/data/compatibility.json",
  "dist/data/compatibility-badge.svg",
  "dist/data/release-history.json"
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
