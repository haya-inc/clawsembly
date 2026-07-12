#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex === -1 ? "5174" : process.argv[portIndex + 1]);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError("--port must be a valid TCP port");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) throw new Error(`${args[0] ?? command} failed`);
}

run(process.execPath, ["scripts/build-sdk-package.mjs"]);
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

const server = await createServer({
  root: hostRoot,
  configFile: resolve(hostRoot, "vite.config.mjs"),
  server: { host: "127.0.0.1", port, strictPort: true }
});
await server.listen();
server.printUrls();

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
await new Promise(() => {});
