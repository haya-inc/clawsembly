import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { CapabilityBroker } from "./capability-broker.mjs";
import { FilesystemCapabilityMailboxHost } from "./filesystem-mailbox-host.mjs";
import { FilesystemCapabilityMailboxClient, MailboxGuestError } from "./guest-mailbox-client.mjs";
import {
  MailboxProtocolError,
  createMailboxRequest,
  createMailboxResponse,
  mailboxPaths,
  parseMailboxRequest,
  parseMailboxResponse,
  serializeMailboxValue
} from "./mailbox-protocol.mjs";

function subject() {
  return {
    artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-mailbox-test" },
    runtime: "browserpod",
    sessionId: "mailbox-session"
  };
}

function nodeFilesystemRuntime() {
  return {
    provider: "browserpod",
    async createDirectory(path, options) { await mkdir(path, { recursive: options?.recursive === true }); },
    async writeTextFile(path, text) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    },
    async readTextFile(path, { maxBytes = 2 * 1024 * 1024 } = {}) {
      const text = await readFile(path, "utf8");
      if (Buffer.byteLength(text) > maxBytes) throw new Error("file too large");
      return text;
    }
  };
}

// Mailbox roots are guest POSIX paths; keep the directory repo-local and strip
// the Windows drive prefix so the same string resolves through node:fs everywhere.
async function guestTemporaryDirectory(t, prefix) {
  await mkdir(join(".artifacts", "test-tmp"), { recursive: true });
  const directory = await mkdtemp(join(".artifacts", "test-tmp", prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return resolve(directory).replaceAll("\\", "/").replace(/^[A-Za-z]:/u, "");
}

async function setup(t, { grants = [], handlers = {}, maxResponseBytes = 256 * 1024 } = {}) {
  const directory = await guestTemporaryDirectory(t, "clawsembly-mailbox-");
  const root = `${directory}/channel`;
  const broker = new CapabilityBroker({ subject: subject(), grants, handlers });
  const host = new FilesystemCapabilityMailboxHost({
    runtime: nodeFilesystemRuntime(),
    broker,
    root,
    channelId: "channel_1",
    pollIntervalMs: 5,
    maxResponseBytes
  });
  await host.initialize();
  const client = new FilesystemCapabilityMailboxClient({
    root,
    channelId: "channel_1",
    pollIntervalMs: 5
  });
  await client.connect();
  return { root, broker, host, client };
}

test("carries an exact-scope request through the filesystem without payload audit leakage", async (t) => {
  const secretPayload = "guest-payload-must-not-enter-audit";
  const { root, broker, host, client } = await setup(t, {
    grants: [{ capability: "storage.read", scope: "workspace:primary", maxCalls: 1 }],
    handlers: {
      "storage.read": async (input) => ({ accepted: input.value === secretPayload })
    }
  });

  assert.deepEqual(client.manifest?.subject, subject());
  const serving = host.processNext();
  const result = await client.request({
    id: "request-1",
    capability: "storage.read",
    scope: "workspace:primary",
    input: { value: secretPayload }
  });
  const processed = await serving;

  assert.deepEqual(result, { accepted: true });
  assert.equal(processed.response.ok, true);
  assert.equal(processed.event.outcome, "allowed");
  assert.equal(JSON.stringify(broker.auditSnapshot()).includes(secretPayload), false);
  assert.equal(JSON.stringify(host.snapshot()).includes(secretPayload), false);
  assert.deepEqual((await readdir(root)).sort(), ["manifest.json"]);
});

test("returns a generic broker denial and rejects request-id replay", async (t) => {
  const { host, client } = await setup(t, {
    grants: [{ capability: "storage.read", scope: "workspace:primary", maxCalls: 2 }],
    handlers: { "storage.read": async () => ({ ok: true }) }
  });

  let serving = host.processNext();
  await assert.rejects(
    client.request({
      id: "denied-request",
      capability: "storage.read",
      scope: "workspace:other",
      input: null
    }),
    (error) => error instanceof MailboxGuestError && error.code === "not_granted"
      && error.message === "capability is not granted for this scope"
  );
  assert.equal((await serving).event.code, "not_granted");

  serving = host.processNext();
  assert.deepEqual(await client.request({
    id: "replay-request",
    capability: "storage.read",
    scope: "workspace:primary",
    input: null
  }), { ok: true });
  await serving;

  serving = host.processNext();
  await assert.rejects(
    client.request({
      id: "replay-request",
      capability: "storage.read",
      scope: "workspace:primary",
      input: null
    }),
    (error) => error.code === "replay_rejected"
  );
  assert.equal((await serving).event.code, "replay_rejected");
});

test("propagates guest cancellation to the running capability handler", async (t) => {
  let handlerStarted;
  const started = new Promise((resolve) => { handlerStarted = resolve; });
  const { broker, host, client } = await setup(t, {
    grants: [{ capability: "provider.request", scope: "model:approved", maxCalls: 1 }],
    handlers: {
      "provider.request": async (_input, { signal }) => {
        handlerStarted();
        await new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("provider secret detail")), { once: true });
        });
        return null;
      }
    }
  });
  const controller = new AbortController();
  const serving = host.processNext();
  const requesting = client.request({
    id: "cancel-request",
    capability: "provider.request",
    scope: "model:approved",
    input: { prompt: "cancel me" }
  }, { signal: controller.signal });
  await started;
  controller.abort();

  await assert.rejects(requesting, (error) => error.code === "cancelled");
  const processed = await serving;
  assert.equal(processed.event.outcome, "cancelled");
  assert.equal(JSON.stringify(broker.auditSnapshot()).includes("provider secret detail"), false);
});

