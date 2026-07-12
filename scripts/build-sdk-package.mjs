#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const sourceDirectories = ["browser-runtime", "capability-broker", "embed-sdk"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${basename(command)} ${args[0] ?? ""} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function copyCanonicalSources(staging) {
  for (const directory of sourceDirectories) {
    const source = resolve(root, "packages", directory);
    const target = resolve(staging, "packages", directory);
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith(".test.mjs") || entry.name === "README.md") continue;
      if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".d.mts") && !entry.name.endsWith(".json")) continue;
      await cp(resolve(source, entry.name), resolve(target, entry.name));
    }
  }
}

async function pack(staging, destination) {
  await mkdir(destination, { recursive: true });
  const output = run(npmExecutable, ["pack", "--json", "--pack-destination", destination], {
    cwd: staging,
    env: { ...process.env, npm_config_ignore_scripts: "true" }
  });
  let packed;
  try { [packed] = JSON.parse(output); }
  catch { throw new Error("npm pack did not return its JSON manifest"); }
  if (!packed?.filename || !Array.isArray(packed.files)) throw new Error("npm pack manifest is incomplete");
  const forbidden = packed.files.map((file) => file.path).filter((path) => (
    path.includes(".test.") || path.includes("node_modules") || path.startsWith("apps/")
  ));
  if (forbidden.length) throw new Error(`SDK tarball contains forbidden files: ${forbidden.join(", ")}`);
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "packages/embed-sdk/embed-manifest.mjs",
    "packages/embed-sdk/embed-manifest.d.mts",
    "packages/embed-sdk/boot.mjs",
    "packages/browser-runtime/browserpod-runtime.mjs",
    "packages/capability-broker/capability-broker.mjs"
  ]) {
    if (!packed.files.some((file) => file.path === required)) throw new Error(`SDK tarball is missing ${required}`);
  }
  return { manifest: packed, path: resolve(destination, packed.filename) };
}

async function verifyConsumer(tarball, temporaryRoot) {
  const consumer = resolve(temporaryRoot, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(resolve(consumer, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  run(npmExecutable, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    tarball
  ], { cwd: consumer, env: { ...process.env, npm_config_ignore_scripts: "true" } });

  const runtimeSource = `
import * as sdk from "@haya-inc/clawsembly";
import * as pairing from "@haya-inc/clawsembly/pairing-prompt";
import * as permission from "@haya-inc/clawsembly/permission-prompt";
import * as probe from "@haya-inc/clawsembly/browserpod-probe";
import * as broker from "@haya-inc/clawsembly/capability-broker";
const required = [
  sdk.bootVerifiedEmbed,
  sdk.createEmbedManifest,
  pairing.mountGatewayPairingPrompt,
  permission.mountCapabilityPermissionPrompt,
  probe.runBrowserPodOpenClawProbe,
  broker.CapabilityBroker
];
if (required.some((value) => typeof value !== "function")) throw new Error("packed ESM export is missing");
process.stdout.write("packed ESM consumer passed\\n");
`;
  await writeFile(resolve(consumer, "consumer.mjs"), runtimeSource.trimStart());
  const runtimeOutput = run(process.execPath, ["consumer.mjs"], { cwd: consumer });
  if (runtimeOutput !== "packed ESM consumer passed") throw new Error("packed ESM consumer output is invalid");

  const typeSource = `
import {
  bootVerifiedEmbed,
  createEmbedManifest,
  type EmbedManifest
} from "@haya-inc/clawsembly";
import { mountGatewayPairingPrompt } from "@haya-inc/clawsembly/pairing-prompt";
import { CapabilityBroker } from "@haya-inc/clawsembly/capability-broker";
const boot: typeof bootVerifiedEmbed = bootVerifiedEmbed;
const create: typeof createEmbedManifest = createEmbedManifest;
const prompt: typeof mountGatewayPairingPrompt = mountGatewayPairingPrompt;
const broker: typeof CapabilityBroker = CapabilityBroker;
type Manifest = EmbedManifest;
const exports = [boot, create, prompt, broker] satisfies readonly unknown[];
void exports;
export type { Manifest };
`;
  await writeFile(resolve(consumer, "consumer.ts"), typeSource.trimStart());
  await writeFile(resolve(consumer, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2023",
      module: "Node16",
      moduleResolution: "Node16",
      lib: ["ES2023", "DOM"],
      skipLibCheck: false
    },
    files: ["consumer.ts"]
  }, null, 2)}\n`);
  run(process.execPath, [resolve(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
    cwd: consumer
  });
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "clawsembly-sdk-"));
  try {
    const staging = resolve(temporaryRoot, "package");
    await mkdir(staging, { recursive: true });
    const manifestSource = await readFile(resolve(root, "packages", "sdk-package", "package.json"), "utf8");
    const manifest = JSON.parse(manifestSource);
    if (manifest.private !== false || manifest.name !== "@haya-inc/clawsembly"
      || !/^0\.1\.0-alpha\.[0-9]+$/u.test(manifest.version)) {
      throw new Error("SDK publish manifest identity is invalid");
    }
    await writeFile(resolve(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await cp(resolve(root, "packages", "sdk-package", "README.md"), resolve(staging, "README.md"));
    await cp(resolve(root, "LICENSE"), resolve(staging, "LICENSE"));
    await copyCanonicalSources(staging);

    const firstDestination = resolve(temporaryRoot, "pack-a");
    const secondDestination = resolve(temporaryRoot, "pack-b");
    const first = await pack(staging, firstDestination);
    const second = await pack(staging, secondDestination);
    const firstHash = await sha256(first.path);
    const secondHash = await sha256(second.path);
    if (firstHash !== secondHash) throw new Error("SDK tarball is not byte-reproducible");
    await verifyConsumer(first.path, temporaryRoot);

    if (!checkOnly) {
      const output = resolve(root, ".artifacts", "sdk");
      await mkdir(output, { recursive: true });
      await cp(first.path, resolve(output, basename(first.path)));
      await writeFile(resolve(output, `${basename(first.path)}.sha256`), `${firstHash}  ${basename(first.path)}\n`);
      process.stdout.write(`Packed ${manifest.name}@${manifest.version} to .artifacts/sdk/${basename(first.path)} (${firstHash})\n`);
    } else {
      process.stdout.write(`Verified reproducible ${manifest.name}@${manifest.version} tarball (${first.manifest.entryCount} files, ${firstHash}).\n`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
