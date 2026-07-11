import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { patchInstalledOpenClaw, patchOpenClawEd25519Source } from "./openclaw-ed25519-source-patch.mjs";

const upstreamVerifierSource = [
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

test("Ed25519 source patch is narrow and idempotent", () => {
  const patched = patchOpenClawEd25519Source(upstreamVerifierSource);
  assert.match(patched, /verifyEd25519WithNoble/);
  assert.match(patched, /try \{ nativeValid = crypto\.verify/);
  assert.match(patched, /catch \{\}/);
  assert.match(patched, /publicKey, signatureBase64Url/);
  assert.equal(patchOpenClawEd25519Source(patched), patched);
  assert.equal(patched.split("\n").length, upstreamVerifierSource.split("\n").length + 3);
});

test("Ed25519 source patch fails closed when upstream markers change", () => {
  assert.throws(() => patchOpenClawEd25519Source('import crypto from "node:crypto";'), /refusing to patch/);
});

test("Ed25519 install patch covers every matching verifier module", () => {
  const root = mkdtempSync(join(tmpdir(), "clawsembly-ed25519-patch-"));
  const dist = join(root, "node_modules", "openclaw", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "device-identity-abc.js"), upstreamVerifierSource);
  writeFileSync(join(dist, "device-identity-def.js"), upstreamVerifierSource);
  writeFileSync(join(dist, "device-identity-unrelated.js"), "export const other = true;");

  const result = patchInstalledOpenClaw(root);
  assert.equal(result.changed, true);
  assert.deepEqual(result.targets.toSorted(), [
    join("node_modules", "openclaw", "dist", "device-identity-abc.js"),
    join("node_modules", "openclaw", "dist", "device-identity-def.js")
  ]);
  for (const target of result.targets) {
    assert.match(readFileSync(join(root, target), "utf8"), /verifyEd25519WithNoble/);
  }

  const rerun = patchInstalledOpenClaw(root);
  assert.equal(rerun.changed, false);
  assert.deepEqual(rerun.targets.toSorted(), result.targets.toSorted());
});

test("Ed25519 install patch fails closed when no verifier module matches", () => {
  const root = mkdtempSync(join(tmpdir(), "clawsembly-ed25519-missing-"));
  const dist = join(root, "node_modules", "openclaw", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "device-identity-abc.js"), "export const other = true;");
  assert.throws(() => patchInstalledOpenClaw(root), /verifier module was not found/);
});
