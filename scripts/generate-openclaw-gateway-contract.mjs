#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const npmCli = process.env.npm_execpath;

// Windows cannot spawn npm's .cmd shim directly, so prefer the invoking npm's JS entry point.
function runNpm(args, options = {}) {
  if (npmCli && /\.[cm]?js$/u.test(npmCli)) return run(process.execPath, [npmCli, ...args], options);
  return run("npm", args, { ...options, shell: process.platform === "win32" });
}
const reportPath = resolve(root, "apps/web/public/data/compatibility.json");
const outputPath = resolve(root, "packages/embed-sdk/openclaw-gateway-contract.generated.mjs");
const check = process.argv.includes("--check");
const legacySourcePaths = [
  "gateway-protocol/src/version.d.ts",
  "gateway-protocol/src/schema/frames.d.ts",
  "gateway-protocol/src/schema/primitives.d.ts",
  "gateway-client/src/device-auth.d.ts",
  "gateway-protocol/src/schema/logs-chat.d.ts",
  "gateway-protocol/src/schema/devices.d.ts"
];

async function readSources(packageRoot, version) {
  const versionMatch = version.match(/^2026\.(\d+)\./u);
  const minor = Number(versionMatch?.[1]);
  if (!versionMatch || minor > 7) {
    throw new Error(`unsupported OpenClaw Gateway declaration layout for ${version}`);
  }
  const legacyRoot = join(packageRoot, "dist", "plugin-sdk", "packages");
  if (minor <= 6) {
    try {
      const contents = Object.fromEntries(await Promise.all(legacySourcePaths.map(async (path) => [
        path,
        await readFile(join(legacyRoot, path), "utf8")
      ])));
      return { layout: "legacy", contents };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`incomplete legacy OpenClaw Gateway declaration layout for ${version}`);
      }
      throw error;
    }
  }

  const distRoot = join(packageRoot, "dist");
  const indexPath = "gateway/protocol/index.d.ts";
  let index;
  try {
    index = await readFile(join(distRoot, indexPath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`incomplete aggregate OpenClaw Gateway declaration layout for ${version}: missing ${indexPath}`);
    }
    throw error;
  }
  const contents = { [indexPath]: index };
  const specifiers = [...index.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  for (const specifier of new Set(specifiers)) {
    if (!specifier.startsWith(".")) continue;
    const declarationSpecifier = specifier.replace(/\.js$/u, ".d.ts");
    const absolute = normalize(resolve(dirname(join(distRoot, indexPath)), declarationSpecifier));
    const path = relative(distRoot, absolute);
    if (path.startsWith("..") || !path.endsWith(".d.ts")) {
      throw new Error(`unsupported OpenClaw Gateway declaration import: ${specifier}`);
    }
    try {
      contents[path] = await readFile(absolute, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`incomplete OpenClaw Gateway declaration layout: missing ${path}`);
      }
      throw error;
    }
  }
  if (Object.keys(contents).length === 1) {
    throw new Error("unsupported OpenClaw Gateway declaration layout: protocol index has no declaration imports");
  }
  const devicePairApiPath = "extensions/device-pair/api.d.ts";
  try {
    contents[devicePairApiPath] = await readFile(join(distRoot, devicePairApiPath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`incomplete OpenClaw Gateway declaration layout: missing ${devicePairApiPath}`);
    }
    throw error;
  }
  return { layout: "aggregate", contents };
}

const sha256 = (value) => `sha256-${createHash("sha256").update(value).digest("hex")}`;

function quoted(value) {
  return JSON.stringify(value);
}

function render({ artifact, protocol, sources }) {
  const sourceLines = Object.entries(sources)
    .map(([path, hash], index, entries) => `    ${quoted(path)}: ${quoted(hash)}${index === entries.length - 1 ? "" : ","}`)
    .join("\n");
  return `// Generated from the exact openclaw@${artifact.version} npm artifact. Do not edit by hand.
// Regenerate with: npm run protocol:generate

export const OPENCLAW_GATEWAY_CONTRACT = Object.freeze({
  schemaVersion: 1,
  artifact: Object.freeze({
    package: "openclaw",
    version: ${quoted(artifact.version)},
    integrity: ${quoted(artifact.integrity)},
    shasum: ${quoted(artifact.shasum)}
  }),
  protocol: Object.freeze({ min: ${protocol}, max: ${protocol} }),
  profile: Object.freeze({
    clientId: "webchat-ui",
    clientMode: "webchat",
    clientVersion: "clawsembly-embed-v1",
    platform: "browser",
    deviceFamily: "clawsembly",
    role: "operator",
    scopes: Object.freeze(["operator.read", "operator.write"]),
    caps: Object.freeze([])
  }),
  rpc: Object.freeze({
    methods: Object.freeze(["chat.send", "chat.history", "chat.abort"]),
    event: "chat"
  }),
  limits: Object.freeze({
    preauthPayloadBytes: 64 * 1024,
    authenticatedPayloadBytes: 4 * 1024 * 1024,
    handshakeTimeoutMs: 15_000,
    requestTimeoutMs: 30_000,
    maxPendingRequests: 64
  }),
  sources: Object.freeze({
${sourceLines}
  })
});
`;
}

