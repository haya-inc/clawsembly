import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyEd25519WithNoble } from "./ed25519-verify-adapter.mjs";

test("noble fallback verifies Node-compatible Ed25519 SPKI signatures", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const payload = Buffer.from("clawsembly-device-identity-adapter");
  const signature = crypto.sign(null, payload, privateKey);

  assert.equal(verifyEd25519WithNoble(payload, publicKey, signature), true);
  const rawPublicKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
  assert.equal(verifyEd25519WithNoble(payload, rawPublicKey, signature), true);
  assert.equal(verifyEd25519WithNoble(payload, rawPublicKey, signature.toString("base64url")), true);
  const tampered = Buffer.from(payload);
  tampered[0] ^= 1;
  assert.equal(verifyEd25519WithNoble(tampered, publicKey, signature), false);
});
