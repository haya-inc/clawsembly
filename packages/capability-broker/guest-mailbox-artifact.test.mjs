import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { CapabilityBroker } from "./capability-broker.mjs";
import { FilesystemCapabilityMailboxHost } from "./filesystem-mailbox-host.mjs";
import { stageGuestMailboxClient } from "./guest-mailbox-artifact.mjs";

// Mailbox roots are guest POSIX paths; keep the directory repo-local and strip
// the Windows drive prefix so the same string resolves through node:fs everywhere.
async function guestTemporaryDirectory(t, prefix) {
  await mkdir(join(".artifacts", "test-tmp"), { recursive: true });
  const directory = await mkdtemp(join(".artifacts", "test-tmp", prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return resolve(directory).replaceAll("\\", "/").replace(/^[A-Za-z]:/u, "");
}

function nodeFilesystemRuntime() {
  return {
    provider: "browserpod",
    async createDirectory(path) { await mkdir(path, { recursive: true }); },
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

test("stages an exact guest client that executes a real mailbox request", async (t) => {
  const directory = await guestTemporaryDirectory(t, "clawsembly-staged-guest-");
  const runtime = nodeFilesystemRuntime();
  const mailboxRoot = `${directory}/mailbox`;
  const clientRoot = `${mailboxRoot}/guest-client-v1`;
  const subject = {
    artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-staging-test" },
    runtime: "browserpod",
    sessionId: "staged-guest-session"
  };
  const broker = new CapabilityBroker({
    subject,
    grants: [{ capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 1 }],
    handlers: { "storage.snapshot": async (input) => ({ snapshot: input.name }) }
  });
  const host = new FilesystemCapabilityMailboxHost({
    runtime,
    broker,
    root: mailboxRoot,
    channelId: "staged_channel",
    pollIntervalMs: 5
  });
  await host.initialize();

  const artifact = await stageGuestMailboxClient({ runtime, root: clientRoot });
  assert.equal(artifact.verified, true);
  assert.match(artifact.integrity, /^sha256-[a-f0-9]{64}$/u);
  assert.deepEqual(artifact.files.map((file) => file.relativePath), [
    "mailbox-protocol.mjs",
    "guest-mailbox-client.mjs"
  ]);

  const { FilesystemCapabilityMailboxClient } = await import(pathToFileURL(artifact.entrypointPath));
  const client = new FilesystemCapabilityMailboxClient({
    root: mailboxRoot,
    channelId: "staged_channel",
    pollIntervalMs: 5
  });
  await client.connect();
  const processing = host.processNext();
  const result = await client.request({
    id: "staged-request",
    capability: "storage.snapshot",
    scope: "workspace:primary",
    input: { name: "primary" }
  });
  assert.deepEqual(result, { snapshot: "primary" });
  assert.equal((await processing).event.outcome, "allowed");
});

test("rejects traversal roots before staging", async () => {
  await assert.rejects(
    stageGuestMailboxClient({ runtime: nodeFilesystemRuntime(), root: "/workspace/../shared" }),
    /artifact root is invalid/u
  );
});

test("rejects a staged client whose BrowserPod readback differs", async () => {
  const files = new Map();
  const runtime = {
    provider: "browserpod",
    async createDirectory() {},
    async writeTextFile(path, text) { files.set(path, `${text}\n// tampered`); },
    async readTextFile(path) { return files.get(path); }
  };
  await assert.rejects(
    stageGuestMailboxClient({ runtime, root: "/workspace/fresh-client" }),
    /artifact verification failed/u
  );
});
