import assert from "node:assert/strict";
import test from "node:test";
import { patchOpenClawEd25519Source } from "./openclaw-ed25519-source-patch.mjs";

test("Ed25519 source patch is narrow and idempotent", () => {
  const source = [
    'import crypto from "node:crypto";',
    "function verifyDeviceSignature(publicKey, payload, signatureBase64Url) {",
    "\ttry {",
    '\t\tconst key = crypto.createPublicKey(publicKey);',
    '\t\tconst sig = Buffer.from(signatureBase64Url, "base64url");',
    '\t\treturn crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);',
    "\t} catch {",
    "\t\treturn false;",
    "\t}",
    "}"
  ].join("\n");
  const patched = patchOpenClawEd25519Source(source);
  assert.match(patched, /verifyEd25519WithNoble/);
  assert.match(patched, /try \{ nativeValid = crypto\.verify/);
  assert.match(patched, /catch \{\}/);
  assert.match(patched, /publicKey, signatureBase64Url/);
  assert.equal(patchOpenClawEd25519Source(patched), patched);
  assert.equal(patched.split("\n").length, source.split("\n").length + 3);
});

test("Ed25519 source patch fails closed when upstream markers change", () => {
  assert.throws(() => patchOpenClawEd25519Source('import crypto from "node:crypto";'), /refusing to patch/);
});
