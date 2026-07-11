import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReport,
  buildReport,
  deriveRuntimeClaimStatuses,
  evidenceDigest,
  findNativeRisks,
  findShrinkwrapRootDrift
} from "./report.mjs";

test("evidenceDigest is stable across object key order", () => {
  assert.equal(
    evidenceDigest({ nested: { second: 2, first: 1 }, items: [{ beta: true, alpha: false }] }),
    evidenceDigest({ items: [{ alpha: false, beta: true }], nested: { first: 1, second: 2 } })
  );
  assert.notEqual(evidenceDigest({ result: "pass" }), evidenceDigest({ result: "fail" }));
});

test("deriveRuntimeClaimStatuses fails closed when evidence is incomplete", () => {
  const statuses = deriveRuntimeClaimStatuses({
    hostEvidence: { nodeSqlite: { close: "undefined" } },
    gatewayEvidence: { gateway: { healthz: { status: 200 }, handshake: { result: "pass" } } }
  });
  assert.equal(statuses["host-preflight"], "warn");
  assert.equal(statuses["openclaw-webcontainer-boot"], "pass");
  assert.equal(statuses["gateway-handshake"], "pass");
  assert.equal(statuses["mocked-chat-turn"], "pending");
  assert.equal(statuses["runtime-performance"], "pending");
});

test("findNativeRisks classifies platform variants", () => {
  const risks = findNativeRisks({
    "": { version: "1.0.0" },
    "node_modules/ws": { version: "8.0.0" },
    "node_modules/@lydell/node-pty-linux-x64": { version: "1.2.0" },
    "node_modules/sqlite-vec-darwin-arm64": { version: "0.1.9" }
  });

  assert.deepEqual(risks.map((risk) => risk.name), ["@lydell/node-pty-linux-x64", "sqlite-vec-darwin-arm64"]);
});

test("findShrinkwrapRootDrift detects npm ci root validation failures", () => {
  const drift = findShrinkwrapRootDrift({
    dependencies: { ws: "8.21.0" },
    devDependencies: { vitest: "4.1.0" },
    optionalDependencies: { sqlite: "1.0.0" }
  }, {
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: { ws: "8.21.0" },
        optionalDependencies: { sqlite: "0.9.0" }
      }
    }
  });

  assert.equal(drift.compatible, false);
  assert.deepEqual(drift.missing.map((item) => `${item.section}:${item.name}`), ["devDependencies:vitest"]);
  assert.deepEqual(drift.mismatched.map((item) => `${item.section}:${item.name}`), ["optionalDependencies:sqlite"]);
});

test("buildReport keeps runtime claims pending", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: {
      version: "2026.6.11",
      engines: { node: ">=22.19.0" },
      scripts: { postinstall: "node install.mjs" },
      dependencies: { ws: "8.0.0" }
    },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} }
  });

  assert.equal(report.status, "probing");
  assert.equal(report.checks.find((check) => check.id === "openclaw-webcontainer-boot")?.status, "pending");
  assert.doesNotThrow(() => assertReport(report));
});

test("buildReport rejects runtime evidence from another OpenClaw release", () => {
  assert.throws(() => buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.7.1" },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      openclaw: { version: "2026.6.11" },
      gateway: { healthz: { status: 200 } }
    }
  }), /cannot prove 2026\.7\.1/);
});

test("buildReport attaches dated host evidence without overstating OpenClaw boot", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    hostEvidence: {
      capturedAt: "2026-07-11T16:06:30.000Z",
      webcontainerApi: "1.6.4",
      nodeVersion: "v22.22.3"
    }
  });

  assert.equal(report.checks.find((check) => check.id === "host-preflight")?.status, "warn");
  assert.equal(report.checks.find((check) => check.id === "openclaw-webcontainer-boot")?.status, "pending");
  assert.equal(report.evidence.length, 1);
});

