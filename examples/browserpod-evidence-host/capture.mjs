#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { assertBrowserRuntimeEvidence } from "../../packages/compatibility/src/report.mjs";

const root = resolve(import.meta.dirname, "../..");
const outputDirectory = resolve(root, "test-results/browserpod-evidence");
// The capture target defaults to the current stable report; a pinned
// alternative (for example an older-baseline artifact) may be selected with
// a repo-relative path that must stay inside the public data directory.
const publicDataDirectory = resolve(root, "apps/web/public/data");
const requestedReport = process.env.CLAWSEMBLY_EVIDENCE_REPORT?.trim() || "apps/web/public/data/compatibility.json";
const reportPath = resolve(root, requestedReport);
const apiKey = process.env.BROWSERPOD_API_KEY;
const statusPath = resolve(outputDirectory, "capture-status.json");
await mkdir(outputDirectory, { recursive: true });

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

let server;
let browser;
let page;
let artifact;
let evidencePath;
let stage = "initialize";
try {
  if (typeof apiKey !== "string" || !apiKey) {
    throw fail("missing_api_key", "BROWSERPOD_API_KEY is required for an owner-authorized capture.");
  }
  if (apiKey.length > 4_096) {
    throw fail("api_key_too_long", "BROWSERPOD_API_KEY exceeds the expected credential length.");
  }
  if (!reportPath.startsWith(publicDataDirectory)) {
    throw fail("invalid_report_path", "The evidence target report must live in the public data directory.");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const version = report?.artifact?.version;
  const nodeEngine = report?.artifact?.nodeEngine;
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/u.test(version ?? "")
    || report?.artifact?.package !== "openclaw" || typeof report?.artifact?.integrity !== "string"
    || typeof nodeEngine !== "string" || !/^>=\d+\.\d+(\.\d+)?$/u.test(nodeEngine)) {
    throw fail("invalid_report_identity", "The checked-in compatibility report identity is invalid.");
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
  stage = "host-server-start";
  server = await createServer({
    configFile: resolve(import.meta.dirname, "vite.config.mjs"),
    logLevel: "silent"
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw fail("host_address_unavailable", "Evidence host address is unavailable.");
  stage = "browser-launch";
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  stage = "host-page-load";
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
  stage = "capture-hook-wait";
  // The dev server finishes transforming and evaluating the host module graph
  // shortly after the load event on a cold dependency cache, so the capture
  // hook must be awaited rather than asserted at load time.
  await page.waitForFunction(
    () => typeof globalThis.__RUN_CLAWSEMBLY_BROWSERPOD_EVIDENCE__ === "function",
    undefined,
    { timeout: 60_000 }
  );
  stage = "capture-run";
  const evidence = await page.evaluate(async ({ credential, exactArtifact, artifactNodeEngine, evidenceSource }) => {
    if (typeof globalThis.__RUN_CLAWSEMBLY_BROWSERPOD_EVIDENCE__ !== "function") {
      throw new Error("BrowserPod evidence host is not ready.");
    }
    const capture = globalThis.__RUN_CLAWSEMBLY_BROWSERPOD_EVIDENCE__({
      apiKey: credential,
      artifact: exactArtifact,
      nodeEngine: artifactNodeEngine,
      source: evidenceSource
    });
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("BrowserPod evidence capture timed out.")), 15 * 60 * 1_000);
    });
    return Promise.race([capture, timeout]);
  }, { credential: apiKey, exactArtifact: artifact, artifactNodeEngine: nodeEngine, evidenceSource: source });
  stage = "evidence-validate";
  assertBrowserRuntimeEvidence(evidence);
  stage = "persist";
  const phaseCounts = await page.evaluate(() => globalThis.__CLAWSEMBLY_PHASE_COUNTS__);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: evidence.capturedAt,
    result: "pass",
    artifact,
    reportPath: requestedReport,
    phaseCounts
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Captured validated BrowserPod evidence for openclaw@${artifact.version}.\n`);
} catch (error) {
  let phaseCounts = {};
  let pageFailureCode = null;
  try { phaseCounts = await page?.evaluate(() => globalThis.__CLAWSEMBLY_PHASE_COUNTS__) ?? {}; }
  catch { /* Browser failure cannot expose raw diagnostics. */ }
  try { pageFailureCode = await page?.evaluate(() => globalThis.__CLAWSEMBLY_FAILURE_CODE__) ?? null; }
  catch { /* Browser failure cannot expose raw diagnostics. */ }
  const directCode = typeof error?.code === "string" && /^[a-z0-9_-]{1,64}$/u.test(error.code)
    ? error.code
    : null;
  const sanitizedPageCode = typeof pageFailureCode === "string" && /^[a-z0-9_-]{1,64}$/u.test(pageFailureCode)
    ? pageFailureCode
    : null;
  const errorCode = directCode ?? sanitizedPageCode ?? "capture_failed";
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    result: "fail",
    artifact: artifact ?? null,
    reportPath: requestedReport,
    errorCode,
    failedStage: stage,
    phaseCounts
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  throw new Error("BrowserPod evidence capture failed; inspect the payload-free status artifact.");
} finally {
  await browser?.close();
  await server?.close();
}
