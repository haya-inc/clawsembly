import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  bootVerifiedEmbed,
  createArtifactStorageKey,
  createEmbedSessionLifecycle
} from "./boot.mjs";
import { createEmbedManifest } from "./embed-manifest.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";
import { loadVerifiedCompatibilityReport } from "./report-loader.mjs";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;

function report({ status = "supported", runtime = "browserpod", runtimeVersion = "2.12.1" } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    target: { runtime, runtimeVersion, browserBaseline: "Desktop Chromium" },
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
    evidence: status === "probing" ? [] : [{
      id: "browserpod-runtime",
      kind: "browser-runtime",
      path: "evidence/browserpod-openclaw-2026.6.11.json",
      sha256: "a".repeat(64)
    }],
    checks: [{ id: "runtime", status: status === "supported" ? "pass" : "pending" }]
  };
}

async function verifyReport(value) {
  const body = `${JSON.stringify(value)}\n`;
  return loadVerifiedCompatibilityReport({
    url: "https://example.com/compatibility.json",
    sha256: createHash("sha256").update(body).digest("hex"),
    maxAgeMs: 24 * 60 * 60 * 1_000,
    artifact: value.artifact,
    target: { runtime: "browserpod", runtimeVersion: "2.12.1" }
  }, {
    fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } })
  });
}

const VERIFIED_REPORT = await verifyReport(report());

function fakeBrowserPod() {
  const calls = [];
  const files = new Map();
  return {
    calls,
    files,
    BrowserPod: {
      async boot(options) {
        calls.push(options);
        return {
          onPortal() {},
          async createCustomTerminal() { return {}; },
          async run() { return {}; },
          async createDirectory() {},
          async createFile(path) {
            let text = "";
            return {
              async write(value) { text += value; files.set(path, text); },
              async close() {}
            };
          },
          async openFile(path) {
            const text = files.get(path) ?? "";
            return {
              async getSize() { return text.length; },
              async read() { return text; },
              async close() {}
            };
          }
        };
      }
    }
  };
}

test("refuses cross-runtime or partial evidence before spending BrowserPod tokens", async () => {
  const fake = fakeBrowserPod();
  const manifest = createEmbedManifest({ report: report({ status: "partial", runtime: "remote", runtimeVersion: undefined }) });
  await assert.rejects(
    bootVerifiedEmbed({ manifest, BrowserPod: fake.BrowserPod, browserPodApiKey: "secret" }),
    /verified BrowserPod launch blocked/u
  );
  assert.equal(fake.calls.length, 0);
});

test("rejects an unsafe mailbox channel before BrowserPod boot", async () => {
  const fake = fakeBrowserPod();
  await assert.rejects(
    bootVerifiedEmbed({
      manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      mailboxChannelId: "../shared"
    }),
    /mailbox channel identifier is invalid/u
  );
  assert.equal(fake.calls.length, 0);
});

test("rejects unknown mailbox options before BrowserPod boot", async () => {
  const fake = fakeBrowserPod();
  await assert.rejects(
    bootVerifiedEmbed({
      manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      mailboxOptions: { root: "/workspace/shared" }
    }),
    /mailbox options contain an unknown field/u
  );
  assert.equal(fake.calls.length, 0);
});

test("rejects invalid installer diagnostics before BrowserPod boot", async () => {
  const fake = fakeBrowserPod();
  await assert.rejects(
    bootVerifiedEmbed({
      manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      onInstallOutput: "console"
    }),
    /install output sink is invalid/u
  );
  assert.equal(fake.calls.length, 0);
});

test("rejects invalid Gateway options before BrowserPod boot", async () => {
  const fake = fakeBrowserPod();
  await assert.rejects(
    bootVerifiedEmbed({
      manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      gatewayOptions: { port: 70_000 }
    }),
    /Gateway port is invalid/u
  );
  await assert.rejects(
    bootVerifiedEmbed({
      manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      gatewayOptions: { authToken: "ambient" }
    }),
    /Gateway options contain an unknown field/u
  );
  await assert.rejects(
    bootVerifiedEmbed({
      manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      gatewayOptions: { allowedOrigins: ["*"] }
    }),
    /exact OpenClaw browser origin/u
  );
  assert.equal(fake.calls.length, 0);
});

