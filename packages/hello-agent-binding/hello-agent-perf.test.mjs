import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { HELLO_AGENT_ARTIFACT } from "./hello-agent-artifact.generated.mjs";
import {
  HELLO_AGENT_PERF_PASS_KINDS,
  assertHelloAgentPerfBaseline,
  assertHelloAgentPerfSample,
  helloAgentPerfRecord,
  summarizeHelloAgentPerfSamples
} from "./hello-agent-perf.mjs";

const STAGED_BYTES = HELLO_AGENT_ARTIFACT.files
  .reduce((total, file) => total + file.bytes, 0);

function validSample(overrides = {}) {
  return {
    schemaVersion: 1,
    passKind: "cold",
    workspaceId: "perf-cold-1",
    phases: {
      bootMs: 4200,
      providerBootMs: 3900,
      installMs: 120,
      readyMs: 800,
      helloRoundTripMs: 60,
      closeMs: 240,
      ...overrides.phases
    },
    install: {
      integrityMatched: true,
      fileCount: HELLO_AGENT_ARTIFACT.files.length,
      stagedBytes: STAGED_BYTES,
      ...overrides.install
    },
    storage: {
      beforeUsageBytes: 0,
      afterUsageBytes: 2_048_000,
      ...overrides.storage
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => !["phases", "install", "storage"].includes(key))
    )
  };
}

function validBaseline() {
  const cold = summarizeHelloAgentPerfSamples("cold", [
    validSample({ workspaceId: "perf-cold-1" }),
    validSample({ workspaceId: "perf-cold-2", phases: { bootMs: 5000, providerBootMs: 4600 } }),
    validSample({ workspaceId: "perf-cold-3", phases: { bootMs: 4600 } })
  ]);
  const persist = summarizeHelloAgentPerfSamples("persistentReuse", [
    validSample({ passKind: "persistentReuse", workspaceId: "perf-persist" })
  ]);
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-22T00:00:00.000Z",
    target: {
      runtime: "browserpod",
      browserLocal: true,
      runtimeVersion: "2.12.1",
      browser: "HeadlessChrome/140.0.0.0",
      os: "win32 10.0.26200"
    },
    artifact: {
      package: HELLO_AGENT_ARTIFACT.name,
      version: HELLO_AGENT_ARTIFACT.version,
      integrity: HELLO_AGENT_ARTIFACT.integrity
    },
    scope: {
      chain: "hello-agent-reference-binding",
      upstreamApplicability: "none"
    },
    passes: { cold, persistentReuse: persist }
  };
}

const checkedInBaselinePath = resolve(
  import.meta.dirname,
  `evidence/hello-agent-perf-${HELLO_AGENT_ARTIFACT.version}.json`
);
const checkedInRecordPath = resolve(
  import.meta.dirname,
  `evidence/hello-agent-perf-${HELLO_AGENT_ARTIFACT.version}.record.json`
);

test("the checked-in owner-authorized baseline passes the digest-bound gate", async () => {
  const baseline = JSON.parse(await readFile(checkedInBaselinePath, "utf8"));
  assert.equal(assertHelloAgentPerfBaseline(baseline), baseline);

  // The record reference must recompute from the stored baseline bytes; a
  // hand-edited record or baseline file fails here.
  const record = JSON.parse(await readFile(checkedInRecordPath, "utf8"));
  const recomputed = await helloAgentPerfRecord(baseline);
  assert.deepEqual(record, recomputed);

  // The published baseline must meet the issue #8 sample floor on every pass.
  const passKinds = Object.keys(baseline.passes).sort();
  assert.deepEqual(passKinds, ["cold", "persistentReuse", "warm"]);
  for (const summary of Object.values(baseline.passes)) {
    assert.equal(summary.meetsSampleFloor, true);
  }
});

test("pass kinds stay the documented cold/warm/persistent triple", () => {
  assert.deepEqual([...HELLO_AGENT_PERF_PASS_KINDS], ["cold", "warm", "persistentReuse"]);
});

test("a complete sample validates and returns itself", () => {
  const sample = validSample();
  assert.equal(assertHelloAgentPerfSample(sample), sample);
});

test("samples fail closed on unknown pass kinds and broken durations", () => {
  assert.throws(() => assertHelloAgentPerfSample(validSample({ passKind: "lukewarm" })), /pass kind/u);
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ phases: { readyMs: Number.NaN } })),
    /phase readyMs/u
  );
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ phases: { installMs: -1 } })),
    /phase installMs/u
  );
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ workspaceId: "Bad Workspace!" })),
    /workspace id/u
  );
});

