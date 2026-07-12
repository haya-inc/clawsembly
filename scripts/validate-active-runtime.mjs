#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));

async function filesUnder(path) {
  const directory = resolve(root, path);
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

const manifest = await readJson("package.json");
assert.equal(manifest.dependencies?.["@webcontainer/api"], undefined, "WebContainer must not be a production dependency");
assert.equal(manifest.devDependencies?.["@webcontainer/api"], undefined, "WebContainer must not be a development dependency");
assert.equal(manifest.devDependencies?.["@noble/curves"], undefined, "the removed verifier adapter dependency must stay removed");
assert.equal(manifest.devDependencies?.["sql.js"], undefined, "the removed SQLite adapter dependency must stay removed");
assert.equal(manifest.devDependencies?.ws, undefined, "the removed loopback adapter dependency must stay removed");
assert.equal(Object.values(manifest.scripts).some((script) => script.includes("webcontainer-adapter")), false, "scripts must not reference the removed adapter");

for (const removedPath of [
  "apps/web/src/runtime-probe.ts",
  "apps/web/src/runtime-gateway-probe.ts",
  "apps/web/src/runtime-probe-support.ts",
  "apps/web/src/state-persistence.ts",
  "tests/browser/runtime-probe.spec.ts",
  "packages/webcontainer-adapter",
  "apps/web/public/data/evidence/webcontainer-host.json",
  "apps/web/public/data/evidence/openclaw-2026.6.11-gateway.json",
  "fixtures/openclaw/2026.6.11/webcontainer-fs-bigint-position.json",
  "fixtures/openclaw/2026.6.11/webcontainer-npm-nested-dependencies.json",
  "packages/compatibility/host-evidence.schema.json",
  "packages/compatibility/gateway-evidence.schema.json"
]) {
  await assert.rejects(access(resolve(root, removedPath)), undefined, `${removedPath} must remain removed`);
}

for (const path of await filesUnder("apps/web/src")) {
  const source = await readFile(path, "utf8");
  assert.equal(source.includes("@webcontainer/api"), false, `${path} imports WebContainer`);
  assert.equal(source.includes("WebContainer.boot"), false, `${path} boots WebContainer`);
}

for (const path of [
  "apps/web/index.html",
  "apps/web/vite.config.js",
  "apps/web/public/_headers",
  "netlify.toml",
  "vercel.json"
]) {
  assert.equal((await read(path)).includes("stackblitz.com"), false, `${path} still permits StackBlitz`);
}

const browserWorkflow = await read(".github/workflows/runtime-browser.yml");
assert.equal(browserWorkflow.includes("packages/webcontainer-adapter"), false, "normal browser CI references the removed adapter");

const compatibilityIssueTemplate = await read(".github/ISSUE_TEMPLATE/compatibility.yml");
assert.equal(compatibilityIssueTemplate.includes("WebContainer"), false, "compatibility issue template references the removed runtime");
assert.equal(compatibilityIssueTemplate.includes("BrowserPod version"), true, "compatibility findings must identify the BrowserPod version");
assert.equal(compatibilityIssueTemplate.includes("Owner-authorized BrowserPod run"), true, "compatibility findings must identify owner-authorized runtime evidence");
assert.equal(compatibilityIssueTemplate.includes("I removed BrowserPod keys"), true, "compatibility findings must confirm secret redaction");

const roadmap = await read("docs/roadmap.md");
assert.equal(roadmap.includes("Status: implementation complete; provider evidence pending."), true, "roadmap overstates BrowserPod evidence completion");
assert.equal(roadmap.includes("Replace or cache the 293-package repair path"), false, "roadmap promotes the removed runtime repair path");
const ossStrategy = await read("docs/oss-strategy.md");
assert.equal(ossStrategy.includes("Cache or replace the nested dependency repair path"), false, "OSS strategy promotes the removed runtime repair path");
assert.equal(ossStrategy.includes("packed-SDK host example"), true, "OSS strategy must retain the external SDK host adoption path");

const compatibilitySource = await read("apps/web/public/data/compatibility.json");
const compatibilitySha256 = createHash("sha256").update(compatibilitySource).digest("hex");
const sdkHostReportPin = await read("examples/sdk-host/src/report-pin.ts");
assert.equal(sdkHostReportPin.includes(`sha256: "${compatibilitySha256}"`), true, "external SDK host report SHA-256 drift");
const compatibility = JSON.parse(compatibilitySource);
for (const expected of [compatibility.artifact.version, compatibility.artifact.integrity, compatibility.target.runtimeVersion]) {
  assert.equal(sdkHostReportPin.includes(expected), true, `external SDK host report identity drift: ${expected}`);
}

const reportSchema = await readJson("packages/compatibility/report.schema.json");
assert.equal(reportSchema.properties.target.properties.runtime.const, "browserpod", "report schema must be BrowserPod-only");
const inspector = await read("packages/compatibility/src/inspect.mjs");
assert.equal(inspector.includes("--host-evidence"), false, "inspector accepts removed host evidence");
assert.equal(inspector.includes("--gateway-evidence"), false, "inspector accepts removed Gateway evidence");

const history = await readJson("apps/web/public/data/release-history.json");
for (const release of history.releases) {
  const report = await readJson(`apps/web/public/data/${release.reportPath}`);
  assert.equal(report.target.runtime, "browserpod", `${release.channel} does not target BrowserPod`);
  assert.equal(report.target.runtimeVersion, "2.12.1", `${release.channel} BrowserPod version drift`);
}

if (process.argv.includes("--dist")) {
  for (const path of await filesUnder("dist")) {
    if (!/\.(?:html|js|css)$/u.test(path)) continue;
    const output = await readFile(path, "utf8");
    assert.equal(output.includes("@webcontainer/api"), false, `${path} bundles WebContainer`);
    assert.equal(output.includes("WebContainer.boot"), false, `${path} boots WebContainer`);
    assert.equal(output.includes("stackblitz.com"), false, `${path} permits StackBlitz`);
    assert.equal(output.includes("data-run-probe"), false, `${path} contains the legacy probe UI`);
  }
}

process.stdout.write("Validated BrowserPod-only active runtime paths and public reports.\n");
