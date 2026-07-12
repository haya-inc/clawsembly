import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { CapabilityBroker } from "./capability-broker.mjs";
import { CapabilityConsentController } from "./capability-consent.mjs";

const subject = {
  artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-consent-test" },
  runtime: "browserpod",
  sessionId: "consent-session"
};

function setup(clock) {
  const broker = new CapabilityBroker({
    subject,
    clock,
    handlers: {
      "storage.snapshot": async (input) => ({ stored: input.name }),
      "notification.show": async () => true
    }
  });
  const permissions = new CapabilityConsentController({
    broker,
    clock,
    requests: [
      { capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 2 },
      { capability: "notification.show", scope: "channel:browser", maxCalls: 1 }
    ]
  });
  return { broker, permissions };
}

test("keeps manifest requests pending until an explicit bounded approval", async () => {
  let now = Date.parse("2026-07-12T00:00:00.000Z");
  const { broker, permissions } = setup(() => now);
  assert.deepEqual(permissions.manifest().permissions.map((permission) => permission.status), ["pending", "pending"]);
  await assert.rejects(
    broker.request({
      id: "before-consent",
      capability: "storage.snapshot",
      scope: "workspace:primary",
      input: { name: "blocked" }
    }),
    (error) => error.code === "not_granted"
  );

  const decision = permissions.approve("storage.snapshot", "workspace:primary", {
    durationMs: 60_000,
    maxCalls: 1
  });
  assert.equal(decision.status, "granted");
  assert.equal(decision.requestedMaxCalls, 2);
  assert.equal(decision.grantedMaxCalls, 1);
  assert.equal(decision.expiresAt, "2026-07-12T00:01:00.000Z");
  assert.deepEqual(await broker.request({
    id: "after-consent",
    capability: "storage.snapshot",
    scope: "workspace:primary",
    input: { name: "primary" }
  }), { stored: "primary" });
  await assert.rejects(
    broker.request({
      id: "over-limit",
      capability: "storage.snapshot",
      scope: "workspace:primary",
      input: { name: "second" }
    }),
    (error) => error.code === "call_limit_exhausted"
  );

  now += 60_000;
  assert.equal(permissions.manifest().permissions[0].status, "expired");
  await assert.rejects(
    broker.request({
      id: "after-expiry",
      capability: "storage.snapshot",
      scope: "workspace:primary",
      input: null
    }),
    (error) => error.code === "not_granted"
  );
});

test("supports deny and revoke without accepting undeclared authority", async () => {
  const { broker, permissions } = setup(() => Date.parse("2026-07-12T00:00:00.000Z"));
  permissions.deny("notification.show", "channel:browser");
  assert.equal(permissions.manifest().permissions[1].status, "denied");
  assert.throws(
    () => permissions.approve("network.fetch", "origin:https://example.com"),
    /not requested by the verified manifest/u
  );
  assert.throws(
    () => permissions.approve("storage.snapshot", "workspace:primary", { maxCalls: 3 }),
    /exceeds the request/u
  );
  permissions.approve("storage.snapshot", "workspace:primary");
  assert.equal(permissions.revoke("storage.snapshot", "workspace:primary"), true);
  assert.equal(permissions.manifest().permissions[0].status, "revoked");
  await assert.rejects(
    broker.request({
      id: "after-revoke",
      capability: "storage.snapshot",
      scope: "workspace:primary",
      input: null
    }),
    (error) => error.code === "not_granted"
  );
});

test("exports schema-valid payload-free permission and broker audit", async () => {
  const now = Date.parse("2026-07-12T00:00:00.000Z");
  const secret = "payload-must-not-enter-export";
  const { broker, permissions } = setup(() => now);
  permissions.approve("storage.snapshot", "workspace:primary", { maxCalls: 1 });
  await broker.request({
    id: "audited-request",
    capability: "storage.snapshot",
    scope: "workspace:primary",
    input: { name: secret }
  });

  const manifest = permissions.manifest();
  const audit = permissions.exportAudit();
  assert.equal(JSON.stringify(manifest).includes(secret), false);
  assert.equal(JSON.stringify(audit).includes(secret), false);

  const manifestSchema = JSON.parse(await readFile(new URL("./capability-manifest.schema.json", import.meta.url), "utf8"));
  const auditSchema = JSON.parse(await readFile(new URL("./capability-audit.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(manifestSchema);
  const validateManifest = ajv.getSchema(manifestSchema.$id);
  const validateAudit = ajv.compile(auditSchema);
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
  assert.equal(validateAudit(audit), true, JSON.stringify(validateAudit.errors));
});
