#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const reportPath = resolve(root, "apps/web/public/data/compatibility.json");
const outputPath = resolve(root, "packages/embed-sdk/openclaw-gateway-contract.generated.mjs");
const check = process.argv.includes("--check");
const sourcePaths = [
  "gateway-protocol/src/version.d.ts",
  "gateway-protocol/src/schema/frames.d.ts",
  "gateway-protocol/src/schema/primitives.d.ts",
  "gateway-client/src/device-auth.d.ts"
];

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
  limits: Object.freeze({
    preauthPayloadBytes: 64 * 1024,
    handshakeTimeoutMs: 15_000
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
  const { stdout } = await run("npm", [
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
  await run("mkdir", ["-p", extracted]);
  await run("tar", ["-xzf", tarball, "-C", extracted]);
  const sourceRoot = join(extracted, "package", "dist", "plugin-sdk", "packages");
  const contents = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [
    path,
    await readFile(join(sourceRoot, path), "utf8")
  ])));
  const protocolMatch = contents["gateway-protocol/src/version.d.ts"].match(/PROTOCOL_VERSION:\s*(\d+)/u);
  if (!protocolMatch || protocolMatch[1] !== "4") throw new Error("expected OpenClaw protocol 4");
  const primitives = contents["gateway-protocol/src/schema/primitives.d.ts"];
  const frames = contents["gateway-protocol/src/schema/frames.d.ts"];
  const deviceAuth = contents["gateway-client/src/device-auth.d.ts"];
  for (const required of ["webchat-ui", "webchat"]) {
    if (!primitives.includes(quoted(required))) throw new Error(`Gateway schema is missing ${required}`);
  }
  for (const required of ["ConnectParamsSchema", "HelloOkSchema", "nonce", "deviceToken", "maxPayload"]) {
    if (!frames.includes(required)) throw new Error(`Gateway frame contract is missing ${required}`);
  }
  if (!deviceAuth.includes("buildDeviceAuthPayloadV3")) {
    throw new Error("Gateway device auth contract has no v3 signer");
  }
  const generated = render({
    artifact: { ...artifact, shasum: packed.shasum },
    protocol: Number(protocolMatch[1]),
    sources: Object.fromEntries(sourcePaths.map((path) => [path, sha256(contents[path])]))
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