test("buildReport marks a health-checked Gateway boot as partial", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T16:44:19.000Z",
      openclaw: { version: "2026.6.11" },
      gateway: { healthz: { status: 200 } }
    }
  });

  assert.equal(report.status, "partial");
  assert.equal(report.checks.find((check) => check.id === "openclaw-webcontainer-boot")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "gateway-handshake")?.status, "pending");
});

test("buildReport passes an evidenced protocol handshake without overstating chat", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T16:55:21.000Z",
      openclaw: { version: "2026.6.11" },
      gateway: {
        healthz: { status: 200 },
        handshake: { result: "pass", protocol: 4, serverVersion: "2026.6.11" }
      }
    }
  });

  assert.equal(report.status, "partial");
  assert.equal(report.checks.find((check) => check.id === "gateway-handshake")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "mocked-chat-turn")?.status, "pending");
  assert.match(report.evidence[0].summary, /hello-ok/);
});

test("buildReport passes a streamed chat turn while keeping unevidenced tool execution pending", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T17:07:13.000Z",
      openclaw: { version: "2026.6.11" },
      gateway: {
        healthz: { status: 200 },
        handshake: { result: "pass", protocol: 4, serverVersion: "2026.6.11" },
        chat: { result: "pass", providerProtocol: "openai-completions" }
      }
    }
  });

  assert.equal(report.status, "partial");
  assert.equal(report.checks.find((check) => check.id === "mocked-chat-turn")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "mocked-tool-call")?.status, "pending");
});

test("buildReport passes a constrained tool round-trip from evidence", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T17:30:32.000Z",
      openclaw: { version: "2026.6.11" },
      gateway: {
        healthz: { status: 200 },
        handshake: { result: "pass", protocol: 4, serverVersion: "2026.6.11" },
        chat: {
          result: "pass",
          providerProtocol: "openai-completions",
          tool: { result: "pass", name: "agents_list" }
        }
      }
    }
  });

  assert.equal(report.status, "partial");
  assert.equal(report.checks.find((check) => check.id === "mocked-tool-call")?.status, "pass");
  assert.match(report.evidence[0].summary, /tool round-trip/);
});

test("buildReport passes evidenced reconnect history and cancellation", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T17:53:43.000Z",
      openclaw: { version: "2026.6.11" },
      gateway: {
        healthz: { status: 200 },
        handshake: { result: "pass", protocol: 4, serverVersion: "2026.6.11" },
        lifecycle: {
          result: "pass",
          history: { reconnectedMessageCount: 4 },
          reconnect: { result: "pass" },
          cancellation: { result: "pass", eventState: "aborted" }
        }
      }
    }
  });

  assert.equal(report.status, "partial");
  assert.equal(report.checks.find((check) => check.id === "history-reconnect")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "chat-cancellation")?.status, "pass");
  assert.match(report.evidence[0].summary, /history recovery/);
});

test("buildReport passes evidenced OPFS runtime recovery", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T18:10:08.000Z",
      openclaw: { version: "2026.6.11" },
      gateway: {
        healthz: { status: 200 },
        handshake: { result: "pass", protocol: 4, serverVersion: "2026.6.11" },
        persistence: {
          result: "pass",
          format: "Clawsembly backup envelope v1",
          integrity: "SHA-256",
          snapshotBytes: 1034941,
          recovery: { transcriptFiles: 2 }
        }
      }
    }
  });

  assert.equal(report.status, "partial");
  assert.equal(report.checks.find((check) => check.id === "opfs-recovery")?.status, "pass");
  assert.match(report.evidence[0].summary, /versioned OPFS backup/);
  assert.match(report.checks.find((check) => check.id === "opfs-recovery")?.detail, /SHA-256/);
});

