import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { buildReport } from "./report.mjs";

const schema = JSON.parse(readFileSync(new URL("../report.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function gatewayContract() {
  const source = { path: "dist/gateway/protocol/index.d.ts", sha256: `sha256-${"a".repeat(64)}` };
  return {
    inspection: { status: "complete", limitations: [] },
    protocol: { current: 4, minClient: 4, minProbe: 4, minNode: null },
    distribution: { legacyPluginDeclarationCount: 38 },
    inventories: {
      coreMethods: ["chat.send"], schemaExports: ["ChatEventSchema"],
      validators: ["validateChatEvent"], eventSchemas: ["ChatEventSchema"]
    },
    sources: { publicDeclaration: source, publicRuntime: source, versionModule: source, serverMethods: source }
  };
}

function staticInput(target) {
  return {
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    target,
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayContract: gatewayContract()
  };
}

test("report schema accepts version-bound BrowserPod targets", () => {
  const report = buildReport(staticInput({
    runtime: "browserpod",
    runtimeVersion: "2.12.1",
    browserBaseline: "Desktop Chromium"
  }));
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
});
