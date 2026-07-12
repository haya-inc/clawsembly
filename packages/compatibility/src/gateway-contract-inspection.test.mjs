import assert from "node:assert/strict";
import test from "node:test";

import { classifyGatewayContract } from "./gateway-contract-inspection.mjs";

const declarationSource = `
  export declare const ChatEventSchema: unknown;
  export declare const ChatSendParamsSchema: unknown;
  export declare function validateChatEvent(value: unknown): boolean;
  export { ChatEventSchema, ChatSendParamsSchema, validateChatEvent };
`;
const runtimeSource = 'export { PROTOCOL_VERSION } from "../../version-test.js";';
const versionSource = `
  const PROTOCOL_VERSION = 4;
  const MIN_CLIENT_PROTOCOL_VERSION = 4;
  const MIN_NODE_PROTOCOL_VERSION = 3;
  const MIN_PROBE_PROTOCOL_VERSION = 3;
`;
const serverMethodsSource = `
  const handlers = {
    ...createLazyCoreHandlers({ methods: ["chat.send", "chat.history"], loadHandlers }),
    ...createLazyCoreHandlers({ methods: ["chat.abort"], loadHandlers })
  };
`;

test("extracts a deterministic Gateway contract inventory without executing it", () => {
  const contract = classifyGatewayContract({
    declarationSource,
    runtimeSource,
    versionSource,
    serverMethodsSource,
    serverMethodsPath: "dist/server-methods-test.js",
    versionModulePath: "dist/version-test.js",
    legacyPluginDeclarationCount: 38
  });
  assert.equal(contract.inspection.status, "complete");
  assert.deepEqual(contract.protocol, { current: 4, minClient: 4, minProbe: 3, minNode: 3 });
  assert.deepEqual(contract.inventories.coreMethods, ["chat.abort", "chat.history", "chat.send"]);
  assert.deepEqual(contract.inventories.schemaExports, ["ChatEventSchema", "ChatSendParamsSchema"]);
  assert.deepEqual(contract.inventories.validators, ["validateChatEvent"]);
  assert.deepEqual(contract.inventories.eventSchemas, ["ChatEventSchema"]);
  assert.equal(contract.distribution.legacyPluginDeclarationCount, 38);
  for (const source of Object.values(contract.sources)) assert.match(source.sha256, /^sha256-[a-f0-9]{64}$/u);
});

test("reports an incomplete inspection instead of inventing an empty compatible contract", () => {
  const contract = classifyGatewayContract();
  assert.equal(contract.inspection.status, "incomplete");
  assert.ok(contract.inspection.limitations.includes("public-declaration-missing"));
  assert.ok(contract.inspection.limitations.includes("protocol-constants-incomplete"));
});
