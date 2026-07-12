import assert from "node:assert/strict";
import test from "node:test";

import { CapabilityBroker } from "../capability-broker/capability-broker.mjs";
import { CapabilityConsentController } from "../capability-broker/capability-consent.mjs";
import {
  buildPermissionPromptModel,
  mountCapabilityPermissionPrompt,
  serializeCapabilityAudit
} from "./permission-prompt.mjs";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;

const manifest = {
  schemaVersion: 1,
  generatedAt: "2026-07-12T00:00:00.000Z",
  subject: {
    runtime: "browserpod",
    sessionId: "permission-test",
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY }
  },
  permissions: [
    {
      capability: "storage.snapshot",
      scope: "workspace:primary",
      requestedMaxCalls: 2,
      grantedMaxCalls: 1,
      status: "granted",
      expiresAt: "2026-07-12T00:05:00.000Z"
    },
    {
      capability: "identity.sign",
      scope: "challenge:gateway",
      requestedMaxCalls: 3,
      grantedMaxCalls: null,
      status: "pending",
      expiresAt: null
    }
  ]
};

test("buildPermissionPromptModel derives bounded display state without payloads", () => {
  const model = buildPermissionPromptModel(manifest, { now: Date.parse("2026-07-12T00:03:00.000Z") });
  assert.equal(model.summary, "1 pending · 1 granted");
  assert.equal(model.permissions[0].remainingMs, 120_000);
  assert.equal(model.permissions[0].statusLabel, "Granted");
  assert.equal(model.permissions[1].remainingMs, null);
  assert.equal(JSON.stringify(model).includes("payload"), false);
});

test("buildPermissionPromptModel rejects malformed state and expiry", () => {
  assert.throws(() => buildPermissionPromptModel({ ...manifest, permissions: [{}] }), /entry is invalid/u);
  assert.throws(() => buildPermissionPromptModel({
    ...manifest,
    permissions: [{ ...manifest.permissions[0], expiresAt: "not-a-date" }]
  }), /expiry is invalid/u);
});

test("mountCapabilityPermissionPrompt rejects non-DOM hosts before decisions", () => {
  assert.throws(() => mountCapabilityPermissionPrompt({ container: {}, permissions: {} }), /DOM container/u);
});

test("serializeCapabilityAudit allowlists the stable payload-free schema", () => {
  let now = Date.parse("2026-07-12T00:00:00.000Z");
  const broker = new CapabilityBroker({
    subject: manifest.subject,
    clock: () => now
  });
  const consent = new CapabilityConsentController({
    broker,
    requests: [{ capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 2 }],
    clock: () => now
  });
  consent.approve("storage.snapshot", "workspace:primary", { durationMs: 60_000, maxCalls: 1 });
  now += 10;
  const audit = consent.exportAudit();
  const source = serializeCapabilityAudit(audit);
  const parsed = JSON.parse(source);
  assert.equal(parsed.subject.runtime, "browserpod");
  assert.equal(parsed.permissionAudit.events[0].action, "approve");
  assert.equal(source.includes("payload"), false);
  assert.throws(() => serializeCapabilityAudit({ ...audit, payload: "secret" }), /unknown field/u);
  assert.throws(() => serializeCapabilityAudit({
    ...audit,
    permissionAudit: {
      ...audit.permissionAudit,
      events: [{ ...audit.permissionAudit.events[0], input: "secret" }]
    }
  }), /unknown field/u);
});