test("a provider boot longer than the total boot is rejected", () => {
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ phases: { bootMs: 100, providerBootMs: 200 } })),
    /provider boot exceeds total boot/u
  );
});

test("staging integrity binds to the exact artifact file set", () => {
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ install: { fileCount: 99 } })),
    /install integrity/u
  );
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ install: { integrityMatched: false } })),
    /install integrity/u
  );
});

test("storage estimates accept null when the browser withholds them", () => {
  const sample = validSample({ storage: { beforeUsageBytes: null, afterUsageBytes: null } });
  assert.equal(assertHelloAgentPerfSample(sample), sample);
  assert.throws(
    () => assertHelloAgentPerfSample(validSample({ storage: { afterUsageBytes: "big" } })),
    /storage estimate/u
  );
});

test("summaries report medians over odd and even sample counts", () => {
  const odd = summarizeHelloAgentPerfSamples("cold", [
    validSample({ phases: { bootMs: 100, providerBootMs: 50 } }),
    validSample({ phases: { bootMs: 300, providerBootMs: 50 } }),
    validSample({ phases: { bootMs: 200, providerBootMs: 50 } })
  ]);
  assert.equal(odd.medianMs.bootMs, 200);
  assert.equal(odd.sampleCount, 3);
  assert.equal(odd.meetsSampleFloor, true);

  const even = summarizeHelloAgentPerfSamples("cold", [
    validSample({ phases: { bootMs: 100, providerBootMs: 50 } }),
    validSample({ phases: { bootMs: 200, providerBootMs: 50 } })
  ]);
  assert.equal(even.medianMs.bootMs, 150);
  assert.equal(even.meetsSampleFloor, false);
});

test("summaries reject samples from another pass kind", () => {
  assert.throws(
    () => summarizeHelloAgentPerfSamples("warm", [validSample()]),
    /does not belong to warm/u
  );
  assert.throws(() => summarizeHelloAgentPerfSamples("cold", []), /at least one sample/u);
});

test("a complete baseline validates and its record recomputes deterministically", async () => {
  const baseline = validBaseline();
  assert.equal(assertHelloAgentPerfBaseline(baseline), baseline);

  const record = await helloAgentPerfRecord(baseline);
  assert.equal(record.id, "hello-agent-perf-baseline");
  assert.equal(record.kind, "browser-runtime-performance");
  assert.match(record.sha256, /^[0-9a-f]{64}$/u);
  assert.match(record.summary, /Reference-binding numbers only/u);
  assert.match(record.summary, /cold×3, persistentReuse×1/u);

  // Key order must not change the digest; tampering with a number must.
  const reordered = JSON.parse(JSON.stringify({ ...baseline, passes: baseline.passes }));
  const recomputed = await helloAgentPerfRecord(reordered);
  assert.equal(recomputed.sha256, record.sha256);
  reordered.passes.cold.medianMs = { ...reordered.passes.cold.medianMs, bootMs: 1 };
  const tampered = await helloAgentPerfRecord(reordered);
  assert.notEqual(tampered.sha256, record.sha256);
});

test("baselines fail closed on scope drift and foreign artifacts", () => {
  const wrongScope = { ...validBaseline(), scope: { chain: "hello-agent-reference-binding", upstreamApplicability: "openclaw" } };
  assert.throws(() => assertHelloAgentPerfBaseline(wrongScope), /scope honesty/u);

  const wrongArtifact = {
    ...validBaseline(),
    artifact: { package: "openclaw", version: "2026.7.1", integrity: "sha512-x" }
  };
  assert.throws(() => assertHelloAgentPerfBaseline(wrongArtifact), /artifact identity/u);

  const emptyPasses = { ...validBaseline(), passes: {} };
  assert.throws(() => assertHelloAgentPerfBaseline(emptyPasses), /pass kinds/u);

  const mislabeled = validBaseline();
  mislabeled.passes = { warm: { ...mislabeled.passes.cold } };
  assert.throws(() => assertHelloAgentPerfBaseline(mislabeled), /pass warm/u);
});

test("the schema stays payload-free: no free-text fields beyond bounded identifiers", () => {
  const sample = validSample();
  const stringFields = [];
  (function walk(value, path) {
    if (typeof value === "string") stringFields.push(path);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  })(sample, "sample");
  // workspaceId and passKind are the only strings a sample may carry, and
  // both are pattern-bounded — there is no field for prompts or credentials.
  assert.deepEqual(stringFields.sort(), ["sample.passKind", "sample.workspaceId"]);
});
