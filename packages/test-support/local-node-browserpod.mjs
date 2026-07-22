// Local BrowserPod 2.12.1 provider double that executes real Node child
// processes against a host temp directory, for tests that need the documented
// run/file surface with a real filesystem (workspace backup export/restore).
// It mirrors the same provider surface fake-browserpod.mjs simulates in
// memory; keep the two beside each other so a BrowserPod upgrade edits one
// directory instead of scattered hand-rolled doubles.
//
// This module must stay outside packages/{browser-runtime,capability-broker,
// embed-sdk}: scripts/build-sdk-package.mjs packs every non-test .mjs from
// those directories into the published SDK tarball.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";

/**
 * Boots a BrowserPodRuntime whose guest `/workspace` maps onto a fresh host
 * temp directory and whose `run` executes real Node. Registers cleanup on the
 * node:test context. Returns `{ runtime, hostPath, exchangeDocuments }`;
 * `exchangeDocuments` records every exchange file that crosses the boundary
 * so tests can assert it stays encrypted.
 */
export async function createLocalNodeBrowserPodRuntime(t) {
  const hostRoot = await mkdtemp(join(tmpdir(), "clawsembly-workspace-"));
  const drive = /^[A-Za-z]:/u.test(hostRoot) ? hostRoot.slice(0, 2) : "";
  const guestRoot = hostRoot.slice(drive.length).replaceAll("\\", "/");
  const mapGuestPath = (guestPath) => guestPath === "/workspace" || guestPath.startsWith("/workspace/")
    ? `${guestRoot}${guestPath.slice("/workspace".length)}`
    : guestPath;
  const hostPath = (guestPath) => `${drive}${mapGuestPath(guestPath)}`;
  const children = new Set();
  const exchangeDocuments = [];
  t.after(async () => {
    for (const child of children) {
      try { child.kill("SIGKILL"); } catch { /* Already exited. */ }
    }
    await rm(hostRoot, { recursive: true, force: true });
  });
  const BrowserPod = {
    async boot() {
      return {
        onPortal() {},
        async createCustomTerminal(options) { return { onOutput: options.onOutput }; },
        async run(executable, args, options = {}) {
          if (executable !== "node") throw new Error("local runtime only executes Node");
          const child = spawn(process.execPath, args.map((argument) => mapGuestPath(argument)), {
            cwd: hostPath(options.cwd ?? guestRoot),
            env: {
              ...process.env,
              ...Object.fromEntries((options.env ?? []).map((entry) => {
                const separator = entry.indexOf("=");
                return [entry.slice(0, separator), entry.slice(separator + 1)];
              }))
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
          });
          children.add(child);
          child.stdout.on("data", (chunk) => options.terminal?.onOutput?.(chunk));
          child.stderr.on("data", (chunk) => options.terminal?.onOutput?.(chunk));
          return new Promise((resolve, reject) => {
            child.once("error", (error) => {
              children.delete(child);
              reject(error);
            });
            child.once("exit", (code) => {
              children.delete(child);
              if (code === 0) resolve({});
              else reject(new Error(`workspace helper exited with ${code}`));
            });
          });
        },
        async createDirectory(path, options = {}) {
          await mkdir(hostPath(path), { recursive: options.recursive === true });
        },
        async createFile(path) {
          let text = "";
          return {
            async write(value) { text += value; },
            async close() {
              if (path.includes("/exchange-")) exchangeDocuments.push(text);
              await writeFile(hostPath(path), text, "utf8");
            }
          };
        },
        async openFile(path) {
          const target = hostPath(path);
          const info = await stat(target);
          const text = await readFile(target, "utf8");
          if (path.includes("/exchange-")) exchangeDocuments.push(text);
          return {
            async getSize() { return info.size; },
            async read() { return text; },
            async close() {}
          };
        }
      };
    }
  };
  const runtime = await createBrowserPodRuntime({ BrowserPod, apiKey: "local-provider-double" });
  return { runtime, hostPath, exchangeDocuments };
}
