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

const wireSchemas = ["ConnectParamsSchema", "HelloOkSchema", "ChatSendParamsSchema", "ChatHistoryParamsSchema", "ChatEventSchema"];
const wireRequests = ["ChatSend", "ChatHistory", "ChatAbort", "DevicePairList", "DevicePairApprove", "DevicePairReject",
  "DevicePairRemove", "DeviceTokenRotate", "DeviceTokenRevoke"];
const validators = wireRequests.map((name) => `validate${name}Params`);
const versions = ["PROTOCOL_VERSION", "MIN_CLIENT_PROTOCOL_VERSION"];
const runtimeFramePath = "dist/schemas-new.mjs";
const runtimeFiles = {
  "dist/gateway/protocol/index.js": [
    `import{${wireSchemas.join(",")}}from"../../schemas-new.mjs";`,
    `import{${validators.join(",")}}from"../../validators-new.mjs";`,
    `import{i as PROTOCOL_VERSION,t as MIN_CLIENT_PROTOCOL_VERSION}from"../../version-new.mjs";`,
    `export{${[...wireSchemas, ...validators, ...versions].join(",")}};`
  ].join(""),
  [runtimeFramePath]: [
    'import{n as GatewayClientIdSchema,r as GatewayClientModeSchema}from"./primitives-new.mjs";',
    "const ConnectParamsSchema=closedObject({nonce:NonEmptyString,deviceToken:Type.Optional(Type.String())});",
    "const HelloOkSchema=closedObject({maxPayload:Type.Integer()});",
    ...wireSchemas.slice(2).map((name) => `const ${name}=closedObject({});`)
  ].join(""),
  "dist/validators-new.mjs": wireRequests.map((name) =>
    `const validate${name}Params=/* @__PURE__ */ createProtocolValidator(${name}ParamsSchema,is${name}Params);`).join(""),
  "dist/primitives-new.mjs": 'import{n as GATEWAY_CLIENT_IDS,r as GATEWAY_CLIENT_MODES}from"./client-info-new.mjs";'
    + "const GatewayClientIdSchema=Type.Enum(GATEWAY_CLIENT_IDS);const GatewayClientModeSchema=Type.Enum(GATEWAY_CLIENT_MODES);",
  "dist/client-info-new.mjs": 'const GATEWAY_CLIENT_IDS={WEBCHAT_UI:`webchat-ui`};const GATEWAY_CLIENT_MODES={WEBCHAT:`webchat`};',
  "dist/version-new.mjs": "const PROTOCOL_VERSION=4;const MIN_CLIENT_PROTOCOL_VERSION=4;",
  "dist/device-auth-new.mjs": "function buildDeviceAuthPayloadV3(e){const t=e.scopes.join(`,`);const n=e.token??``;"
    + "const r=normalizeDeviceMetadataForAuth(e.platform);const i=normalizeDeviceMetadataForAuth(e.deviceFamily);"
    + "return[`v3`,e.deviceId,e.clientId,e.clientMode,e.role,t,String(e.signedAtMs),n,e.nonce,r,i].join(`|`)}export{buildDeviceAuthPayloadV3 as n};"
};

test("pins the runtime wire schema, validators, identity, protocol bounds and v3 signing sources", async (t) => {
  const root = await packageRootWith(runtimeFiles);
  t.after(() => rm(root, { recursive: true, force: true }));
  const resolved = await resolveOpenClawGatewayContractSources(root);
  assert.equal(resolved.layout, "gateway-protocol-runtime");
  assert.deepEqual(resolved.protocol, { current: 4, minClient: 4 });
  assert.deepEqual(new Set(resolved.sources.map(({ path }) => path)), new Set(Object.keys(runtimeFiles)));
});

test("runtime contract generation fails on handshake, validator, signer or path changes", async (t) => {
  for (const [path, replacement, error] of [
    [runtimeFramePath, runtimeFiles[runtimeFramePath].replace("nonce:", "other:")
      + "const UnrelatedSchema=closedObject({nonce:NonEmptyString});", /handshake schema/u],
    ["dist/validators-new.mjs", runtimeFiles["dist/validators-new.mjs"].replace("ChatAbortParamsSchema,", "OtherSchema,"), /no longer binds ChatAbort/u],
    ["dist/device-auth-new.mjs", runtimeFiles["dist/device-auth-new.mjs"].replace("e.nonce,r,i", "e.nonce,i,r"), /signature payload changed/u],
    ["dist/gateway/protocol/index.js", runtimeFiles["dist/gateway/protocol/index.js"].replace("../../schemas-new.mjs", "../../../schemas-new.mjs"), /local runtime import for ConnectParamsSchema/u]
  ]) {
    await t.test(error.source, async (subtest) => {
      const root = await packageRootWith({ ...runtimeFiles, [path]: replacement });
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await assert.rejects(resolveOpenClawGatewayContractSources(root), error);
    });
  }
});
