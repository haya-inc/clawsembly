import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { classifyGatewayContract, inspectGatewayContract } from "./gateway-contract-inspection.mjs";

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

const catalogPath = "dist/core-method-policy-test.mjs";
const catalogSource = "const CORE_GATEWAY_METHOD_SPECS=[[`health`,`health`,`operator.read`]," +
  "[`chat.send`,`chat-send`,`operator.write`,{events:[`ignore.me`,`]`]}]," +
  "[`chat.history`,`chat`,SESSION_READ]];const OTHER=[[`also.ignore`]];";
const modularRuntime = 'import{a as PROTOCOL_VERSION}from"../../version-test.mjs";' +
  'import{s as ChatEventSchema,v as validateChatSendParams,i as InternalSchema}from"../../chat-test.mjs";' +
  "export{ChatEventSchema,PROTOCOL_VERSION,validateChatSendParams};";

test("inspects the actual runtime exports and core method catalog of a declaration-free bundle", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gateway-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entries = {
    "dist/gateway/protocol/index.js": modularRuntime,
    "dist/version-test.mjs": versionSource,
    "dist/server-methods-first.mjs": "export{};",
    "dist/server-methods-second.mjs": "export{};",
    [catalogPath]: catalogSource
  };
  for (const [path, content] of Object.entries(entries)) {
    const target = join(root, "package", path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  execFileSync("tar", ["-czf", "release.tgz", "package"], { cwd: root });
  const pack = { files: Object.entries(entries).map(([path, content]) => ({ path, size: Buffer.byteLength(content) })) };
  const tarball = join(root, "release.tgz");
  const result = inspectGatewayContract({ tarball, pack });
  assert.deepEqual(result.inspection, { status: "complete", limitations: [] });
  assert.equal(result.sources.publicDeclaration, null);
  assert.equal(result.sources.versionModule.path, "dist/version-test.mjs");
  assert.equal(result.sources.serverMethods.path, catalogPath);
  assert.deepEqual(result.protocol, { current: 4, minClient: 4, minProbe: 3, minNode: 3 });
  assert.deepEqual(result.inventories, {
    coreMethods: ["chat.history", "chat.send", "health"],
    schemaExports: ["ChatEventSchema"], validators: ["validateChatSendParams"], eventSchemas: ["ChatEventSchema"]
  });

  const ambiguous = inspectGatewayContract({
    tarball, pack: { files: [...pack.files, { path: "dist/core-method-policy-other.mjs", size: 1 }] }
  });
  assert.equal(ambiguous.inspection.status, "incomplete");
  assert.ok(ambiguous.inspection.limitations.includes("server-methods-source-ambiguous"));
  assert.equal(ambiguous.sources.serverMethods, null);
});

test("rejects the whole catalog if a new tuple format cannot be inspected", () => {
  for (const table of ["[['health','health'], ...additional]", "[['health','health'], [computed(),'chat']]"]) {
    const result = classifyGatewayContract({
      runtimeSource: modularRuntime, versionSource, versionModulePath: "dist/version-test.mjs",
      serverMethodsPath: catalogPath, serverMethodsSource: `const CORE_GATEWAY_METHOD_SPECS=${table};`
    });
    assert.equal(result.inspection.status, "incomplete");
    assert.ok(result.inspection.limitations.includes("core-methods-empty"));
    assert.deepEqual(result.inventories.coreMethods, []);
  }
});

test("reports uninspected wildcard re-exports in a runtime-only entry", () => {
  const result = classifyGatewayContract({
    runtimeSource: modularRuntime + 'export*from"./extra.js";',
    versionSource, versionModulePath: "dist/version-test.mjs",
    serverMethodsSource: catalogSource, serverMethodsPath: catalogPath
  });
  assert.deepEqual(result.inspection, { status: "incomplete", limitations: ["public-runtime-star-reexport"] });
});
