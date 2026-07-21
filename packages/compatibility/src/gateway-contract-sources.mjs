import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { declarationExports } from "./gateway-contract-inspection.mjs";

const LEGACY_SOURCE_ROOT = "dist/plugin-sdk/packages";
const LEGACY_SOURCE_PATHS = [
  "gateway-protocol/src/version.d.ts",
  "gateway-protocol/src/schema/frames.d.ts",
  "gateway-protocol/src/schema/primitives.d.ts",
  "gateway-client/src/device-auth.d.ts",
  "gateway-protocol/src/schema/logs-chat.d.ts",
  "gateway-protocol/src/schema/devices.d.ts"
];

const MODERN_DECLARATION_ENTRY = "dist/gateway/protocol/index.d.ts";
const MODERN_RUNTIME_ENTRY = "dist/gateway/protocol/index.js";
const MODERN_CHUNK_IMPORT_PATTERN = /from\s+["']\.\.\/\.\.\/([A-Za-z0-9][A-Za-z0-9._-]*\.js)["']/gu;
const MODERN_VERSION_CHUNK_PATTERN = /^version-[A-Za-z0-9_-]+\.js$/u;
const MODERN_MESSAGE_HANDLER_PATTERN = /^message-handler-[A-Za-z0-9_-]+\.js$/u;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

// The generated protocol-4 client sends these; the artifact must still
// declare them for the contract to regenerate.
const MODERN_REQUIRED_DECLARATION_EXPORTS = [
  "ConnectParamsSchema",
  "HelloOkSchema",
  "ChatSendParamsSchema",
  "ChatHistoryParamsSchema",
  "ChatEventSchema",
  "validateChatSendParams",
  "validateChatHistoryParams",
  "validateChatAbortParams",
  "validateChatEvent",
  "DevicePairListParams",
  "DevicePairApproveParams",
  "DevicePairRejectParams",
  "validateDevicePairListParams",
  "validateDevicePairApproveParams",
  "validateDevicePairRejectParams"
];

const quoted = (value) => JSON.stringify(value);

function layoutError(message) {
  const error = new Error(message);
  error.code = "gateway_declaration_layout_unsupported";
  return error;
}

async function readText(packageRoot, path) {
  let content;
  try {
    content = await readFile(join(packageRoot, ...path.split("/")), "utf8");
  } catch (cause) {
    if (cause?.code === "ENOENT") return undefined;
    throw cause;
  }
  if (content.length > MAX_SOURCE_BYTES) {
    throw layoutError(`Gateway declaration source ${path} exceeds the source size limit`);
  }
  return content;
}

function chunkImports(source) {
  return [...new Set([...source.matchAll(MODERN_CHUNK_IMPORT_PATTERN)].map((match) => match[1]))];
}

async function resolveLegacy(packageRoot) {
  const sources = [];
  for (const path of LEGACY_SOURCE_PATHS) {
    const content = await readText(packageRoot, `${LEGACY_SOURCE_ROOT}/${path}`);
    if (content === undefined) {
      throw layoutError(`legacy plugin-sdk declaration layout is missing ${LEGACY_SOURCE_ROOT}/${path}`);
    }
    sources.push({ path, content });
  }
  const byPath = new Map(sources.map((entry) => [entry.path, entry.content]));
  const protocolMatch = byPath.get("gateway-protocol/src/version.d.ts").match(/PROTOCOL_VERSION:\s*(\d+)/u);
  if (!protocolMatch) throw new Error("Gateway version declaration has no protocol constant");
  const primitives = byPath.get("gateway-protocol/src/schema/primitives.d.ts");
  for (const required of ["webchat-ui", "webchat"]) {
    if (!primitives.includes(quoted(required))) throw new Error(`Gateway schema is missing ${required}`);
  }
  const frames = byPath.get("gateway-protocol/src/schema/frames.d.ts");
  for (const required of ["ConnectParamsSchema", "HelloOkSchema", "nonce", "deviceToken", "maxPayload"]) {
    if (!frames.includes(required)) throw new Error(`Gateway frame contract is missing ${required}`);
  }
  if (!byPath.get("gateway-client/src/device-auth.d.ts").includes("buildDeviceAuthPayloadV3")) {
    throw new Error("Gateway device auth contract has no v3 signer");
  }
  const chat = byPath.get("gateway-protocol/src/schema/logs-chat.d.ts");
  for (const required of ["ChatSendParamsSchema", "ChatHistoryParamsSchema", "ChatAbortParamsSchema", "ChatEventSchema"]) {
    if (!chat.includes(required)) throw new Error(`Gateway chat contract is missing ${required}`);
  }
  const devices = byPath.get("gateway-protocol/src/schema/devices.d.ts");
  for (const required of ["DevicePairListParamsSchema", "DevicePairApproveParamsSchema", "DevicePairRejectParamsSchema"]) {
    if (!devices.includes(required)) throw new Error(`Gateway pairing contract is missing ${required}`);
  }
  return {
    layout: "plugin-sdk-declarations",
    protocol: { current: Number(protocolMatch[1]), minClient: null },
    sources
  };
}

async function resolveModern(packageRoot, declarationEntry) {
  const declarationChunkNames = chunkImports(declarationEntry);
  if (declarationChunkNames.length === 0) {
    throw layoutError(`${MODERN_DECLARATION_ENTRY} references no hashed declaration chunks`);
  }
  const declarationChunks = [];
  for (const name of declarationChunkNames) {
    const path = `dist/${name.replace(/\.js$/u, ".d.ts")}`;
    const content = await readText(packageRoot, path);
    if (content === undefined) {
      throw layoutError(`declaration chunk ${path} referenced by ${MODERN_DECLARATION_ENTRY} is missing`);
    }
    declarationChunks.push({ path, content });
  }
  const runtimeEntry = await readText(packageRoot, MODERN_RUNTIME_ENTRY);
  if (runtimeEntry === undefined) throw layoutError(`${MODERN_RUNTIME_ENTRY} is missing`);
  const versionNames = chunkImports(runtimeEntry).filter((name) => MODERN_VERSION_CHUNK_PATTERN.test(name));
  if (versionNames.length !== 1) {
    throw layoutError(
      `expected exactly one version chunk import in ${MODERN_RUNTIME_ENTRY}, saw ${versionNames.length}`
    );
  }
  const versionPath = `dist/${versionNames[0]}`;
  const versionSource = await readText(packageRoot, versionPath);
  if (versionSource === undefined) throw layoutError(`version chunk ${versionPath} is missing`);

  const distEntries = await readdir(join(packageRoot, "dist"));
  const authHandlers = [];
  for (const name of distEntries.filter((entry) => MODERN_MESSAGE_HANDLER_PATTERN.test(entry)).sort()) {
    const content = await readText(packageRoot, `dist/${name}`);
    if (content !== undefined && content.includes("DeviceAuthPayloadV3")) {
      authHandlers.push({ path: `dist/${name}`, content });
    }
  }
  if (authHandlers.length !== 1) {
    throw new Error(
      `expected exactly one Gateway message-handler chunk declaring DeviceAuthPayloadV3, saw ${authHandlers.length}`
    );
  }

  const exportNames = declarationExports(declarationEntry);
  for (const required of MODERN_REQUIRED_DECLARATION_EXPORTS) {
    if (!exportNames.includes(required)) {
      throw new Error(`Gateway public declaration surface is missing ${required}`);
    }
  }
  const chunkText = declarationChunks.map((chunk) => chunk.content).join("\n");
  for (const required of ["webchat-ui", "webchat"]) {
    if (!chunkText.includes(quoted(required))) throw new Error(`Gateway schema is missing ${required}`);
  }
  for (const required of ["nonce", "deviceToken", "maxPayload"]) {
    if (!chunkText.includes(required)) throw new Error(`Gateway frame contract is missing ${required}`);
  }
  const current = versionSource.match(/\bconst\s+PROTOCOL_VERSION\s*=\s*(\d+)\s*;/u);
  if (!current) throw new Error("Gateway version chunk has no protocol constant");
  const minClient = versionSource.match(/\bconst\s+MIN_CLIENT_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/u);
  return {
    layout: "gateway-protocol-distribution",
    protocol: { current: Number(current[1]), minClient: minClient ? Number(minClient[1]) : null },
    sources: [
      { path: MODERN_DECLARATION_ENTRY, content: declarationEntry },
      ...declarationChunks,
      { path: MODERN_RUNTIME_ENTRY, content: runtimeEntry },
      { path: versionPath, content: versionSource },
      ...authHandlers
    ]
  };
}

// Resolves the exact declaration sources backing the generated Gateway
// contract from an extracted OpenClaw package root. Supports the legacy
// plugin-sdk declaration tree (<= 2026.6.x) and the gateway-protocol
// distribution (>= 2026.7.x); an unrecognized layout fails closed with a
// classified error instead of a raw filesystem crash.
export async function resolveOpenClawGatewayContractSources(packageRoot) {
  if (typeof packageRoot !== "string" || packageRoot.length === 0) {
    throw new TypeError("An extracted OpenClaw package root is required.");
  }
  const legacyProbe = await readText(packageRoot, `${LEGACY_SOURCE_ROOT}/${LEGACY_SOURCE_PATHS[0]}`);
  if (legacyProbe !== undefined) return resolveLegacy(packageRoot);
  const modernProbe = await readText(packageRoot, MODERN_DECLARATION_ENTRY);
  if (modernProbe !== undefined) return resolveModern(packageRoot, modernProbe);
  throw layoutError(
    `unrecognized OpenClaw Gateway declaration layout: neither ${LEGACY_SOURCE_ROOT}/ nor ${MODERN_DECLARATION_ENTRY} exists in the artifact`
  );
}
