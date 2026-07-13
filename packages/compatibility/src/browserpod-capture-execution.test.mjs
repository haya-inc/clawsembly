import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Executes the real metered-capture harness on its zero-cost fail-fast path.
// The grep-based harness test pins its shape; this run pins the behavior that
// protects the BrowserPod budget: no API key means an immediate, recorded
// failure before any provider work.
const root = new URL("../../../", import.meta.url);
const capturePath = fileURLToPath(new URL("examples/browserpod-evidence-host/capture.mjs", root));
const statusUrl = new URL("test-results/browserpod-evidence/capture-status.json", root);

test("capture harness fails closed without an owner-authorized API key", async (t) => {
  let previousStatus;
  try { previousStatus = await readFile(statusUrl, "utf8"); }
  catch { previousStatus = undefined; }
  t.after(async () => {
    if (previousStatus === undefined) await rm(statusUrl, { force: true });
    else await writeFile(statusUrl, previousStatus, "utf8");
  });

  const environment = { ...process.env };
  delete environment.BROWSERPOD_API_KEY;
  const result = await new Promise((settle) => {
    const child = spawn(process.execPath, [capturePath], {
      cwd: fileURLToPath(root),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => settle({ code, stderr }));
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /payload-free status artifact/u);
  const status = JSON.parse(await readFile(statusUrl, "utf8"));
  assert.equal(status.result, "fail");
  assert.equal(status.errorCode, "missing_api_key");
  assert.equal(status.failedStage, "initialize");
  assert.equal(JSON.stringify(status).includes("BROWSERPOD_API_KEY="), false);
});
