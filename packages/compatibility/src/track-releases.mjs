#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { renderCompatibilityBadge } from "./compatibility-badge.mjs";
import { buildReleaseHistory, resolveReleaseChannels } from "./release-tracking.mjs";

function parseArgs(argv) {
  const options = {
    packageName: "openclaw",
    outputDirectory: "apps/web/public/data/releases",
    index: "apps/web/public/data/release-history.json",
    latest: "apps/web/public/data/compatibility.json",
    badge: "apps/web/public/data/compatibility-badge.svg",
    runtime: "webcontainer",
    runtimeVersion: undefined,
    browserBaseline: "Desktop Chromium; Firefox and Safari are experimental until runtime evidence exists.",
    hostEvidence: undefined,
    gatewayEvidence: undefined,
    skipUnchanged: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--package" && value) options.packageName = value;
    if (argv[index] === "--output-dir" && value) options.outputDirectory = value;
    if (argv[index] === "--index" && value) options.index = value;
    if (argv[index] === "--latest" && value) options.latest = value;
    if (argv[index] === "--badge" && value) options.badge = value;
    if (argv[index] === "--runtime" && value) options.runtime = value;
    if (argv[index] === "--runtime-version" && value) options.runtimeVersion = value;
    if (argv[index] === "--browser-baseline" && value) options.browserBaseline = value;
    if (argv[index] === "--host-evidence" && value) options.hostEvidence = value;
    if (argv[index] === "--gateway-evidence" && value) options.gatewayEvidence = value;
    if (argv[index] === "--skip-unchanged") options.skipUnchanged = true;
  }
  return options;
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

const options = parseArgs(process.argv.slice(2));
const distTags = JSON.parse(run("npm", ["view", options.packageName, "dist-tags", "--json"]));
const versions = JSON.parse(run("npm", ["view", options.packageName, "versions", "--json"]));
const channels = resolveReleaseChannels(distTags, versions);
const outputDirectory = resolve(process.cwd(), options.outputDirectory);
const indexPath = resolve(process.cwd(), options.index);
const latestPath = resolve(process.cwd(), options.latest);
const badgePath = resolve(process.cwd(), options.badge);
const inspectScript = resolve(import.meta.dirname, "inspect.mjs");
const reports = {};
const reportPaths = {};
const finalOutputs = Object.fromEntries(Object.entries(channels).map(([channel, version]) => [
  channel,
  resolve(outputDirectory, `${safeSegment(options.packageName)}-${safeSegment(version)}.json`)
]));
const gatewayEvidenceVersion = options.gatewayEvidence
  ? JSON.parse(readFileSync(resolve(process.cwd(), options.gatewayEvidence), "utf8"))?.openclaw?.version
  : undefined;

if (options.skipUnchanged) {
  try {
    const current = JSON.parse(readFileSync(indexPath, "utf8"));
    const complete = [indexPath, latestPath, badgePath, ...Object.values(finalOutputs)].every((path) => existsSync(path));
    if (complete && ["stable", "previous", "preview"].every((channel) => current?.channels?.[channel] === channels[channel])) {
      process.stdout.write(`Release channels are unchanged: ${JSON.stringify(channels)}\n`);
      process.exit(0);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const stagingDirectory = mkdtempSync(resolve(tmpdir(), "clawsembly-track-"));
const stagedOutputs = {};

try {
  for (const [channel, version] of Object.entries(channels)) {
    const fileName = `${safeSegment(options.packageName)}-${safeSegment(version)}.json`;
    const stagedOutput = resolve(stagingDirectory, fileName);
    const args = [
      inspectScript,
      "--package", options.packageName,
      "--version", version,
      "--output", stagedOutput,
      "--runtime", options.runtime,
      "--browser-baseline", options.browserBaseline
    ];
    if (options.runtimeVersion) args.push("--runtime-version", options.runtimeVersion);
    if (options.hostEvidence) args.push("--host-evidence", options.hostEvidence);
    if (version === gatewayEvidenceVersion) args.push("--gateway-evidence", options.gatewayEvidence);
    run(process.execPath, args);
    stagedOutputs[channel] = stagedOutput;
    reports[channel] = JSON.parse(readFileSync(stagedOutput, "utf8"));
    reportPaths[channel] = relative(dirname(indexPath), finalOutputs[channel]).split("\\").join("/");
  }

  const history = buildReleaseHistory({
    packageName: options.packageName,
    channels,
    reports,
    reportPaths,
    generatedAt: new Date().toISOString()
  });
  const badge = renderCompatibilityBadge({
    version: reports.stable.artifact.version,
    status: reports.stable.status
  });

  mkdirSync(outputDirectory, { recursive: true });
  for (const channel of Object.keys(channels)) {
    copyFileSync(stagedOutputs[channel], finalOutputs[channel]);
    process.stdout.write(`Wrote ${finalOutputs[channel]}\n`);
  }
  mkdirSync(dirname(latestPath), { recursive: true });
  copyFileSync(stagedOutputs.stable, latestPath);
  process.stdout.write(`Wrote ${latestPath}\n`);
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, `${JSON.stringify(history, null, 2)}\n`);
  process.stdout.write(`Wrote ${indexPath}\n`);
  mkdirSync(dirname(badgePath), { recursive: true });
  writeFileSync(badgePath, badge);
  process.stdout.write(`Wrote ${badgePath}\n`);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
