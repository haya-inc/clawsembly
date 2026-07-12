import assert from "node:assert/strict";
import test from "node:test";

import { createVerifiedOpenClawInstaller } from "./openclaw-installer.mjs";

const artifact = {
  package: "openclaw",
  version: "2026.6.11",
  integrity: `sha512-${"A".repeat(86)}==`
};

function fakeRuntime({ lockIntegrity = artifact.integrity, completionStatus = "completed" } = {}) {
  const files = new Map();
  const commands = [];
  let starts = 0;
  return {
    files,
    commands,
    get starts() { return starts; },
    async createDirectory() {},
    async writeTextFile(path, source) { files.set(path, source); },
    async readTextFile(path) {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path);
    },
    async start(command) {
      starts += 1;
      commands.push(command);
      const listeners = [];
      return {
        id: `install-${starts}`,
        outputTruncated: false,
        onOutput(listener) { listeners.push(listener); },
        async wait() {
          for (const listener of listeners) listener("install output");
          if (completionStatus === "completed") {
            files.set(
              `${command.cwd}/node_modules/openclaw/package.json`,
              JSON.stringify({ name: "openclaw", version: artifact.version })
            );
            files.set(
              `${command.cwd}/package-lock.json`,
              JSON.stringify({
                packages: {
                  "node_modules/openclaw": {
                    version: artifact.version,
                    integrity: lockIntegrity
                  }
                }
              })
            );
          }
          return { status: completionStatus, outputBytes: 14, outputTruncated: false };
        }
      };
    }
  };
}

test("installs once, verifies lock integrity, and exposes exact paths", async () => {
  const runtime = fakeRuntime();
  const output = [];
  const audit = [];
  let now = 1_000;
  const installer = createVerifiedOpenClawInstaller({
    runtime,
    artifact,
    onOutput: (event) => output.push(event),
    onAudit: (event) => audit.push(event),
    now: () => now += 10
  });
  const first = installer.install();
  const concurrent = installer.install();
  assert.equal(first, concurrent);
  const result = await first;
  assert.equal(installer.state, "installed");
  assert.equal(runtime.starts, 1);
  assert.equal(result.integrityMatched, true);
  assert.equal(result.executablePath, "/workspace/.clawsembly/openclaw/node_modules/openclaw/openclaw.mjs");
  assert.deepEqual(runtime.commands[0].env, ["CI=1", "NO_COLOR=1"]);
  assert.equal(JSON.stringify(runtime.commands).includes("secret"), false);
  assert.deepEqual(output, [{ phase: "install", chunk: "install output" }]);
  assert.deepEqual(audit.map((event) => event.outcome), ["started", "verified"]);
  assert.equal(JSON.parse(runtime.files.get(result.packageManifestPath)).dependencies.openclaw, artifact.version);
  assert.equal(await installer.install(), result);
  assert.equal(runtime.starts, 1);
});

test("fails closed on integrity drift", async () => {
  const runtime = fakeRuntime({ lockIntegrity: `sha512-${"B".repeat(86)}==` });
  const installer = createVerifiedOpenClawInstaller({ runtime, artifact });
  await assert.rejects(installer.install(), (error) => error.code === "artifact_mismatch");
  assert.equal(installer.state, "failed");
});

test("fails closed when npm does not complete", async () => {
  const runtime = fakeRuntime({ completionStatus: "failed" });
  const installer = createVerifiedOpenClawInstaller({ runtime, artifact });
  await assert.rejects(installer.install(), (error) => error.code === "install_failed");
  assert.equal(installer.state, "failed");
});

test("rejects inexact artifact and traversal root before runtime work", () => {
  const runtime = fakeRuntime();
  assert.throws(
    () => createVerifiedOpenClawInstaller({ runtime, artifact: { ...artifact, version: "latest" } }),
    /exact OpenClaw version/u
  );
  assert.throws(
    () => createVerifiedOpenClawInstaller({ runtime, artifact, root: "/workspace/../shared" }),
    /install root/u
  );
  assert.equal(runtime.starts, 0);
});
