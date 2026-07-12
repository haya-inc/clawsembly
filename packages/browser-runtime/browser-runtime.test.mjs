import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserRuntimeError,
  assertAbsoluteGuestPath,
  normalizeCommand,
  waitForCondition
} from "./browser-runtime.mjs";

test("handles a synchronously satisfied runtime subscription without leaking it", async () => {
  let ready = false;
  let unsubscribed = false;
  const value = await waitForCondition({
    current: () => ready,
    subscribe(listener) {
      ready = true;
      listener();
      return () => { unsubscribed = true; };
    },
    matches: Boolean,
    timeoutMessage: "not ready"
  });
  assert.equal(value, true);
  assert.equal(unsubscribed, true);
});

test("normalizes explicit commands without inheriting ambient environment", () => {
  assert.deepEqual(normalizeCommand({ executable: "node", args: ["gateway.js"] }), {
    executable: "node",
    args: ["gateway.js"],
    env: [],
    echo: false,
    cols: 120,
    rows: 30,
    outputLimitBytes: 1024 * 1024
  });
  assert.throws(
    () => normalizeCommand({ executable: "node", args: [], env: ["INVALID"] }),
    (error) => error instanceof BrowserRuntimeError && error.code === "invalid_command"
  );
});

test("accepts only normalized absolute guest paths", () => {
  assert.equal(assertAbsoluteGuestPath("/"), "/");
  assert.equal(assertAbsoluteGuestPath("/workspace/config.json"), "/workspace/config.json");
  for (const path of ["relative", "/workspace/../secret", "/workspace/./config", "/workspace//config", "/workspace/"]) {
    assert.throws(
      () => assertAbsoluteGuestPath(path),
      (error) => error instanceof BrowserRuntimeError && error.code === "invalid_path"
    );
  }
});
