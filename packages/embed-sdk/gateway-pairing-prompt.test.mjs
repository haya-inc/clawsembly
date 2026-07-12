import assert from "node:assert/strict";
import test from "node:test";

import { buildGatewayPairingPromptModel, mountGatewayPairingPrompt } from "./gateway-pairing-prompt.mjs";

const review = Object.freeze({
  schemaVersion: 1,
  reviewId: "review-1",
  requestId: "pairing-request-1",
  deviceId: "a".repeat(64),
  reason: "scope-upgrade",
  requested: Object.freeze({
    roles: Object.freeze(["operator"]),
    scopes: Object.freeze(["operator.read", "operator.write"])
  }),
  approved: Object.freeze({
    roles: Object.freeze(["operator"]),
    scopes: Object.freeze(["operator.read"])
  }),
  expiresAt: "2026-07-12T00:05:00.000Z"
});

test("builds a bounded pairing prompt model without keys, tokens, or remote metadata", () => {
  const model = buildGatewayPairingPromptModel(review, { now: Date.parse("2026-07-12T00:01:00.000Z") });
  assert.equal(model.reasonLabel, "Scope upgrade");
  assert.equal(model.deviceLabel, `${"a".repeat(12)}…${"a".repeat(8)}`);
  assert.equal(model.remainingMs, 240_000);
  assert.equal(JSON.stringify(model).includes("token"), false);
  assert.equal(JSON.stringify(model).includes("publicKey"), false);
  assert.equal(JSON.stringify(model).includes("remoteIp"), false);
});

test("rejects expired, malformed, and non-DOM pairing prompts", () => {
  assert.throws(() => buildGatewayPairingPromptModel(review, {
    now: Date.parse("2026-07-12T00:05:00.000Z")
  }), /expired/u);
  assert.throws(() => buildGatewayPairingPromptModel({ ...review, deviceId: "short" }), /review is invalid/u);
  assert.throws(() => mountGatewayPairingPrompt({ container: {}, review }), /DOM container/u);
});
