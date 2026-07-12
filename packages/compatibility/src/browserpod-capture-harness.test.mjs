import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("examples/browserpod-evidence-host/package.json", root), "utf8"));
const lock = JSON.parse(readFileSync(new URL("examples/browserpod-evidence-host/package-lock.json", root), "utf8"));
const capture = readFileSync(new URL("examples/browserpod-evidence-host/capture.mjs", root), "utf8");
const host = readFileSync(new URL("examples/browserpod-evidence-host/src/main.js", root), "utf8");
const workflow = readFileSync(new URL(".github/workflows/runtime-browser.yml", root), "utf8");

test("owner-authorized BrowserPod capture pins the provider and keeps raw output out of artifacts", () => {
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies["@leaningtech/browserpod"], "2.12.1");
  const provider = lock.packages["node_modules/@leaningtech/browserpod"];
  assert.equal(provider.version, "2.12.1");
  assert.equal(
    provider.integrity,
    "sha512-KHaq3Sv2bRgtw0eGat1CwwFcHfAOrOW7Jgqzu4EsXqr+ASoaDrHn963KEr5AS1lIlNCqO4BAiL8QzP4XPk8iCQ=="
  );
  assert.match(capture, /assertBrowserRuntimeEvidence\(evidence\)/u);
  assert.match(capture, /test-results\/browserpod-evidence/u);
  assert.doesNotMatch(capture, /page\.on\(["']console|tracing\.start|chunk\s*:/u);
  assert.match(host, /options\.apiKey = undefined/u);
  assert.match(host, /encoder\.encode\(chunk\)\.byteLength/u);
  assert.doesNotMatch(host, /console\.|textContent\s*=\s*chunk/u);
});

test("metered capture is isolated behind workflow dispatch, environment review, and one secret", () => {
  assert.match(workflow, /capture_browserpod:\n[\s\S]*?type: boolean\n\s+default: false/u);
  assert.match(workflow, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.capture_browserpod == true \}\}/u);
  assert.match(workflow, /environment: browserpod-evidence/u);
  assert.match(workflow, /npm ci --prefix examples\/browserpod-evidence-host --ignore-scripts/u);
  assert.match(workflow, /BROWSERPOD_API_KEY: \$\{\{ secrets\.BROWSERPOD_API_KEY \}\}/u);
  assert.equal(workflow.match(/secrets\.BROWSERPOD_API_KEY/gu)?.length, 1);
  assert.match(workflow, /path: test-results\/browserpod-evidence/u);
  assert.doesNotMatch(workflow, /pull_request_target/u);
});
