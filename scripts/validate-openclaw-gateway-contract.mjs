#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { OPENCLAW_GATEWAY_CONTRACT } from "../packages/embed-sdk/openclaw-gateway-contract.generated.mjs";

const report = JSON.parse(await readFile("apps/web/public/data/compatibility.json", "utf8"));
const contract = OPENCLAW_GATEWAY_CONTRACT;

assert.equal(contract.schemaVersion, 1);
assert.deepEqual(
  { package: contract.artifact.package, version: contract.artifact.version, integrity: contract.artifact.integrity },
  { package: report.artifact.package, version: report.artifact.version, integrity: report.artifact.integrity },
  "Gateway contract must track the exact stable report artifact"
);
assert.deepEqual(contract.protocol, { min: 4, max: 4 });
assert.equal(contract.profile.clientId, "webchat-ui");
assert.equal(contract.profile.clientMode, "webchat");
assert.deepEqual(contract.profile.scopes, ["operator.read", "operator.write"]);
assert.deepEqual(contract.rpc.methods, ["chat.send", "chat.history", "chat.abort"]);
assert.equal(contract.rpc.event, "chat");
assert.equal(contract.pairing.scope, "operator.pairing");
assert.deepEqual(contract.pairing.methods, [
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.pair.remove",
  "device.token.rotate",
  "device.token.revoke"
]);
// The legacy plugin-sdk layout pins six fixed declaration files; the
// gateway-protocol distribution pins the entry pair plus per-release hashed
// chunks, so the count is layout-dependent but never small.
assert.ok(
  Object.keys(contract.sources).length >= 5,
  "Gateway contract must pin its declaration sources"
);
for (const hash of Object.values(contract.sources)) assert.match(hash, /^sha256-[a-f0-9]{64}$/u);

process.stdout.write("Validated exact-artifact OpenClaw Gateway contract.\n");
