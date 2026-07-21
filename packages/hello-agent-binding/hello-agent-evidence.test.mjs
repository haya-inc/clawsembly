import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { HELLO_AGENT_ARTIFACT } from "./hello-agent-artifact.generated.mjs";
import {
  assertHelloAgentRuntimeEvidence,
  deriveHelloAgentCheckStatuses,
  helloAgentEvidenceRecord
} from "./hello-agent-binding.mjs";

const evidencePath = resolve(
  import.meta.dirname,
  `evidence/hello-agent-${HELLO_AGENT_ARTIFACT.version}.json`
);
const recordPath = resolve(
  import.meta.dirname,
  `evidence/hello-agent-${HELLO_AGENT_ARTIFACT.version}.record.json`
);

test("the checked-in owner-authorized evidence passes the digest-bound gate", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(assertHelloAgentRuntimeEvidence(evidence), evidence);

  // The record reference must recompute from the stored evidence bytes; a
  // hand-edited record or evidence file fails here.
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const recomputed = await helloAgentEvidenceRecord(evidence);
  assert.deepEqual(record, recomputed);
  assert.equal(record.path, `evidence/hello-agent-${HELLO_AGENT_ARTIFACT.version}.json`);
  assert.equal(record.kind, "browser-runtime");

  // A real provider capture, not the local double: the adapter version is the
  // pinned BrowserPod client and the browser string is a real user agent.
  assert.equal(evidence.target.runtime, "browserpod");
  assert.equal(evidence.target.browserLocal, true);
  assert.equal(evidence.target.runtimeVersion, "2.12.1");
  assert.match(evidence.target.browser, /Chrome|Chromium/u);
  assert.equal(evidence.target.browser.includes("local Node provider double"), false);

  assert.deepEqual(deriveHelloAgentCheckStatuses(evidence), {
    "hello-agent-install": "pass",
    "hello-agent-boot": "pass",
    "hello-agent-protocol": "pass",
    "hello-agent-capability": "pass"
  });
});