test("creates an artifact-bound protocol client without issuing connection authority early", async () => {
  const fake = fakeBrowserPod();
  const exactReport = report();
  exactReport.artifact = {
    package: "openclaw",
    version: OPENCLAW_GATEWAY_CONTRACT.artifact.version,
    integrity: OPENCLAW_GATEWAY_CONTRACT.artifact.integrity
  };
  const session = await bootVerifiedEmbed({
    manifest: createEmbedManifest({ report: await verifyReport(exactReport) }),
    BrowserPod: fake.BrowserPod,
    browserPodApiKey: "secret",
    gatewayOptions: { allowedOrigins: ["https://embed.example"] }
  });
  const client = session.createGatewayClient({
    browserOrigin: "https://embed.example",
    identity: {
      async descriptor() { return {}; },
      async signConnect() { return {}; }
    },
    createWebSocket() { throw new Error("must not open before Gateway readiness"); }
  });
  assert.equal(client.state, "idle");
  await assert.rejects(client.connect(), (error) => error.code === "gateway_not_ready");
  assert.equal(client.state, "idle");
});

test("boots a verified BrowserPod session and binds capability authority to its artifact", async () => {
  const fake = fakeBrowserPod();
  const manifest = createEmbedManifest({
    report: VERIFIED_REPORT,
    capabilities: [{ capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 1 }]
  });
  const session = await bootVerifiedEmbed({
    manifest,
    BrowserPod: fake.BrowserPod,
    browserPodApiKey: "secret",
    workspaceId: "primary",
    sessionId: "verified-session",
    mailboxChannelId: "verified_mailbox",
    capabilityHandlers: {
      "storage.snapshot": async (input) => ({ stored: input.name })
    }
  });
  assert.equal(session.runtime.provider, "browserpod");
  assert.equal(session.installer.state, "idle");
  assert.deepEqual(session.installer.artifact, manifest.artifact);
  assert.equal(session.installer.executablePath, "/workspace/.clawsembly/openclaw/node_modules/openclaw/openclaw.mjs");
  assert.equal(session.gateway.state, "idle");
  assert.equal(session.gateway.port, 18_789);
  assert.deepEqual(session.gateway.artifact, manifest.artifact);
  assert.equal(fake.calls[0].storageKey, "clawsembly:2026.6.11:primary");
  assert.deepEqual(session.capabilities.subject, {
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
    runtime: "browserpod",
    sessionId: "verified-session"
  });
  const mailboxManifest = JSON.parse(fake.files.get(
    "/workspace/.clawsembly/mailbox/verified_mailbox/manifest.json"
  ));
  assert.deepEqual(mailboxManifest.subject, session.capabilities.subject);
  assert.equal(session.mailbox.nextSequence, 1);
  assert.deepEqual({
    kind: session.guestTransport.kind,
    channelId: session.guestTransport.channelId,
    mailboxRoot: session.guestTransport.mailboxRoot,
    verified: session.guestTransport.client.verified,
    entrypointPath: session.guestTransport.client.entrypointPath
  }, {
    kind: "filesystem-mailbox",
    channelId: "verified_mailbox",
    mailboxRoot: "/workspace/.clawsembly/mailbox/verified_mailbox",
    verified: true,
    entrypointPath: "/workspace/.clawsembly/mailbox/verified_mailbox/guest-client-v1/guest-mailbox-client.mjs"
  });
  assert.equal(session.guestTransport.client.files.length, 2);
  assert.match(session.guestTransport.client.integrity, /^sha256-[a-f0-9]{64}$/u);
  assert.equal(fake.files.get(session.guestTransport.client.entrypointPath)?.includes("node:fs/promises"), true);
  assert.deepEqual(session.guestTransport.environment, [
    "CLAWSEMBLY_MAILBOX_ROOT=/workspace/.clawsembly/mailbox/verified_mailbox",
    "CLAWSEMBLY_MAILBOX_CHANNEL=verified_mailbox",
    "CLAWSEMBLY_MAILBOX_CLIENT=/workspace/.clawsembly/mailbox/verified_mailbox/guest-client-v1/guest-mailbox-client.mjs"
  ]);
  const request = {
    id: "snapshot-1",
    capability: "storage.snapshot",
    scope: "workspace:primary",
    input: { name: "private-payload" }
  };
  await assert.rejects(
    session.capabilities.request(request),
    (error) => error.code === "not_granted"
  );
  assert.equal(session.permissions.manifest().permissions[0].status, "pending");
  session.permissions.approve("storage.snapshot", "workspace:primary", {
    durationMs: 60_000,
    maxCalls: 1
  });
  assert.deepEqual(await session.capabilities.request({ ...request, id: "snapshot-2" }), { stored: "private-payload" });
  assert.equal(session.permissions.manifest().permissions[0].status, "granted");
  assert.equal(JSON.stringify(session.permissions.exportAudit()).includes("private-payload"), false);
  assert.equal(JSON.stringify(fake.calls).includes("secret"), true);
  assert.equal(JSON.stringify(session).includes("secret"), false);
});

