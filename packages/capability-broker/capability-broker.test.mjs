import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityBroker,
  CapabilityBrokerError,
  runCapabilityBrokerPolicyProbe
} from "./capability-broker.mjs";

const subject = {
  artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-test" },
  runtime: "browserpod",
  sessionId: "session-1"
};

test("denies ungranted requests and records no payload material", async () => {
  const secret = "must-not-enter-the-audit";
  const broker = new CapabilityBroker({ subject });
  await assert.rejects(
    broker.request({ id: "request-1", capability: "network.fetch", scope: "origin:https://example.com", input: { secret } }),
    (error) => error instanceof CapabilityBrokerError && error.code === "not_granted"
  );
  const audit = broker.auditSnapshot();
  assert.equal(audit.events[0].outcome, "denied");
  assert.equal(audit.events[0].reason, "not_granted");
  assert.equal(JSON.stringify(audit).includes(secret), false);
});

test("matches exact scopes and consumes the grant before concurrent handler work", async () => {
  let releases = 0;
  const broker = new CapabilityBroker({
    subject,
    grants: [{ capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 1 }],
    handlers: {
      "storage.snapshot": async () => {
        releases += 1;
        await Promise.resolve();
        return { stored: true };
      }
    }
  });
  const allowed = broker.request({ id: "request-2", capability: "storage.snapshot", scope: "workspace:primary", input: {} });
  const denied = broker.request({ id: "request-3", capability: "storage.snapshot", scope: "workspace:primary", input: {} });
  assert.deepEqual(await allowed, { stored: true });
  await assert.rejects(denied, (error) => error.code === "call_limit_exhausted");
  assert.equal(releases, 1);
});

test("supports explicit grant and revocation with control audit events", async () => {
  const broker = new CapabilityBroker({
    subject,
    handlers: { "identity.sign": async () => "public-signature" }
  });
  broker.grant({ capability: "identity.sign", scope: "challenge:gateway", maxCalls: 2 });
  assert.equal(await broker.request({ id: "request-4", capability: "identity.sign", scope: "challenge:gateway", input: {} }), "public-signature");
  assert.equal(broker.revoke("identity.sign", "challenge:gateway"), true);
  await assert.rejects(
    broker.request({ id: "request-5", capability: "identity.sign", scope: "challenge:gateway", input: {} }),
    (error) => error.code === "not_granted"
  );
  assert.deepEqual(broker.auditSnapshot().events.map((event) => event.action), ["grant", "request", "revoke", "request"]);
});

test("fails closed on expired grants and redacts handler exceptions", async () => {
  let now = Date.parse("2026-07-12T00:00:00.000Z");
  const broker = new CapabilityBroker({
    subject,
    clock: () => now,
    grants: [{
      capability: "provider.openai.responses",
      scope: "model:test",
      expiresAt: "2026-07-12T00:01:00.000Z"
    }],
    handlers: { "provider.openai.responses": async () => { throw new Error("secret provider failure body"); } }
  });
  await assert.rejects(
    broker.request({ id: "request-6", capability: "provider.openai.responses", scope: "model:test", input: {} }),
    (error) => error.code === "handler_failed" && !error.message.includes("secret")
  );
  assert.equal(JSON.stringify(broker.auditSnapshot()).includes("secret"), false);
  broker.grant({
    capability: "provider.openai.responses",
    scope: "model:expired",
    expiresAt: "2026-07-12T00:01:00.000Z"
  });
  now = Date.parse("2026-07-12T00:02:00.000Z");
  await assert.rejects(
    broker.request({ id: "request-7", capability: "provider.openai.responses", scope: "model:expired", input: {} }),
    (error) => error.code === "grant_expired"
  );
});

test("cancels before dispatch and validates the exact artifact subject", async () => {
  for (const forged of ["../fork", "Fork", "fork ", `x${"a".repeat(214)}`, 7]) {
    assert.throws(
      () => new CapabilityBroker({ subject: { ...subject, artifact: { package: forged, version: "1", integrity: "sha512-x" } } }),
      /artifact identity is invalid/u
    );
  }
  const secondUpstream = new CapabilityBroker({
    subject: { ...subject, artifact: { package: "clawsembly-hello-agent", version: "0.1.0", integrity: "sha512-hello" } }
  });
  assert.equal(secondUpstream.subject.artifact.package, "clawsembly-hello-agent");
  const broker = new CapabilityBroker({
    subject,
    grants: [{ capability: "notification.show", scope: "channel:browser" }],
    handlers: { "notification.show": async () => true }
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    broker.request({ id: "request-8", capability: "notification.show", scope: "channel:browser", input: {} }, { signal: controller.signal }),
    (error) => error.code === "cancelled"
  );
});

test("browser policy probe proves default deny, exact scopes, limits, and redaction", async () => {
  assert.deepEqual(await runCapabilityBrokerPolicyProbe(), {
    result: "pass",
    runtime: "browserpod",
    defaultDeny: true,
    exactScope: true,
    callLimit: true,
    payloadRedacted: true,
    auditEvents: 3
  });
});