const temporary = await mkdtemp(join(tmpdir(), "clawsembly-openclaw-contract-"));
try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const artifact = report.artifact;
  if (artifact?.package !== "openclaw" || typeof artifact.version !== "string"
    || typeof artifact.integrity !== "string") {
    throw new Error("compatibility report does not contain an exact OpenClaw artifact");
  }
  const { stdout } = await runNpm([
    "pack",
    `${artifact.package}@${artifact.version}`,
    "--pack-destination",
    temporary,
    "--json"
  ], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const packed = JSON.parse(stdout)?.[0];
  if (!packed || packed.integrity !== artifact.integrity || typeof packed.shasum !== "string") {
    throw new Error("npm tarball identity does not match the compatibility report");
  }
  const tarball = join(temporary, packed.filename);
  const extracted = join(temporary, "extracted");
  await mkdir(extracted, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", extracted]);
  const { layout, contents } = await readSources(join(extracted, "package"), artifact.version);
  const declarations = Object.values(contents).join("\n");
  const protocolVersions = [...declarations.matchAll(
    /PROTOCOL_VERSION(?::\s*\d+)?\s*=\s*(\d+)|PROTOCOL_VERSION:\s*(\d+)/gu
  )].map((match) => match[1] ?? match[2]);
  if (!protocolVersions.includes("4")) throw new Error("expected OpenClaw protocol 4");
  if (layout === "aggregate") {
    for (const required of [
      "webchat-ui", "webchat", "ConnectParamsSchema", "HelloOkSchema", "nonce", "deviceToken", "maxPayload",
      "approveDevicePairing", "ChatSendParamsSchema", "ChatHistoryParamsSchema", "validateChatAbortParams", "ChatEventSchema",
      "validateDevicePairListParams", "validateDevicePairApproveParams", "validateDevicePairRejectParams"
    ]) {
      if (!declarations.includes(required)) throw new Error(`Gateway aggregate contract is missing ${required}`);
    }
  } else {
    const primitives = contents["gateway-protocol/src/schema/primitives.d.ts"];
    const frames = contents["gateway-protocol/src/schema/frames.d.ts"];
    const deviceAuth = contents["gateway-client/src/device-auth.d.ts"];
    const chat = contents["gateway-protocol/src/schema/logs-chat.d.ts"];
    const devices = contents["gateway-protocol/src/schema/devices.d.ts"];
    for (const required of ["webchat-ui", "webchat"]) {
      if (!primitives.includes(quoted(required))) throw new Error(`Gateway schema is missing ${required}`);
    }
    for (const required of ["ConnectParamsSchema", "HelloOkSchema", "nonce", "deviceToken", "maxPayload"]) {
      if (!frames.includes(required)) throw new Error(`Gateway frame contract is missing ${required}`);
    }
    if (!deviceAuth.includes("buildDeviceAuthPayloadV3")) {
      throw new Error("Gateway device auth contract has no v3 signer");
    }
    for (const required of ["ChatSendParamsSchema", "ChatHistoryParamsSchema", "ChatAbortParamsSchema", "ChatEventSchema"]) {
      if (!chat.includes(required)) throw new Error(`Gateway chat contract is missing ${required}`);
    }
    for (const required of ["DevicePairListParamsSchema", "DevicePairApproveParamsSchema", "DevicePairRejectParamsSchema"]) {
      if (!devices.includes(required)) throw new Error(`Gateway pairing contract is missing ${required}`);
    }
  }
  const generated = render({
    artifact: { ...artifact, shasum: packed.shasum },
    protocol: 4,
    sources: Object.fromEntries(Object.entries(contents).map(([path, content]) => [path, sha256(content)]))
  });
  if (check) {
    if (await readFile(outputPath, "utf8") !== generated) {
      throw new Error("generated Gateway contract is stale");
    }
    process.stdout.write(`Verified generated Gateway contract for openclaw@${artifact.version}.\n`);
  } else {
    await writeFile(outputPath, generated, "utf8");
    process.stdout.write(`Generated Gateway contract for openclaw@${artifact.version}.\n`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
