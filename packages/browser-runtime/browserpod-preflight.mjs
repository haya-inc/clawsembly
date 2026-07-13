import { BrowserRuntimeError } from "./browser-runtime.mjs";
import { createBrowserPodRuntime } from "./browserpod-runtime.mjs";

const EVIDENCE_PREFIX = "[clawsembly-browserpod]";
const PROBE_ROOT = "/workspace/clawsembly-preflight";
const PROBE_PATH = `${PROBE_ROOT}/probe.cjs`;

const PROBE_SOURCE = String.raw`
const result = {
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  cryptoVerify: typeof require("node:crypto").verify === "function",
  sqlite: false
};
try {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("select 1");
  db.close();
  result.sqlite = true;
} catch (error) {
  result.sqliteError = error instanceof Error ? error.message : String(error);
}
console.log("${EVIDENCE_PREFIX}" + JSON.stringify(result));
`;

function assertNodeBaseline(version) {
  const [major, minor] = String(version).split(".").map(Number);
  if (major !== 22 || !Number.isInteger(minor) || minor < 19) {
    throw new BrowserRuntimeError(
      "node_baseline_unsatisfied",
      `BrowserPod Node ${version} does not satisfy the pinned 22.19+ baseline`
    );
  }
}

function parseEvidence(output) {
  const line = output.split(/\r?\n/u).find((entry) => entry.includes(EVIDENCE_PREFIX));
  if (!line) {
    throw new BrowserRuntimeError("preflight_output_missing", "BrowserPod preflight did not emit runtime evidence");
  }
  let evidence;
  try {
    evidence = JSON.parse(line.slice(line.indexOf(EVIDENCE_PREFIX) + EVIDENCE_PREFIX.length));
  } catch {
    throw new BrowserRuntimeError("preflight_output_invalid", "BrowserPod preflight emitted malformed runtime evidence");
  }
  assertNodeBaseline(evidence.node);
  return evidence;
}

/**
 * Runs the Node baseline probe in an already-booted BrowserRuntime. Keeping
 * this step separate lets the OpenClaw probe reuse one metered BrowserPod.
 */
export async function runBrowserRuntimePreflight({
  runtime,
  onOutput = () => {}
}) {
  if (!runtime || runtime.provider !== "browserpod" || typeof runtime.start !== "function"
    || typeof runtime.createDirectory !== "function" || typeof runtime.writeTextFile !== "function") {
    throw new TypeError("A booted BrowserPod runtime is required");
  }
  // BrowserPod 2.12.1's guest node resolves its first argument as a module
  // path and implements no CLI flags (-e fails with MODULE_NOT_FOUND, bare
  // flags fall through to a REPL that never exits), so the probe must be
  // staged as a real file before it can run.
  await runtime.createDirectory(PROBE_ROOT, { recursive: true });
  await runtime.writeTextFile(PROBE_PATH, PROBE_SOURCE);
  const task = await runtime.start({
    executable: "node",
    args: [PROBE_PATH],
    echo: false
  });
  task.onOutput(onOutput);
  const completion = await task.wait();
  if (completion.status !== "completed") {
    throw new BrowserRuntimeError("preflight_failed", "BrowserPod preflight command failed");
  }

  const evidence = parseEvidence(task.transcript);
  return {
    schemaVersion: 1,
    runtime: "browserpod",
    runtimeVersion: runtime.version,
    browserLocal: true,
    node: evidence.node,
    platform: evidence.platform,
    arch: evidence.arch,
    checks: {
      nodeBaseline: true,
      cryptoVerify: evidence.cryptoVerify === true,
      sqlite: evidence.sqlite === true
    },
    lifecycle: runtime.features,
    diagnostics: evidence.sqliteError ? { sqliteError: evidence.sqliteError } : {}
  };
}

/**
 * Runs a fail-closed Node compatibility probe in a browser-local BrowserPod.
 * The vendor module is injected so this package never loads proprietary code
 * or transmits an API key until a caller explicitly opts into that runtime.
 */
export async function runBrowserPodPreflight({
  BrowserPod,
  apiKey,
  storageKey = "clawsembly-browserpod-probe",
  onOutput = () => {}
}) {
  if (!BrowserPod || typeof BrowserPod.boot !== "function") {
    throw new TypeError("BrowserPod.boot is required");
  }
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new TypeError("A BrowserPod API key is required for the metered boot");
  }

  const runtime = await createBrowserPodRuntime({ BrowserPod, apiKey, storageKey });
  return runBrowserRuntimePreflight({ runtime, onOutput });
}

export { EVIDENCE_PREFIX, PROBE_SOURCE, assertNodeBaseline, parseEvidence };
