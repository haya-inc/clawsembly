import assert from "node:assert/strict";
import test from "node:test";

import { bootVerifiedEmbed, createArtifactStorageKey } from "./boot.mjs";
import { createEmbedManifest } from "./embed-manifest.mjs";

function report({ status = "supported", runtime = "browserpod", runtimeVersion = "2.12.1" } = {}) {
  return {
    generatedAt: "2026-07-12T00:00:00.000Z",
    status,
    target: { runtime, runtimeVersion },
    artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-exact" }
  };
}

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
      manifest: createEmbedManifest({ report: report() }),
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
      manifest: createEmbedManifest({ report: report() }),
      BrowserPod: fake.BrowserPod,
      browserPodApiKey: "secret",
      mailboxOptions: { root: "/workspace/shared" }
    }),
    /mailbox options contain an unknown field/u
  );
  assert.equal(fake.calls.length, 0);
});

test("boots a verified BrowserPod session and binds capability authority to its artifact", async () => {
  const fake = fakeBrowserPod();
  const manifest = createEmbedManifest({
    report: report(),
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
  assert.equal(fake.calls[0].storageKey, "clawsembly:2026.6.11:primary");
  assert.deepEqual(session.capabilities.subject, {
    artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-exact" },
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
    manifest: createEmbedManifest({ report: report() }),
    BrowserPod: fake.BrowserPod,
    browserPodApiKey: "secret"
  });
  const result = session.dispose();
  assert.equal(session.closed, true);
  assert.equal(result.complete, false);
  assert.match(result.reason, /no documented pod or process termination/u);
});
