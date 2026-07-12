import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";
import { createGatewayDeviceTokenVault } from "./gateway-device-token-vault.mjs";

const SUBJECT = Object.freeze({ deviceId: "a".repeat(64), role: "operator" });

function memoryPersistence() {
  let key;
  const tokens = new Map();
  return {
    tokens,
    async readKey() { return key; },
    async addKey(value) {
      if (key) {
        const error = new Error("key exists");
        error.name = "ConstraintError";
        throw error;
      }
      key = value;
    },
    async readToken(id) { return tokens.get(id); },
    async writeToken(id, record) { tokens.set(id, structuredClone(record)); },
    async deleteToken(id) { tokens.delete(id); }
  };
}

test("encrypts exact-artifact device tokens and exposes metadata without plaintext", async () => {
  const persistence = memoryPersistence();
  let now = Date.parse("2026-07-12T00:00:00.000Z");
  const vault = createGatewayDeviceTokenVault({
    crypto: webcrypto,
    persistence,
    now: () => now
  });
  const secret = "issued-device-token-private";
  const metadata = await vault.store({
    ...SUBJECT,
    token: secret,
    scopes: ["operator.read", "operator.write"],
    issuedAtMs: now
  });
  assert.equal(metadata.algorithm, "AES-GCM-256");
  assert.equal(metadata.keyExtractable, false);
  assert.equal(JSON.stringify(metadata).includes(secret), false);
  assert.equal(JSON.stringify([...persistence.tokens.values()]).includes(secret), false);
  assert.deepEqual(await vault.load(SUBJECT), {
    token: secret,
    scopes: ["operator.read", "operator.write"],
    issuedAtMs: now
  });

  now += 1_000;
  const updated = await vault.store({
    ...SUBJECT,
    token: "rotated-device-token-private",
    scopes: ["operator.read", "operator.write"],
    issuedAtMs: now
  });
  assert.equal(updated.createdAt, metadata.createdAt);
  assert.notEqual(updated.updatedAt, metadata.updatedAt);
  assert.equal(await vault.clear(SUBJECT), true);
  assert.equal(await vault.load(SUBJECT), undefined);
  assert.equal(await vault.clear(SUBJECT), false);
});

test("binds ciphertext to artifact, identity, role, and scopes", async () => {
  const persistence = memoryPersistence();
  const vault = createGatewayDeviceTokenVault({ crypto: webcrypto, persistence });
  await vault.store({
    ...SUBJECT,
    token: "issued-device-token-private",
    scopes: ["operator.read", "operator.write"]
  });
  const [id, record] = [...persistence.tokens.entries()][0];
  record.scopes = ["operator.read"];
  persistence.tokens.set(id, record);
  await assert.rejects(vault.load(SUBJECT), /authenticated decryption/u);

  assert.throws(() => createGatewayDeviceTokenVault({
    artifact: { ...OPENCLAW_GATEWAY_CONTRACT.artifact, version: "other" },
    crypto: webcrypto,
    persistence
  }), /does not match/u);
});

test("rejects malformed token subjects, values, and persistence records", async () => {
  const persistence = memoryPersistence();
  const vault = createGatewayDeviceTokenVault({ crypto: webcrypto, persistence });
  await assert.rejects(vault.load({ deviceId: "short", role: "operator" }), /subject is invalid/u);
  await assert.rejects(vault.store({
    ...SUBJECT,
    token: "line\nbreak",
    scopes: ["operator.read"]
  }), /token is invalid/u);
  await assert.rejects(vault.store({
    ...SUBJECT,
    token: "valid-token",
    scopes: ["operator.read", "operator.read"]
  }), /duplicates/u);
});
