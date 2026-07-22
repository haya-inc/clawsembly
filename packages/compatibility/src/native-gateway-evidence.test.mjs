import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { assertNativeGatewayEvidence } from "./native-gateway-capture.mjs";

// The checked-in record is a point-in-time capture of this exact artifact;
// the literals are pinned here on purpose so the test keeps proving the
// 2026.7.1-2 capture even after the tracked stable moves on.
const CAPTURED_ARTIFACT = Object.freeze({
  package: "openclaw",
  version: "2026.7.1-2",
  integrity: "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g=="
});
const evidencePath = resolve(
  import.meta.dirname,
  `../evidence/native-gateway-openclaw-${CAPTURED_ARTIFACT.version}.json`
);

test("the checked-in native-gateway record passes the digest-bound admission gate", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(assertNativeGatewayEvidence(evidence, { artifact: CAPTURED_ARTIFACT }), evidence);

  // A plain-Node capture of the real stable artifact, never BrowserPod
  // evidence: the class discipline is what makes the record honest.
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.target.package, CAPTURED_ARTIFACT.package);
  assert.equal(evidence.target.integrity, CAPTURED_ARTIFACT.integrity);
  assert.equal(evidence.target.runtime, "native-node");
  assert.equal(evidence.target.browserLocal, false);
  assert.equal(evidence.engines.declared, ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0");
  assert.equal(evidence.install.integrityMatched, true);

  // The full generated-client exercise, captured with no model-provider
  // credential: the chat run terminating at the provider boundary is the
  // recorded expected outcome.
  assert.equal(evidence.protocol.handshake.authenticatedWith, "shared-token");
  assert.equal(evidence.protocol.handshake.deviceTokenIssued, true);
  assert.equal(evidence.protocol.chat.providerCredential, false);
  assert.equal(evidence.protocol.abort.ok, true);
  assert.equal(evidence.protocol.reconnect.authenticatedWith, "device-token");
});
