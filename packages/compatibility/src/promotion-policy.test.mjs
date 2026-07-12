import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildPromotionPolicy, isBlockingGatewayClassification } from "./promotion-policy.mjs";

const schema = JSON.parse(readFileSync(new URL("../promotion-policy.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function release(channel, overrides = {}) {
  return {
    channel,
    version: channel === "preview" ? "2.0.0-beta.1" : channel === "stable" ? "1.1.0" : "1.0.0",
    status: "supported",
    runtimeEvidence: true,
    artifact: { shrinkwrapConsistent: true },
    checks: { pass: 10, warn: 0, fail: 0, pending: 0 },
    dependencyRiskFromStable: [],
    gatewayContractFromStable: { classification: channel === "stable" ? "unchanged" : "additive" },
    ...overrides
  };
}

function history(releases) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-12T00:00:00.000Z",
    package: "openclaw",
    releases
  };
}

test("promotes only a fully evidenced additive preview", () => {
  const policy = buildPromotionPolicy(history([
    release("stable"), release("previous"), release("preview")
  ]));
  assert.equal(policy.decision, "promote");
  assert.equal(policy.candidate.eligible, true);
  assert.deepEqual(policy.candidate.reasons, []);
  assert.equal(validate(policy), true, JSON.stringify(validate.errors));
});

test("holds a preview with missing evidence, pending checks, and a breaking Gateway contract", () => {
  const policy = buildPromotionPolicy(history([
    release("stable"),
    release("previous"),
    release("preview", {
      status: "probing",
      runtimeEvidence: false,
      artifact: { shrinkwrapConsistent: false },
      checks: { pass: 1, warn: 3, fail: 0, pending: 15 },
      dependencyRiskFromStable: [{ scan: { truncated: true } }],
      gatewayContractFromStable: { classification: "breaking" }
    })
  ]));
  assert.equal(policy.decision, "hold");
  assert.deepEqual(policy.candidate.reasons, [
    "status-not-supported",
    "runtime-evidence-missing",
    "checks-pending",
    "shrinkwrap-inconsistent",
    "gateway-contract-breaking",
    "dependency-risk-scan-truncated"
  ]);
  assert.equal(policy.candidate.observations.truncatedDependencyRiskCount, 1);
  assert.equal(validate(policy), true, JSON.stringify(validate.errors));
});

test("publishes rollback eligibility independently from the preview decision", () => {
  const policy = buildPromotionPolicy(history([
    release("stable"),
    release("previous", { runtimeEvidence: false }),
    release("preview")
  ]));
  assert.equal(policy.decision, "promote");
  assert.equal(policy.rollback.eligible, false);
  assert.deepEqual(policy.rollback.reasons, ["runtime-evidence-missing"]);
});

test("rejects incomplete inputs and identifies fail-closed Gateway states", () => {
  assert.throws(() => buildPromotionPolicy({ schemaVersion: 1, releases: [] }), /release history/u);
  assert.equal(isBlockingGatewayClassification("breaking"), true);
  assert.equal(isBlockingGatewayClassification("incomplete"), true);
  assert.equal(isBlockingGatewayClassification("additive"), false);
});
