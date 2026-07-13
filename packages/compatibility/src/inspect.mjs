#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { buildReport, assertReport } from "./report.mjs";
import { inspectGatewayContract } from "./gateway-contract-inspection.mjs";

function parseArgs(argv) {
  const result = {
    packageName: "openclaw",
    version: "latest",
    output: "apps/web/public/data/compatibility.json",
    runtime: "browserpod",
    runtimeVersion: "2.12.1",
    browserBaseline: "Desktop Chromium; Firefox and WebKit pending BrowserPod evidence.",
    browserRuntimeEvidence: undefined,
    upstreamPublishedAt: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--package" && value) result.packageName = value;
    if (argv[index] === "--version" && value) result.version = value;
    if (argv[index] === "--output" && value) result.output = value;
    if (argv[index] === "--runtime" && value) result.runtime = value;
    if (argv[index] === "--runtime-version" && value) result.runtimeVersion = value;
    if (argv[index] === "--browser-baseline" && value) result.browserBaseline = value;
    if (argv[index] === "--browserpod-evidence" && value) result.browserRuntimeEvidence = value;
    if (argv[index] === "--upstream-published-at" && value) result.upstreamPublishedAt = value;
  }
  return result;
}

function resolveUpstreamPublishedAt(options, version, cwd) {
  if (options.upstreamPublishedAt !== undefined) return options.upstreamPublishedAt;
  try {
    const time = JSON.parse(runNpm(["view", `${options.packageName}@${version}`, "time", "--json"], cwd));
    if (typeof time?.[version] === "string") return time[version];
    process.stderr.write(`The npm registry has no publish time for ${options.packageName}@${version}; omitting upstreamPublishedAt.\n`);
  } catch {
    process.stderr.write(`Could not read npm publish times for ${options.packageName}@${version}; omitting upstreamPublishedAt.\n`);
  }
  return undefined;
}

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

// Windows cannot spawn npm's .cmd shim directly, so prefer the invoking npm's
// JS entry point (matches the release scripts' runNpm helper).
const npmCli = process.env.npm_execpath;
function runNpm(args, cwd) {
  if (npmCli && /\.[cm]?js$/u.test(npmCli)) return run(process.execPath, [npmCli, ...args], cwd);
  return run("npm", args, cwd, { shell: process.platform === "win32" });
}

const options = parseArgs(process.argv.slice(2));
const workingDirectory = mkdtempSync(resolve(tmpdir(), "clawsembly-inspect-"));

try {
  const spec = `${options.packageName}@${options.version}`;
  const packed = JSON.parse(runNpm(["pack", spec, "--json"], workingDirectory))[0];
  const tarball = resolve(workingDirectory, packed.filename);
  // tar receives the bare filename relative to its cwd: GNU tar parses the
  // colon in an absolute Windows path as a remote-host separator.
  run("tar", ["-xzf", packed.filename, "package/package.json"], workingDirectory);

  const manifest = JSON.parse(readFileSync(resolve(workingDirectory, "package/package.json"), "utf8"));
  // Older upstream releases predate npm-shrinkwrap adoption; the report then
  // records every direct dependency as unresolved and the shrinkwrap check
  // degrades to warn instead of blocking static inspection entirely.
  let shrinkwrap;
  try {
    run("tar", ["-xzf", packed.filename, "package/npm-shrinkwrap.json"], workingDirectory);
    shrinkwrap = JSON.parse(readFileSync(resolve(workingDirectory, "package/npm-shrinkwrap.json"), "utf8"));
  } catch {
    process.stderr.write(`${spec} ships no npm-shrinkwrap.json; recording unresolved direct dependencies.\n`);
  }
  const gatewayContract = inspectGatewayContract({ tarball, pack: packed });
  const browserRuntimeEvidence = options.browserRuntimeEvidence
    ? JSON.parse(readFileSync(resolve(process.cwd(), options.browserRuntimeEvidence), "utf8"))
    : undefined;
  const upstreamPublishedAt = resolveUpstreamPublishedAt(options, manifest.version, workingDirectory);
  const report = assertReport(buildReport({
    packageName: options.packageName,
    manifest,
    pack: packed,
    shrinkwrap,
    gatewayContract,
    browserRuntimeEvidence,
    ...(upstreamPublishedAt !== undefined ? { upstreamPublishedAt } : {}),
    target: {
      runtime: options.runtime,
      ...(options.runtimeVersion ? { runtimeVersion: options.runtimeVersion } : {}),
      browserBaseline: options.browserBaseline
    },
    generatedAt: new Date().toISOString()
  }));

  const output = resolve(process.cwd(), options.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${output}\n`);
} finally {
  rmSync(workingDirectory, { recursive: true, force: true });
}