test("replaces oversized or non-serializable handler output with a bounded error", async (t) => {
  const { host, client } = await setup(t, {
    maxResponseBytes: 1024,
    grants: [{ capability: "storage.read", scope: "workspace:primary", maxCalls: 2 }],
    handlers: {
      "storage.read": async (input) => input.cyclic
        ? (() => { const value = {}; value.self = value; return value; })()
        : { value: "x".repeat(2_000) }
    }
  });

  let serving = host.processNext();
  await assert.rejects(
    client.request({
      id: "large-response",
      capability: "storage.read",
      scope: "workspace:primary",
      input: { cyclic: false }
    }),
    (error) => error.code === "response_too_large"
  );
  assert.equal((await serving).event.code, "response_too_large");

  serving = host.processNext();
  await assert.rejects(
    client.request({
      id: "cyclic-response",
      capability: "storage.read",
      scope: "workspace:primary",
      input: { cyclic: true }
    }),
    (error) => error.code === "transport_failed"
  );
  assert.equal((await serving).event.code, "transport_failed");
});

test("rejects extra protocol fields and traversal roots", () => {
  const request = createMailboxRequest({
    schemaVersion: 1,
    channelId: "channel_1",
    sequence: 1,
    id: "strict-request",
    capability: "storage.read",
    scope: "workspace:primary",
    input: null
  });
  const text = serializeMailboxValue({ ...request, ambientCredential: "forbidden" });
  assert.throws(
    () => parseMailboxRequest(text, { channelId: "channel_1", sequence: 1 }),
    (error) => error instanceof MailboxProtocolError && error.code === "invalid_envelope"
  );
  assert.throws(
    () => mailboxPaths("/workspace/../secret", 1),
    (error) => error.code === "invalid_root"
  );

  const unboundResponse = createMailboxResponse({
    channelId: "channel_1",
    sequence: 1,
    id: null,
    ok: false,
    error: { code: "invalid_request", message: "capability request is invalid" }
  });
  assert.throws(
    () => parseMailboxResponse(serializeMailboxValue(unboundResponse), {
      channelId: "channel_1",
      sequence: 1,
      id: "strict-request"
    }),
    (error) => error.code === "invalid_envelope"
  );
});
