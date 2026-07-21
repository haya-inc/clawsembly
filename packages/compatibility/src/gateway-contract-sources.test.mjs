import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { resolveOpenClawGatewayContractSources } from "./gateway-contract-sources.mjs";

async function packageRootWith(files) {
  const root = await mkdtemp(join(tmpdir(), "clawsembly-contract-sources-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

const legacyFiles = {
  "dist/plugin-sdk/packages/gateway-protocol/src/version.d.ts":
    "export declare const PROTOCOL_VERSION: 4;\n",
  "dist/plugin-sdk/packages/gateway-protocol/src/schema/frames.d.ts":
    "export declare const ConnectParamsSchema: unknown;\nexport declare const HelloOkSchema: unknown;\n// nonce deviceToken maxPayload\n",
  "dist/plugin-sdk/packages/gateway-protocol/src/schema/primitives.d.ts":
    'export type ClientId = "webchat-ui";\nexport type ClientMode = "webchat";\n',
  "dist/plugin-sdk/packages/gateway-client/src/device-auth.d.ts":
    "export declare function buildDeviceAuthPayloadV3(input: unknown): string;\n",
  "dist/plugin-sdk/packages/gateway-protocol/src/schema/logs-chat.d.ts":
    "export declare const ChatSendParamsSchema: unknown;\nexport declare const ChatHistoryParamsSchema: unknown;\nexport declare const ChatAbortParamsSchema: unknown;\nexport declare const ChatEventSchema: unknown;\n",
  "dist/plugin-sdk/packages/gateway-protocol/src/schema/devices.d.ts":
    "export declare const DevicePairListParamsSchema: unknown;\nexport declare const DevicePairApproveParamsSchema: unknown;\nexport declare const DevicePairRejectParamsSchema: unknown;\n"
};

const modernIndexDts = [
  'import { a, b, c, d, e, f, g, h, i, j, k, l, m, n, o } from "../../schema-abc123.js";',
  "export { a as ConnectParamsSchema, b as HelloOkSchema, c as ChatSendParamsSchema,",
  "  d as ChatHistoryParamsSchema, e as ChatEventSchema, f as validateChatSendParams,",
  "  g as validateChatHistoryParams, h as validateChatAbortParams, i as validateChatEvent,",
  "  j as DevicePairListParams, k as DevicePairApproveParams, l as DevicePairRejectParams,",
  "  m as validateDevicePairListParams, n as validateDevicePairApproveParams,",
  "  o as validateDevicePairRejectParams };",
  ""
].join("\n");

const modernFiles = {
  "dist/gateway/protocol/index.d.ts": modernIndexDts,
  "dist/schema-abc123.d.ts":
    'declare const clientId = "webchat-ui";\ndeclare const clientMode = "webchat";\n// nonce deviceToken maxPayload\n',
  "dist/gateway/protocol/index.js":
    'import { i } from "../../version-def456.js";\nexport { i as PROTOCOL_VERSION };\n',
  "dist/version-def456.js":
    "const PROTOCOL_VERSION = 4;\nconst MIN_CLIENT_PROTOCOL_VERSION = 4;\nexport { PROTOCOL_VERSION };\n",
  "dist/message-handler-aaa.js":
    "const marker = \"DeviceAuthPayloadV3\";\nexport { marker };\n",
  "dist/message-handler-bbb.js":
    "export const unrelated = true;\n"
};

test("resolves the legacy plugin-sdk declaration layout with its six pinned sources", async () => {
  const root = await packageRootWith(legacyFiles);
  try {
    const resolved = await resolveOpenClawGatewayContractSources(root);
    assert.equal(resolved.layout, "plugin-sdk-declarations");
    assert.deepEqual(resolved.protocol, { current: 4, minClient: null });
    assert.deepEqual(
      resolved.sources.map((source) => source.path),
      [
        "gateway-protocol/src/version.d.ts",
        "gateway-protocol/src/schema/frames.d.ts",
        "gateway-protocol/src/schema/primitives.d.ts",
        "gateway-client/src/device-auth.d.ts",
        "gateway-protocol/src/schema/logs-chat.d.ts",
        "gateway-protocol/src/schema/devices.d.ts"
      ]
    );
    assert.equal(
      resolved.sources[0].content,
      legacyFiles["dist/plugin-sdk/packages/gateway-protocol/src/version.d.ts"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves the gateway-protocol distribution through its name-stable entries", async () => {
  const root = await packageRootWith(modernFiles);
  try {
    const resolved = await resolveOpenClawGatewayContractSources(root);
    assert.equal(resolved.layout, "gateway-protocol-distribution");
    assert.deepEqual(resolved.protocol, { current: 4, minClient: 4 });
    assert.deepEqual(
      resolved.sources.map((source) => source.path),
      [
        "dist/gateway/protocol/index.d.ts",
        "dist/schema-abc123.d.ts",
        "dist/gateway/protocol/index.js",
        "dist/version-def456.js",
        "dist/message-handler-aaa.js"
      ]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unrecognized declaration layout fails closed with a classified error", async () => {
  const root = await packageRootWith({ "dist/unrelated.js": "export const nothing = true;\n" });
  try {
    await assert.rejects(
      resolveOpenClawGatewayContractSources(root),
      (error) => error.code === "gateway_declaration_layout_unsupported"
        && /unrecognized OpenClaw Gateway declaration layout/u.test(error.message)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing required public export names the exact symbol", async () => {
  const files = {
    ...modernFiles,
    "dist/gateway/protocol/index.d.ts": modernIndexDts.replace("h as validateChatAbortParams,", "")
  };
  const root = await packageRootWith(files);
  try {
    await assert.rejects(
      resolveOpenClawGatewayContractSources(root),
      /Gateway public declaration surface is missing validateChatAbortParams/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an ambiguous device-auth message-handler chunk fails closed", async () => {
  const files = {
    ...modernFiles,
    "dist/message-handler-bbb.js": "const marker = \"DeviceAuthPayloadV3\";\nexport { marker };\n"
  };
  const root = await packageRootWith(files);
  try {
    await assert.rejects(
      resolveOpenClawGatewayContractSources(root),
      /expected exactly one Gateway message-handler chunk declaring DeviceAuthPayloadV3, saw 2/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a non-4 protocol constant is reported, not asserted, by source resolution", async () => {
  const files = {
    ...modernFiles,
    "dist/version-def456.js":
      "const PROTOCOL_VERSION = 5;\nconst MIN_CLIENT_PROTOCOL_VERSION = 5;\nexport { PROTOCOL_VERSION };\n"
  };
  const root = await packageRootWith(files);
  try {
    const resolved = await resolveOpenClawGatewayContractSources(root);
    assert.deepEqual(resolved.protocol, { current: 5, minClient: 5 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
