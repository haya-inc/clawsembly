#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const root = process.cwd();
const report = JSON.parse(readFileSync(resolve(root, "apps/web/public/data/compatibility.json"), "utf8"));
const template = readFileSync(resolve(root, "apps/web/social-preview.template.html"), "utf8");
const html = template
  .replaceAll("{{VERSION}}", escapeHtml(report.artifact.version))
  .replaceAll("{{STATUS}}", escapeHtml(report.status.toUpperCase()));
const output = resolve(root, "apps/web/public/social-preview.png");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: output, type: "png" });
  process.stdout.write(`Wrote ${output}\n`);
} finally {
  await browser.close();
}
