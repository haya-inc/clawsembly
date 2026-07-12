#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { assertBrowserRuntimeEvidence } from "../../packages/compatibility/src/report.mjs";

const root = resolve(import.meta.dirname, "../..");
const outputDirectory = resolve(root, "test-results/browserpod-evidence");
const reportPath = resolve(root, "apps/web/public/data/compatibility.json");
const apiKey = process.env.BROWSERPOD_API_KEY;
const statusPath = resolve(outputDirectory, "capture-status.json");
await mkdir(outputDirectory, { recursive: true });

let server;
let browser;
let page;
let artifact;
let evidencePath;
try {
  if (typeof apiKey !== "string" || !apiKey || apiKey.length > 4_096) {
    throw new Error("BROWSERPOD_API_KEY is required for an owner-authorized capture.");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const version = report?.artifact?.version;
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/u.test(version ?? "")
    || report?.artifact?.package !== "openclaw" || typeof report?.artifact?.integrity !== "string") {
    throw new Error("The checked-in stable compatibility report identity is invalid.");
  }
  artifact = {
    package: "openclaw",
    version,
    integrity: report.artifact.integrity
  };
  evidencePath = resolve(outputDirectory, `browserpod-openclaw-${version}.json`);
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local owner-authorized BrowserPod evidence capture";
  const source = `Clawsembly owner-authorized BrowserPod capture: ${runUrl}`.slice(0, 512);
  server = await createServer({
    configFile: resolve(import.meta.dirname, "vite.config.mjs"),
    logLevel: "silent"
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Evidence host address is unavailable.");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
  const evidence = await page.evaluate(async ({ credential, exactArtifact, evidenceSource }) => {
    if (typeof globalThis.__RUN_CLAWSEMBLY_BROWSERPOD_EVIDENCE__ !== "function") {
      throw new Error("BrowserPod evidence host is not ready.");
    }
    const capture = globalThis.__RUN_CLAWSEMBLY_BROWSERPOD_EVIDENCE__({
      apiKey: credential,
      artifact: exactArtifact,
      source: evidenceSource
    });
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("BrowserPod evidence capture timed out.")), 15 * 60 * 1_000);
    });
    return Promise.race([capture, timeout]);
  }, { credential: apiKey, exactArtifact: artifact, evidenceSource: source });
  assertBrowserRuntimeEvidence(evidence);
  const phaseCounts = await page.evaluate(() => globalThis.__CLAWSEMBLY_PHASE_COUNTS__);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: evidence.capturedAt,
    result: "pass",
    artifact,
    phaseCounts
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Captured validated BrowserPod evidence for openclaw@${artifact.version}.\n`);
} catch (error) {
  let phaseCounts = {};
  try { phaseCounts = await page?.evaluate(() => globalThis.__CLAWSEMBLY_PHASE_COUNTS__) ?? {}; }
  catch { /* Browser failure cannot expose raw diagnostics. */ }
  const errorCode = typeof error?.code === "string" && /^[a-z0-9_-]{1,64}$/u.test(error.code)
    ? error.code
    : "capture_failed";
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    result: "fail",
    artifact: artifact ?? null,
    errorCode,
    phaseCounts
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  throw new Error("BrowserPod evidence capture failed; inspect the payload-free status artifact.");
} finally {
  await browser?.close();
  await server?.close();
}
