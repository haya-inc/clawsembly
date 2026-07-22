import assert from "node:assert/strict";
import test from "node:test";

import {
  NodeEngineRangeError,
  assertNodeEngineSatisfied,
  nodeEngineRangeSatisfies
} from "./node-engine-range.mjs";

const STABLE_COMPOUND = ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0";

test("evaluates the real compound stable range exactly", () => {
  assert.equal(nodeEngineRangeSatisfies("22.15.0", STABLE_COMPOUND), false);
  assert.equal(nodeEngineRangeSatisfies("22.22.2", STABLE_COMPOUND), false);
  assert.equal(nodeEngineRangeSatisfies("22.22.3", STABLE_COMPOUND), true);
  assert.equal(nodeEngineRangeSatisfies("23.0.0", STABLE_COMPOUND), false);
  assert.equal(nodeEngineRangeSatisfies("24.14.9", STABLE_COMPOUND), false);
  assert.equal(nodeEngineRangeSatisfies("24.18.0", STABLE_COMPOUND), true);
  assert.equal(nodeEngineRangeSatisfies("25.0.0", STABLE_COMPOUND), false);
  assert.equal(nodeEngineRangeSatisfies("25.9.0", STABLE_COMPOUND), true);
  assert.equal(nodeEngineRangeSatisfies("26.0.0", STABLE_COMPOUND), true);
});

test("supports simple, bare, wildcard, caret, tilde, and hyphen forms", () => {
  assert.equal(nodeEngineRangeSatisfies("22.19.0", ">=22.19"), true);
  assert.equal(nodeEngineRangeSatisfies("22.18.9", ">=22.19"), false);
  assert.equal(nodeEngineRangeSatisfies("18.20.1", "18"), true);
  assert.equal(nodeEngineRangeSatisfies("19.0.0", "18"), false);
  assert.equal(nodeEngineRangeSatisfies("22.12.0", "22.x"), true);
  assert.equal(nodeEngineRangeSatisfies("22.12.0", "*"), true);
  assert.equal(nodeEngineRangeSatisfies("22.12.7", "~22.12.0"), true);
  assert.equal(nodeEngineRangeSatisfies("22.13.0", "~22.12.0"), false);
  assert.equal(nodeEngineRangeSatisfies("22.19.5", "^22.12.0"), true);
  assert.equal(nodeEngineRangeSatisfies("23.0.0", "^22.12.0"), false);
  assert.equal(nodeEngineRangeSatisfies("20.5.0", "18.0.0 - 20.9.0"), true);
  assert.equal(nodeEngineRangeSatisfies("21.0.0", "18.0.0 - 20.9.0"), false);
  assert.equal(nodeEngineRangeSatisfies("20.9.9", "18 - 20"), true);
});

test("fails closed on unsupported syntax instead of approximating", () => {
  for (const range of [">=18 weird!!", "latest", ">=18 && <20", "18.x.beta"]) {
    assert.throws(
      () => nodeEngineRangeSatisfies("22.15.0", range),
      (error) => error instanceof NodeEngineRangeError && error.code === "node_engine_range_unsupported"
    );
  }
  assert.throws(
    () => nodeEngineRangeSatisfies("22", ">=18"),
    (error) => error.code === "node_engine_range_unsupported"
  );
});

test("rejects a missing declaration and an oversized range", () => {
  for (const range of [undefined, null, "", "   "]) {
    assert.throws(
      () => nodeEngineRangeSatisfies("22.15.0", range),
      (error) => error instanceof NodeEngineRangeError && error.code === "node_engine_range_missing"
    );
  }
  assert.throws(
    () => nodeEngineRangeSatisfies("22.15.0", `>=18${" ".repeat(300)}`),
    (error) => error.code === "node_engine_range_unsupported"
  );
});

test("assertNodeEngineSatisfied gates fail-closed with a stable code", () => {
  const accepted = assertNodeEngineSatisfied("24.18.0", STABLE_COMPOUND);
  assert.deepEqual(accepted, { version: "24.18.0", range: STABLE_COMPOUND, satisfied: true });
  assert.throws(
    () => assertNodeEngineSatisfied("22.15.0", STABLE_COMPOUND),
    (error) => error instanceof NodeEngineRangeError && error.code === "node_engine_unsatisfied"
  );
});
