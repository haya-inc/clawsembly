import assert from "node:assert/strict";
import test from "node:test";

import { BrowserRuntimeError } from "./browser-runtime.mjs";
import { createBrowserPodRuntime } from "./browserpod-runtime.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeProvider() {
  const calls = [];
  const portalHandlers = [];
  const run = deferred();
  let terminalOutput;
  const files = new Map();
  const BrowserPod = {
    async boot(options) {
      calls.push(["boot", options]);
      return {
        onPortal(handler) { portalHandlers.push(handler); },
        async createCustomTerminal(options) {
          calls.push(["terminal", { cols: options.cols, rows: options.rows }]);
          terminalOutput = options.onOutput;
          return { kind: "terminal" };
        },
        run(executable, args, options) {
          calls.push(["run", { executable, args, options }]);
          return run.promise;
        },
        async createDirectory(path, options) { calls.push(["mkdir", { path, options }]); },
        async createFile(path, mode) {
          calls.push(["createFile", { path, mode }]);
          let text = "";
          return {
            async write(value) { text += value; files.set(path, text); return value.length; },
            async close() { calls.push(["close", path]); }
          };
        },
        async openFile(path, mode) {
          calls.push(["openFile", { path, mode }]);
          const text = files.get(path) ?? "";
          return {
            async getSize() { return text.length; },
            async read(length) { return text.slice(0, length); },
            async close() { calls.push(["close", path]); }
          };
        }
      };
    }
  };
  return {
    BrowserPod,
    calls,
    run,
    emitOutput(text) { terminalOutput(new TextEncoder().encode(text).buffer); },
    emitPortal(value) { for (const handler of portalHandlers) handler(value); }
  };
}

test("boots a persistent BrowserPod without passing its API key to guest work", async () => {
  const fake = fakeProvider();
  const audit = [];
  const runtime = await createBrowserPodRuntime({
    BrowserPod: fake.BrowserPod,
    apiKey: "browserpod-secret",
    storageKey: "clawsembly-primary",
    onAudit: (event) => audit.push(event)
  });
  assert.deepEqual(fake.calls[0], ["boot", {
    apiKey: "browserpod-secret",
    nodeVersion: "22",
    storageKey: "clawsembly-primary"
  }]);
  assert.equal(runtime.provider, "browserpod");
  assert.equal(runtime.version, "2.12.1");
  assert.equal(runtime.features.persistentFilesystem, true);
  assert.equal(runtime.features.processTermination, false);
  assert.equal(JSON.stringify(audit).includes("browserpod-secret"), false);
});

test("starts a long-lived process without awaiting exit and observes output and portal readiness", async () => {
  const fake = fakeProvider();
  const runtime = await createBrowserPodRuntime({ BrowserPod: fake.BrowserPod, apiKey: "secret" });
  const task = await runtime.start({
    executable: "node",
    args: ["gateway.js"],
    cwd: "/workspace",
    env: ["PORT=18789"]
  });
  assert.equal(task.status, "running");
  fake.emitOutput("gateway ready\n");
  assert.match(await task.waitForOutput("gateway ready"), /gateway ready/u);
  const portalPromise = runtime.waitForPortal(18789);
  fake.emitPortal({ port: 18789, url: "https://portal.example/session" });
  assert.deepEqual(await portalPromise, {
    port: 18789,
    url: "https://portal.example/session",
    visibility: "public-url"
  });
  fake.run.resolve({});
  assert.deepEqual(await task.wait(), { status: "completed", outputBytes: 14, outputTruncated: false });
  assert.equal(task.status, "completed");
});

test("replays output emitted before a fast task can be observed", async () => {
  const fake = fakeProvider();
  const runtime = await createBrowserPodRuntime({ BrowserPod: fake.BrowserPod, apiKey: "secret" });
  const task = await runtime.start({ executable: "node", args: ["-e", "console.log('fast')"] });
  fake.emitOutput("fast\n");
  const received = [];
  task.onOutput((chunk) => received.push(chunk));
  assert.deepEqual(received, ["fast\n"]);
  fake.run.resolve({});
  await task.wait();
});

test("bounds captured output and exposes no undocumented process-control success", async () => {
  const fake = fakeProvider();
  const runtime = await createBrowserPodRuntime({ BrowserPod: fake.BrowserPod, apiKey: "secret" });
  const task = await runtime.start({ executable: "node", args: ["server.js"], outputLimitBytes: 1024 });
  fake.emitOutput("x".repeat(1_500));
  assert.equal(task.transcript.length, 1_024);
  assert.equal(task.outputTruncated, true);
  assert.throws(() => task.terminate(), (error) => error instanceof BrowserRuntimeError
    && error.code === "unsupported_feature");
  const disposed = runtime.dispose();
  assert.equal(disposed.complete, false);
  assert.deepEqual(disposed.activeTaskIds, [task.id]);
  await assert.rejects(
    runtime.start({ executable: "node", args: [] }),
    (error) => error.code === "runtime_closed"
  );
  fake.run.resolve({});
  await task.wait();
});

test("writes and reads bounded text files while closing every handle", async () => {
  const fake = fakeProvider();
  const runtime = await createBrowserPodRuntime({ BrowserPod: fake.BrowserPod, apiKey: "secret" });
  await runtime.createDirectory("/workspace", { recursive: true });
  await runtime.writeTextFile("/workspace/config.json", "{\"ok\":true}");
  assert.equal(await runtime.readTextFile("/workspace/config.json"), "{\"ok\":true}");
  assert.equal(fake.calls.filter(([name]) => name === "close").length, 2);
  await assert.rejects(
    runtime.readTextFile("/workspace/config.json", { maxBytes: 2 }),
    (error) => error.code === "file_too_large"
  );
  assert.equal(fake.calls.filter(([name]) => name === "close").length, 3);
});

test("rejects invalid commands, traversal paths, insecure portals, and cancelled waits", async () => {
  const fake = fakeProvider();
  const runtime = await createBrowserPodRuntime({ BrowserPod: fake.BrowserPod, apiKey: "secret" });
  await assert.rejects(
    runtime.start({ executable: "node", args: [], cwd: "/workspace/../secret" }),
    (error) => error.code === "invalid_path"
  );
  await assert.rejects(
    runtime.writeTextFile("relative.txt", "no"),
    (error) => error.code === "invalid_path"
  );
  fake.emitPortal({ port: 3000, url: "http://insecure.example" });
  const controller = new AbortController();
  const waiting = runtime.waitForPortal(3000, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (error) => error.code === "cancelled");
});
