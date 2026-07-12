#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { buildReport, assertReport } from "./report.mjs";

function parseArgs(argv) {
  const result = {
    packageName: "openclaw",
    version: "latest",
    output: "apps/web/public/data/compatibility.json",
    runtime: "browserpod",
    runtimeVersion: "2.12.1",
    browserBaseline: "Desktop Chromium; Firefox and WebKit pending BrowserPod evidence.",
    browserRuntimeEvidence: undefined
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
  }
  return result;
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

const options = parseArgs(process.argv.slice(2));
const workingDirectory = mkdtempSync(resolve(tmpdir(), "clawsembly-inspect-"));

try {
  const spec = `${options.packageName}@${options.version}`;
  const packed = JSON.parse(run("npm", ["pack", spec, "--json"], workingDirectory))[0];
  const tarball = resolve(workingDirectory, packed.filename);
  run("tar", ["-xzf", tarball, "package/package.json", "package/npm-shrinkwrap.json"], workingDirectory);

  const manifest = JSON.parse(readFileSync(resolve(workingDirectory, "package/package.json"), "utf8"));
  const shrinkwrap = JSON.parse(readFileSync(resolve(workingDirectory, "package/npm-shrinkwrap.json"), "utf8"));
  const browserRuntimeEvidence = options.browserRuntimeEvidence
    ? JSON.parse(readFileSync(resolve(process.cwd(), options.browserRuntimeEvidence), "utf8"))
    : undefined;
  const report = assertReport(buildReport({
    packageName: options.packageName,
    manifest,
    pack: packed,
    shrinkwrap,
    browserRuntimeEvidence,
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
