#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { resolveOpenClawGatewayContractSources } from "../packages/compatibility/src/gateway-contract-sources.mjs";

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

const sha256 = (value) => `sha256-${createHash("sha256").update(value).digest("hex")}`;

function quoted(value) {
  return JSON.stringify(value);
}

function render({ artifact, protocol, sources }) {
  const sourceLines = sources
    .map(({ path, content }, index) =>
      `    ${quoted(path)}: ${quoted(sha256(content))}${index === sources.length - 1 ? "" : ","}`)
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
  const extracted = join(temporary, "extracted");
  await mkdir(extracted, { recursive: true });
  // tar receives cwd-relative paths: GNU tar parses the colon in an absolute
  // Windows path as a remote-host separator.
  await run("tar", ["-xzf", packed.filename, "-C", "extracted"], { cwd: temporary });
  const resolved = await resolveOpenClawGatewayContractSources(join(extracted, "package"));
  if (resolved.protocol.current !== 4) {
    throw new Error(`expected OpenClaw protocol 4, saw ${resolved.protocol.current ?? "none"}`);
  }
  if (typeof resolved.protocol.minClient === "number" && resolved.protocol.minClient > 4) {
    throw new Error(
      `OpenClaw Gateway no longer accepts protocol-4 clients (minimum client protocol ${resolved.protocol.minClient})`
    );
  }
  const generated = render({
    artifact: { ...artifact, shasum: packed.shasum },
    protocol: resolved.protocol.current,
    sources: resolved.sources
  });
  if (check) {
    if (await readFile(outputPath, "utf8") !== generated) {
      throw new Error("generated Gateway contract is stale");
    }
    process.stdout.write(
      `Verified generated Gateway contract for openclaw@${artifact.version} (${resolved.layout}).\n`
    );
  } else {
    await writeFile(outputPath, generated, "utf8");
    process.stdout.write(
      `Generated Gateway contract for openclaw@${artifact.version} (${resolved.layout}).\n`
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