test("binds persistent storage keys to the exact OpenClaw version", () => {
  const one = createEmbedManifest({ report: report() });
  const nextReport = report();
  const two = createEmbedManifest({
    report: { ...nextReport, artifact: { ...nextReport.artifact, version: "2026.7.0" } }
  });
  assert.equal(createArtifactStorageKey(one, "primary"), "clawsembly:2026.6.11:primary");
  assert.equal(createArtifactStorageKey(two, "primary"), "clawsembly:2026.7.0:primary");
  assert.throws(() => createArtifactStorageKey(one, "../shared"), /workspace identifier is invalid/u);
});

test("closes the logical session without claiming undocumented hard disposal", async () => {
  const fake = fakeBrowserPod();
  const session = await bootVerifiedEmbed({
    manifest: createEmbedManifest({ report: VERIFIED_REPORT }),
    BrowserPod: fake.BrowserPod,
    browserPodApiKey: "secret"
  });
  const result = session.dispose();
  assert.equal(session.closed, true);
  assert.equal(result.complete, false);
  assert.match(result.reason, /no documented pod or process termination/u);
});

test("session lifecycle stops an active Gateway before logical disposal", async () => {
  let gatewayState = "ready";
  let disposeCalls = 0;
  let stopCalls = 0;
  let closeConnectionCalls = 0;
  const lifecycle = createEmbedSessionLifecycle({
    runtime: {
      dispose() {
        disposeCalls += 1;
        return { complete: false, reason: "provider hard disposal unavailable", activeTaskIds: [] };
      }
    },
    gateway: {
      get state() { return gatewayState; },
      task: { id: "gateway-task-1", status: "running" },
      async stop() {
        stopCalls += 1;
        gatewayState = "stopped";
        return {
          complete: true,
          mode: "guest-supervisor",
          reason: "guest child acknowledged cooperative stop",
          taskId: "gateway-task-1",
          durationMs: 10
        };
      }
    },
    closeConnections() { closeConnectionCalls += 1; }
  });
  const refused = lifecycle.dispose();
  assert.equal(refused.complete, false);
  assert.match(refused.reason, /must stop/u);
  assert.equal(disposeCalls, 0);
  assert.equal(lifecycle.closed, false);

  const closed = await lifecycle.close();
  assert.equal(closed.logicalSessionClosed, true);
  assert.equal(closed.gatewayStop.complete, true);
  assert.equal(closed.runtimeDisposition.complete, false);
  assert.equal(stopCalls, 1);
  assert.equal(closeConnectionCalls, 1);
  assert.equal(disposeCalls, 1);
  assert.equal(lifecycle.closed, true);
});

test("session lifecycle retains runtime access when Gateway stop fails", async () => {
  let disposeCalls = 0;
  const lifecycle = createEmbedSessionLifecycle({
    runtime: {
      dispose() { disposeCalls += 1; return { complete: false, reason: "logical", activeTaskIds: [] }; }
    },
    gateway: {
      state: "ready",
      task: { id: "gateway-task-1", status: "running" },
      async stop() {
        return {
          complete: false,
          mode: "guest-supervisor",
          reason: "stop timeout",
          taskId: "gateway-task-1",
          durationMs: 15_000
        };
      }
    }
  });
  const result = await lifecycle.close();
  assert.equal(result.logicalSessionClosed, false);
  assert.equal(result.reason, "stop timeout");
  assert.equal(disposeCalls, 0);
  assert.equal(lifecycle.closed, false);
});
