const EVIDENCE_PREFIX = "[clawsembly-browserpod]";

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
    throw new Error(`BrowserPod Node ${version} does not satisfy the pinned 22.19+ baseline`);
  }
}

function parseEvidence(output) {
  const line = output.split(/\r?\n/u).find((entry) => entry.includes(EVIDENCE_PREFIX));
  if (!line) throw new Error("BrowserPod preflight did not emit runtime evidence");
  const evidence = JSON.parse(line.slice(line.indexOf(EVIDENCE_PREFIX) + EVIDENCE_PREFIX.length));
  assertNodeBaseline(evidence.node);
  return evidence;
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

  let output = "";
  const decoder = new TextDecoder();
  const pod = await BrowserPod.boot({
    apiKey,
    nodeVersion: "22",
    storageKey
  });
  const terminal = await pod.createCustomTerminal({
    cols: 120,
    rows: 30,
    onOutput(buffer) {
      const chunk = decoder.decode(buffer, { stream: true });
      output += chunk;
      onOutput(chunk);
    }
  });
  await pod.run("node", ["-e", PROBE_SOURCE], { terminal, echo: false });
  output += decoder.decode();

  const evidence = parseEvidence(output);
  return {
    schemaVersion: 1,
    runtime: "browserpod",
    browserLocal: true,
    node: evidence.node,
    platform: evidence.platform,
    arch: evidence.arch,
    checks: {
      nodeBaseline: true,
      cryptoVerify: evidence.cryptoVerify === true,
      sqlite: evidence.sqlite === true
    },
    diagnostics: evidence.sqliteError ? { sqliteError: evidence.sqliteError } : {}
  };
}

export { EVIDENCE_PREFIX, PROBE_SOURCE, assertNodeBaseline, parseEvidence };