test("buildReport passes an evidenced browser-host credential vault", () => {
  const report = buildReport({
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    gatewayEvidence: {
      capturedAt: "2026-07-11T18:28:44.000Z",
      openclaw: { version: "2026.6.11" },
      hostBroker: {
        credentialVault: {
          result: "pass",
          testedProvider: "openai",
          key: { algorithm: "AES-GCM", bits: 256 }
        },
        providerBroker: {
          result: "pass",
          method: "POST",
          endpoint: "https://api.openai.com/v1/responses",
          responseLimitBytes: 2097152
        },
        liveOptInGate: {
          result: "pass",
          model: "gpt-5.6-luna",
          maxOutputTokens: 128,
          pricing: { displayedUpperBoundUsd: 0.001 },
          verification: { liveEndpointRequestsDuringAutomation: 0 }
        },
        deviceIdentity: {
          result: "pass",
          storage: "IndexedDB",
          payloadVersion: "v3",
          key: { algorithm: "Ed25519" },
          verification: {
            actualGatewayHelloOk: true,
            controlUiPairing: true,
            deviceTokenReconnect: true
          }
        }
      },
      gateway: {
        healthz: { status: 200 },
        browserHostBroker: {
          result: "pass",
          agent: "broker",
          browserHostModel: "gpt-5.6-luna",
          toolRoundTrip: { result: "pass", tool: "agents_list" },
          budget: {
            result: "pass",
            customProbe: { maxRequests: 5, maxInputChars: 120000, maxOutputChars: 90000, requestsUsed: 3 }
          }
        },
        performance: {
          result: "pass",
          assessment: "warn",
          install: { coldTotalMs: 57135, nestedDependencyRepairMs: 49696, warmInstallMs: 2882, improvement: { coldTotalPercent: 4.1 } },
          footprint: { combinedBytes: 880182671, nodeModules: { bytes: 618549063 }, npmCache: { bytes: 261633608 } },
          gateway: { protocolReadyMs: 16432 }
        }
      }
    }
  });

  const check = report.checks.find((candidate) => candidate.id === "credential-vault");
  assert.equal(check?.status, "pass");
  assert.match(check?.detail, /key export and wrong-scope decryption were rejected/);
  assert.match(report.evidence.find((item) => item.id === "credential-vault")?.summary, /without mounting either into WebContainer/);
  assert.equal(report.checks.find((candidate) => candidate.id === "provider-broker")?.status, "pass");
  assert.match(report.checks.find((candidate) => candidate.id === "provider-broker")?.detail, /without making a live request/);
  assert.equal(report.checks.find((candidate) => candidate.id === "host-broker-turn")?.status, "pass");
  assert.match(report.checks.find((candidate) => candidate.id === "host-broker-turn")?.detail, /credential plaintext never entered WebContainer/);
  assert.match(report.checks.find((candidate) => candidate.id === "host-broker-turn")?.detail, /chat\.abort reached the provider stream/);
  assert.match(report.checks.find((candidate) => candidate.id === "host-broker-turn")?.detail, /agents_list tool round-trip/);
  assert.match(report.checks.find((candidate) => candidate.id === "host-broker-turn")?.detail, /function_call\/function_call_output/);
  assert.equal(report.checks.find((candidate) => candidate.id === "provider-budget")?.status, "pass");
  assert.match(report.checks.find((candidate) => candidate.id === "provider-budget")?.detail, /custom 5-request/);
  assert.equal(report.checks.find((candidate) => candidate.id === "live-opt-in-gate")?.status, "pass");
  assert.match(report.checks.find((candidate) => candidate.id === "live-opt-in-gate")?.detail, /automation sent 0 live requests/);
  assert.equal(report.checks.find((candidate) => candidate.id === "runtime-performance")?.status, "warn");
  assert.match(report.checks.find((candidate) => candidate.id === "runtime-performance")?.detail, /57\.1s cold install/);
  assert.match(report.checks.find((candidate) => candidate.id === "runtime-performance")?.detail, /improved cold time by 4\.1%/);
  assert.equal(report.checks.find((candidate) => candidate.id === "device-identity")?.status, "pass");
  assert.match(report.evidence.find((item) => item.id === "device-identity")?.summary, /reconnected with an encrypted device token/);
});

test("assertReport rejects unsupported status values", () => {
  assert.throws(() => assertReport({ schemaVersion: 1, generatedAt: "bad", status: "green" }), /Invalid compatibility report/);
});
