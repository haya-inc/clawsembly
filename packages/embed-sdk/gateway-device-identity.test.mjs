import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  buildDeviceAuthPayloadV3,
  createBrowserDeviceIdentity,
  normalizeDeviceMetadataForAuth
} from "./gateway-device-identity.mjs";

function memoryStore() {
  let record;
  return {
    async read() { return record; },
    async add(value) {
      if (record) return false;
      record = value;
      return true;
    }
  };
}

test("builds the exact OpenClaw v3 device payload", () => {
  assert.equal(normalizeDeviceMetadataForAuth(" Browser "), "browser");
  assert.equal(buildDeviceAuthPayloadV3({
    deviceId: "a".repeat(64),
    clientId: "webchat-ui",
    clientMode: "webchat",
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    signedAtMs: 1_783_795_200_000,
    token: "shared-token",
    nonce: "server-nonce",
    platform: "Browser",
    deviceFamily: "Clawsembly"
  }), `v3|${"a".repeat(64)}|webchat-ui|webchat|operator|operator.read,operator.write|1783795200000|shared-token|server-nonce|browser|clawsembly`);
});

test("persists a non-extractable Ed25519 identity and signs challenge-bound connects", async () => {
  const store = memoryStore();
  const first = createBrowserDeviceIdentity({
    crypto: webcrypto,
    store,
    now: () => 1_783_795_200_000
  });
  const descriptor = await first.descriptor();
  assert.match(descriptor.deviceId, /^[a-f0-9]{64}$/u);
  assert.equal(descriptor.privateKeyExtractable, false);
  assert.equal(descriptor.algorithm, "Ed25519");

  const signed = await first.signConnect({
    clientId: "webchat-ui",
    clientMode: "webchat",
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    token: "shared-token",
    nonce: "server-nonce",
    platform: "browser",
    deviceFamily: "clawsembly"
  });
  assert.equal(signed.id, descriptor.deviceId);
  assert.equal(signed.nonce, "server-nonce");
  assert.equal(signed.signedAt, 1_783_795_200_000);
  assert.match(signed.publicKey, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(signed.signature, /^[A-Za-z0-9_-]{86}$/u);

  const restored = createBrowserDeviceIdentity({ crypto: webcrypto, store });
  assert.equal((await restored.descriptor()).deviceId, descriptor.deviceId);
});

test("rejects stored identities whose device id does not match the public key", async () => {
  const store = memoryStore();
  const identity = createBrowserDeviceIdentity({ crypto: webcrypto, store });
  await identity.descriptor();
  const record = await store.read();
  record.deviceId = "0".repeat(64);
  await assert.rejects(
    createBrowserDeviceIdentity({ crypto: webcrypto, store }).descriptor(),
    /does not match its public key/u
  );
});
