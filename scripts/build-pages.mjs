#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const npmCli = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) throw new Error(`${args[0] ?? command} failed`);
}

// Windows cannot spawn npm's .cmd shim directly, so prefer the invoking npm's JS entry point.
function runNpm(args, options = {}) {
  if (npmCli && /\.[cm]?js$/u.test(npmCli)) return run(process.execPath, [npmCli, ...args], options);
  return run("npm", args, { ...options, shell: process.platform === "win32" });
}

run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "apps/web/vite.config.js"], {
  env: { ...process.env, CLAWSEMBLY_BASE_PATH: "/clawsembly/" }
});
run(process.execPath, ["scripts/build-sdk-package.mjs"]);
run(process.execPath, ["scripts/publish-sdk-download.mjs"]);

const sdkPackage = JSON.parse(await readFile(resolve(root, "packages/sdk-package/package.json"), "utf8"));
const tarball = resolve(root, ".artifacts", "sdk", `haya-inc-clawsembly-${sdkPackage.version}.tgz`);
const hostRoot = resolve(root, "examples", "sdk-host");
runNpm([
  "install",
  "--prefix",
  hostRoot,
  "--no-save",
  "--no-package-lock",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  tarball
]);
runNpm(["run", "build", "--prefix", hostRoot]);

const publicHost = resolve(root, "dist", "sdk-host");
await rm(publicHost, { recursive: true, force: true });
await cp(resolve(hostRoot, "dist"), publicHost, { recursive: true });
run(process.execPath, ["scripts/validate-active-runtime.mjs", "--dist"]);
process.stdout.write("Built the project page and packed-SDK host example for GitHub Pages.\n");
