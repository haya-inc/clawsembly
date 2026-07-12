#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) throw new Error(`${args[0] ?? command} failed`);
}

run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "apps/web/vite.config.js"], {
  env: { ...process.env, CLAWSEMBLY_BASE_PATH: "/clawsembly/" }
});
run(process.execPath, ["scripts/build-sdk-package.mjs"]);
run(process.execPath, ["scripts/publish-sdk-download.mjs"]);

const tarball = resolve(root, ".artifacts", "sdk", "haya-inc-clawsembly-0.1.0-alpha.0.tgz");
const hostRoot = resolve(root, "examples", "sdk-host");
run(npmExecutable, [
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
run(npmExecutable, ["run", "build", "--prefix", hostRoot]);

const publicHost = resolve(root, "dist", "sdk-host");
await rm(publicHost, { recursive: true, force: true });
await cp(resolve(hostRoot, "dist"), publicHost, { recursive: true });
run(process.execPath, ["scripts/validate-active-runtime.mjs", "--dist"]);
process.stdout.write("Built the project page and packed-SDK host example for GitHub Pages.\n");
