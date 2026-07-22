#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import {
  HELLO_AGENT_ARTIFACT
} from "../../packages/hello-agent-binding/hello-agent-artifact.generated.mjs";
import {
  assertHelloAgentRuntimeEvidence,
  helloAgentEvidenceRecord
} from "../../packages/hello-agent-binding/hello-agent-binding.mjs";

const root = resolve(import.meta.dirname, "../..");
const outputDirectory = resolve(root, "test-results/hello-agent-evidence");
const apiKey = process.env.BROWSERPOD_API_KEY;
const statusPath = resolve(outputDirectory, "capture-status.json");
await mkdir(outputDirectory, { recursive: true });

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const artifact = {
  package: HELLO_AGENT_ARTIFACT.name,
  version: HELLO_AGENT_ARTIFACT.version,
  integrity: HELLO_AGENT_ARTIFACT.integrity
};
const evidencePath = resolve(outputDirectory, `hello-agent-${artifact.version}.json`);
const recordPath = resolve(outputDirectory, `hello-agent-${artifact.version}.record.json`);

let server;
let browser;
let page;
let stage = "initialize";
try {
  if (typeof apiKey !== "string" || !apiKey) {
    throw fail("missing_api_key", "BROWSERPOD_API_KEY is required for an owner-authorized capture.");
  }
  if (apiKey.length > 4_096) {
    throw fail("api_key_too_long", "BROWSERPOD_API_KEY exceeds the expected credential length.");
  }
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
  await page.waitForFunction(
    () => typeof globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_EVIDENCE__ === "function",
    undefined,
    { timeout: 60_000 }
  );
  stage = "capture-run";
  const { evidence, record } = await page.evaluate(async ({ credential }) => {
    if (typeof globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_EVIDENCE__ !== "function") {
      throw new Error("hello-agent evidence host is not ready.");
    }
    const capture = globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_EVIDENCE__({ apiKey: credential });
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("hello-agent evidence capture timed out.")), 15 * 60 * 1_000);
    });
    return Promise.race([capture, timeout]);
  }, { credential: apiKey });
  stage = "evidence-validate";
  assertHelloAgentRuntimeEvidence(evidence);
  const recomputed = await helloAgentEvidenceRecord(evidence);
  if (recomputed.sha256 !== record.sha256) {
    throw fail("record_mismatch", "The digest-bound evidence record does not match the captured evidence.");
  }
  stage = "persist";
  const phaseCounts = await page.evaluate(() => globalThis.__CLAWSEMBLY_PHASE_COUNTS__);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: evidence.capturedAt,
    result: "pass",
    artifact,
    phaseCounts
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Captured validated hello-agent evidence for ${artifact.package}@${artifact.version}.\n`);
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
    artifact,
    errorCode,
    failedStage: stage,
    phaseCounts
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  throw new Error("hello-agent evidence capture failed; inspect the payload-free status artifact.");
} finally {
  await browser?.close();
  await server?.close();
}
