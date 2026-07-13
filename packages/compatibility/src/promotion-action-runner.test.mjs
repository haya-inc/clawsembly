import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Executes the real Action runner. The metadata grep test pins its shape;
// these runs pin its behavior on the paths that need no network success.
const runnerPath = fileURLToPath(new URL("../../../actions/promotion-policy/run.mjs", import.meta.url));

function runAction(env) {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [runnerPath], {
      env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => settle({ code, stdout, stderr }));
  });
}

test("runner rejects an unknown mode before any network access", async () => {
  const result = await runAction({
    INPUT_MODE: "promote-now",
    INPUT_POLICY_URL: "https://policy.invalid/promotion-policy.json"
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"mode" must be "observe" or "gate"/u);
});

test("runner enforces credential-free HTTPS policy sources", async () => {
  const result = await runAction({
    INPUT_MODE: "observe",
    INPUT_POLICY_URL: "http://127.0.0.1:8080/promotion-policy.json"
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /credential-free HTTPS/u);
});

test("runner fails closed and writes no outputs when the policy is unreachable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawsembly-action-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "github-output.txt");
  await writeFile(outputPath, "", "utf8");
  const result = await runAction({
    INPUT_MODE: "gate",
    INPUT_POLICY_URL: "https://127.0.0.1:1/promotion-policy.json",
    GITHUB_OUTPUT: outputPath
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Clawsembly policy action failed:/u);
  assert.equal(await readFile(outputPath, "utf8"), "");
});
