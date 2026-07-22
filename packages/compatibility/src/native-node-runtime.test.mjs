import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createNativeNodeRuntime } from "./native-node-runtime.mjs";

async function nativeRuntime(t) {
  const hostRoot = await mkdtemp(join(tmpdir(), "clawsembly-native-"));
  const runtime = createNativeNodeRuntime({ hostRoot });
  t.after(async () => {
    await runtime.close();
    await rm(hostRoot, { recursive: true, force: true });
  });
  return runtime;
}

test("identifies itself as a native host runtime, never a BrowserPod", async (t) => {
  const runtime = await nativeRuntime(t);
  assert.equal(runtime.provider, "native-node");
  assert.equal(runtime.features.browserLocal, false);
  assert.equal(runtime.features.processTermination, true);
});

test("maps /native guest paths onto the host root for files and arguments", async (t) => {
  const runtime = await nativeRuntime(t);
  await runtime.createDirectory("/native/data", { recursive: true });
  await runtime.writeTextFile("/native/data/input.txt", "guest-mapped-content");
  assert.equal(await runtime.readTextFile("/native/data/input.txt"), "guest-mapped-content");
  const task = await runtime.start({
    executable: "node",
    args: ["-e", "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))", "/native/data/input.txt"]
  });
  const completion = await task.wait();
  assert.equal(completion.status, "completed");
  assert.equal(task.transcript, "guest-mapped-content");
});

test("rejects traversal, relative paths, and oversized reads", async (t) => {
  const runtime = await nativeRuntime(t);
  await assert.rejects(runtime.writeTextFile("relative.txt", "x"), (error) => error.code === "invalid_path");
  await assert.rejects(runtime.writeTextFile("/native/../up.txt", "x"), (error) => error.code === "invalid_path");
  await runtime.writeTextFile("/native/big.txt", "abcdef");
  await assert.rejects(
    runtime.readTextFile("/native/big.txt", { maxBytes: 3 }),
    (error) => error.code === "file_too_large"
  );
});

test("passes explicit environment entries through to the child", async (t) => {
  const runtime = await nativeRuntime(t);
  const task = await runtime.start({
    executable: "node",
    args: ["-e", "process.stdout.write(process.env.CLAWSEMBLY_NATIVE_TEST ?? 'missing')"],
    env: ["CLAWSEMBLY_NATIVE_TEST=native-env-value"]
  });
  await task.wait();
  assert.equal(task.transcript, "native-env-value");
});

test("maps /native guest paths in environment values onto the host root", async (t) => {
  const hostRoot = await mkdtemp(join(tmpdir(), "clawsembly-native-"));
  const runtime = createNativeNodeRuntime({ hostRoot });
  t.after(async () => {
    await runtime.close();
    await rm(hostRoot, { recursive: true, force: true });
  });
  const task = await runtime.start({
    executable: "node",
    args: ["-e", "process.stdout.write(`${process.env.CLAWSEMBLY_NATIVE_STATE}|${process.env.CLAWSEMBLY_NATIVE_PLAIN}`)"],
    env: ["CLAWSEMBLY_NATIVE_STATE=/native/state", "CLAWSEMBLY_NATIVE_PLAIN=not-a-guest/native/path"]
  });
  const completion = await task.wait();
  assert.equal(completion.status, "completed");
  assert.equal(task.transcript, `${join(hostRoot, "state")}|not-a-guest/native/path`);
});

test("reports failure status, bounds output, and replays transcripts", async (t) => {
  const runtime = await nativeRuntime(t);
  const failing = await runtime.start({
    executable: "node",
    args: ["-e", "process.stdout.write('boom'); process.exit(3)"]
  });
  const failure = await failing.wait();
  assert.equal(failure.status, "failed");

  const noisy = await runtime.start({
    executable: "node",
    args: ["-e", "process.stdout.write('x'.repeat(5000))"],
    outputLimitBytes: 1_024
  });
  const bounded = await noisy.wait();
  assert.equal(bounded.outputTruncated, true);
  assert.ok(noisy.transcript.length <= 1_024);

  const replayed = [];
  noisy.onOutput((chunk) => replayed.push(chunk));
  assert.equal(replayed.join(""), noisy.transcript);
});

test("waitForOutput resolves on the marker and terminate stops a child", async (t) => {
  const runtime = await nativeRuntime(t);
  const task = await runtime.start({
    executable: "node",
    args: ["-e", "setTimeout(() => console.log('native-ready-marker'), 50); setTimeout(() => {}, 60_000)"]
  });
  await task.waitForOutput("native-ready-marker", { timeoutMs: 10_000 });
  task.terminate("SIGKILL");
  const completion = await task.wait();
  assert.equal(completion.status, "failed");
});

test("refuses unknown executables and work after close", async (t) => {
  const runtime = await nativeRuntime(t);
  await assert.rejects(
    runtime.start({ executable: "bash", args: [] }),
    (error) => error.code === "unsupported_executable"
  );
  await runtime.close();
  await assert.rejects(
    runtime.start({ executable: "node", args: ["-e", "0"] }),
    (error) => error.code === "runtime_closed"
  );
});
