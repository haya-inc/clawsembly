const RISK_RULES = [
  {
    pattern: /(^|\/)@lydell\/node-pty(?:-|$)|(^|\/)node-pty(?:-|$)/,
    reason: "Ships platform-specific PTY binaries that cannot execute in a WebContainer."
  },
  {
    pattern: /(^|\/)sqlite-vec(?:-|$)/,
    reason: "Ships platform-specific SQLite extensions and must remain optional."
  }
];

export function findNativeRisks(packages = {}) {
  const risks = [];

  for (const [path, metadata] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/")) continue;
    const name = path.slice("node_modules/".length);
    const rule = RISK_RULES.find(({ pattern }) => pattern.test(name));
    if (!rule) continue;

    risks.push({
      name,
      version: String(metadata.version ?? "unknown"),
      reason: rule.reason
    });
  }

  return risks.sort((left, right) => left.name.localeCompare(right.name));
}

export function findShrinkwrapRootDrift(manifest = {}, shrinkwrap = {}) {
  const root = shrinkwrap?.packages?.[""] ?? {};
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const missing = [];
  const mismatched = [];
  for (const section of sections) {
    const declared = manifest?.[section] ?? {};
    const locked = root?.[section] ?? {};
    for (const [name, version] of Object.entries(declared)) {
      if (!(name in locked)) missing.push({ section, name, version: String(version) });
      else if (String(locked[name]) !== String(version)) {
        mismatched.push({ section, name, manifest: String(version), shrinkwrap: String(locked[name]) });
      }
    }
  }
  return {
    lockfileVersion: Number(shrinkwrap?.lockfileVersion ?? 0),
    compatible: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched
  };
}

export function buildReport({ packageName, manifest, pack, shrinkwrap, generatedAt, hostEvidence, gatewayEvidence }) {
  if (!manifest?.version) throw new Error("The npm manifest is missing a version.");
  if (!pack?.integrity) throw new Error("The npm pack result is missing integrity metadata.");
  if (gatewayEvidence && gatewayEvidence?.openclaw?.version !== manifest.version) {
    throw new Error(`Gateway evidence for ${gatewayEvidence?.openclaw?.version ?? "unknown"} cannot prove ${manifest.version}.`);
  }

  const dependencies = manifest.dependencies ?? {};
  const nativeRiskDependencies = findNativeRisks(shrinkwrap?.packages);
  const shrinkwrapRootDrift = findShrinkwrapRootDrift(manifest, shrinkwrap);
  const hasLifecycleScript = Boolean(manifest.scripts?.preinstall || manifest.scripts?.install || manifest.scripts?.postinstall);

  return {
    schemaVersion: 1,
    generatedAt,
    status: gatewayEvidence?.gateway?.healthz?.status === 200 ? "partial" : "probing",
    target: {
      runtime: "webcontainer",
      browserBaseline: "Desktop Chromium; Firefox and Safari are experimental until runtime evidence exists."
    },
    artifact: {
      package: packageName,
      version: manifest.version,
      integrity: pack.integrity,
      nodeEngine: manifest.engines?.node ?? "unspecified",
      tarballBytes: pack.size ?? 0,
      unpackedBytes: pack.unpackedSize ?? 0,
      directDependencyCount: Object.keys(dependencies).length,
      nativeRiskDependencies,
      shrinkwrapRootConsistency: {
        lockfileVersion: shrinkwrapRootDrift.lockfileVersion,
        compatible: shrinkwrapRootDrift.compatible,
        missingCount: shrinkwrapRootDrift.missing.length,
        mismatchedCount: shrinkwrapRootDrift.mismatched.length,
        missingDevDependencyCount: shrinkwrapRootDrift.missing.filter((item) => item.section === "devDependencies").length
      }
    },
    evidence: [
      ...hostEvidence ? [{
        id: "host-preflight",
        kind: "browser-runtime",
        capturedAt: hostEvidence.capturedAt,
        path: "evidence/webcontainer-host.json",
        summary: `WebContainer ${hostEvidence.webcontainerApi} booted Node ${hostEvidence.nodeVersion} with cross-origin isolation.`
      }] : [],
      ...gatewayEvidence?.gateway ? [{
        id: "gateway-health",
        kind: "gateway",
        capturedAt: gatewayEvidence.capturedAt,
        path: `evidence/openclaw-${gatewayEvidence.openclaw.version}-gateway.json`,
        summary: gatewayEvidence.gateway.persistence?.result === "pass"
          ? `OpenClaw ${gatewayEvidence.openclaw.version} completed the browser lifecycle and recovered its mock session from a versioned OPFS backup in a fresh WebContainer.`
          : gatewayEvidence.gateway.lifecycle?.result === "pass"
            ? `OpenClaw ${gatewayEvidence.openclaw.version} completed health and readiness checks, protocol ${gatewayEvidence.gateway.handshake.protocol} hello-ok, a constrained tool turn, history recovery after reconnect, and cancellation.`
          : gatewayEvidence.gateway.chat?.tool?.result === "pass"
            ? `OpenClaw ${gatewayEvidence.openclaw.version} returned HTTP ${gatewayEvidence.gateway.healthz.status}, completed a protocol ${gatewayEvidence.gateway.handshake.protocol} hello-ok handshake, and completed a constrained streamed tool round-trip.`
          : gatewayEvidence.gateway.chat?.result === "pass"
            ? `OpenClaw ${gatewayEvidence.openclaw.version} returned HTTP ${gatewayEvidence.gateway.healthz.status}, completed a protocol ${gatewayEvidence.gateway.handshake.protocol} hello-ok handshake, and emitted a final streamed chat event.`
          : gatewayEvidence.gateway.handshake?.result === "pass"
            ? `OpenClaw ${gatewayEvidence.openclaw.version} returned HTTP ${gatewayEvidence.gateway.healthz.status} from /healthz and completed a protocol ${gatewayEvidence.gateway.handshake.protocol} hello-ok handshake.`
          : `OpenClaw ${gatewayEvidence.openclaw.version} reached server-ready and returned HTTP ${gatewayEvidence.gateway.healthz.status} from /healthz.`
      }] : [],
      ...gatewayEvidence?.hostBroker?.credentialVault ? [{
        id: "credential-vault",
        kind: "browser-security",
        capturedAt: gatewayEvidence.capturedAt,
        path: `evidence/openclaw-${gatewayEvidence.openclaw.version}-gateway.json`,
        summary: `The browser host retained a non-extractable ${gatewayEvidence.hostBroker.credentialVault.key.algorithm}-${gatewayEvidence.hostBroker.credentialVault.key.bits} key and provider ciphertext without mounting either into WebContainer.`
      }] : [],
      ...gatewayEvidence?.hostBroker?.providerBroker ? [{
        id: "provider-broker",
        kind: "browser-security",
        capturedAt: gatewayEvidence.capturedAt,
        path: `evidence/openclaw-${gatewayEvidence.openclaw.version}-gateway.json`,
        summary: gatewayEvidence.gateway?.browserHostBroker?.result === "pass"
          ? `An OpenClaw agent completed a streamed ${gatewayEvidence.gateway.browserHostBroker.toolRoundTrip?.result === "pass" ? "tool round-trip" : "turn"} through the browser-host ${gatewayEvidence.hostBroker.providerBroker.method} ${gatewayEvidence.hostBroker.providerBroker.endpoint} bridge without exposing provider credentials to WebContainer.`
          : `The browser host broker constrained provider traffic to ${gatewayEvidence.hostBroker.providerBroker.method} ${gatewayEvidence.hostBroker.providerBroker.endpoint} with stateless storage and bounded responses.`
      }] : [],
      ...gatewayEvidence?.hostBroker?.liveOptInGate ? [{
        id: "live-opt-in-gate",
        kind: "browser-security",
        capturedAt: gatewayEvidence.capturedAt,
        path: `evidence/openclaw-${gatewayEvidence.openclaw.version}-gateway.json`,
        summary: `The browser exposes a credential-and-consent-gated ${gatewayEvidence.hostBroker.liveOptInGate.model} smoke test with a $${gatewayEvidence.hostBroker.liveOptInGate.pricing.displayedUpperBoundUsd.toFixed(3)} displayed upper bound; automation made no live request.`
      }] : [],
      ...gatewayEvidence?.hostBroker?.deviceIdentity ? [{
        id: "device-identity",
        kind: "browser-security",
        capturedAt: gatewayEvidence.capturedAt,
        path: `evidence/openclaw-${gatewayEvidence.openclaw.version}-gateway.json`,
        summary: `A browser-owned non-extractable ${gatewayEvidence.hostBroker.deviceIdentity.key.algorithm} key signed the Gateway ${gatewayEvidence.hostBroker.deviceIdentity.payloadVersion} challenge, completed local Control UI pairing, and reconnected with an encrypted device token.`
      }] : [],
      ...gatewayEvidence?.gateway?.performance ? [{
        id: "runtime-performance",
        kind: "browser-performance",
        capturedAt: gatewayEvidence.capturedAt,
        path: `evidence/openclaw-${gatewayEvidence.openclaw.version}-gateway.json`,
        summary: `Cold install completed in ${(gatewayEvidence.gateway.performance.install.coldTotalMs / 1000).toFixed(1)}s after a ${gatewayEvidence.gateway.performance.install.improvement?.coldTotalPercent ?? 0}% adapter improvement, warm reinstall in ${(gatewayEvidence.gateway.performance.install.warmInstallMs / 1000).toFixed(1)}s, with ${Math.round(gatewayEvidence.gateway.performance.footprint.combinedBytes / 1_000_000)} MB combined node_modules and npm-cache content.`
      }] : []
    ],
    checks: [
      {
        id: "artifact-pinned",
        label: "Exact upstream artifact",
        status: "pass",
        detail: `${packageName}@${manifest.version} is pinned by version and integrity.`
      },
      {
        id: "lifecycle-scripts",
        label: "Lifecycle scripts classified",
        status: hasLifecycleScript ? "warn" : "pass",
        detail: hasLifecycleScript
          ? "The artifact declares lifecycle scripts; the browser probe must capture their behavior without silently skipping them."
          : "No install lifecycle scripts are declared."
      },
      {
        id: "shrinkwrap-root-consistency",
        label: "Published shrinkwrap consistency",
        status: shrinkwrapRootDrift.compatible ? "pass" : "warn",
        detail: shrinkwrapRootDrift.compatible
          ? `The published package manifest matches shrinkwrap lockfile v${shrinkwrapRootDrift.lockfileVersion} at the root.`
          : `The published manifest has ${shrinkwrapRootDrift.missing.length} root declarations missing from shrinkwrap lockfile v${shrinkwrapRootDrift.lockfileVersion} and ${shrinkwrapRootDrift.mismatched.length} mismatched declarations (${shrinkwrapRootDrift.missing.filter((item) => item.section === "devDependencies").length} missing dev dependencies); npm ci rejects the artifact even when dev dependencies are omitted.`
      },
      {
        id: "native-dependencies",
        label: "Native dependency inventory",
        status: nativeRiskDependencies.length ? "warn" : "pass",
        detail: nativeRiskDependencies.length
          ? `${nativeRiskDependencies.length} platform-specific package variants require capability-scoped handling.`
          : "No known platform-specific packages were found in the lockfile."
      },
      {
        id: "host-preflight",
        label: "Browser host preflight",
        status: hostEvidence ? hostEvidence.nodeSqlite?.close === "function" ? "pass" : "warn" : "pending",
        detail: hostEvidence
          ? `WebContainer ${hostEvidence.webcontainerApi} booted Node ${hostEvidence.nodeVersion}; built-in node:sqlite requires an adapter.`
          : "A dated browser-host evidence record has not been attached."
      },
      {
        id: "openclaw-webcontainer-boot",
        label: "OpenClaw WebContainer boot",
        status: gatewayEvidence?.gateway?.healthz?.status === 200 ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.healthz?.status === 200
          ? `The official artifact reached server-ready and /healthz returned HTTP ${gatewayEvidence.gateway.healthz.status} through explicit dependency and SQLite adapters.`
          : "The host runtime works, but this exact OpenClaw artifact has not booted in it yet."
      },
      {
        id: "gateway-handshake",
        label: "Gateway handshake",
        status: gatewayEvidence?.gateway?.handshake?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.handshake?.result === "pass"
          ? `An authenticated WebSocket client received hello-ok for protocol ${gatewayEvidence.gateway.handshake.protocol} from OpenClaw ${gatewayEvidence.gateway.handshake.serverVersion}.`
          : "A successful hello-ok frame is required before this release can be supported."
      },
      {
        id: "mocked-chat-turn",
        label: "Provider-independent chat turn",
        status: gatewayEvidence?.gateway?.chat?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.chat?.result === "pass"
          ? `OpenClaw completed a streamed turn through a deterministic local ${gatewayEvidence.gateway.chat.providerProtocol} provider and emitted a final chat event.`
          : "A streamed mocked turn through the real agent runner is required."
      },
      {
        id: "mocked-tool-call",
        label: "Constrained tool execution",
        status: gatewayEvidence?.gateway?.chat?.tool?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.chat?.tool?.result === "pass"
          ? `The model could request only ${gatewayEvidence.gateway.chat.tool.name}; OpenClaw executed it, returned the result to the provider, and completed the turn.`
          : "The model received the real tool catalog; a deterministic tool request and result round-trip is still required."
      },
      {
        id: "history-reconnect",
        label: "History after reconnect",
        status: gatewayEvidence?.gateway?.lifecycle?.reconnect?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.lifecycle?.reconnect?.result === "pass"
          ? `A new authenticated WebSocket recovered ${gatewayEvidence.gateway.lifecycle.history.reconnectedMessageCount} messages through chat.history.`
          : "History must survive a WebSocket disconnect and authenticated reconnect."
      },
      {
        id: "chat-cancellation",
        label: "Streaming cancellation",
        status: gatewayEvidence?.gateway?.lifecycle?.cancellation?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.lifecycle?.cancellation?.result === "pass"
          ? `chat.abort accepted the active run and emitted an ${gatewayEvidence.gateway.lifecycle.cancellation.eventState} event.`
          : "An active streamed turn must stop through chat.abort and emit an aborted event."
      },
      {
        id: "credential-vault",
        label: "Encrypted credential boundary",
        status: gatewayEvidence?.hostBroker?.credentialVault?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.hostBroker?.credentialVault?.result === "pass"
          ? `${gatewayEvidence.hostBroker.credentialVault.testedProvider} ciphertext persisted across document reload with a non-extractable ${gatewayEvidence.hostBroker.credentialVault.key.algorithm}-${gatewayEvidence.hostBroker.credentialVault.key.bits} key; key export and wrong-scope decryption were rejected.`
          : "Provider credentials must remain encrypted in the browser host and outside the WebContainer filesystem."
      },
      {
        id: "provider-broker",
        label: "Provider request policy",
        status: gatewayEvidence?.hostBroker?.providerBroker?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.hostBroker?.providerBroker?.result === "pass"
          ? `Mock transport verified an exact ${gatewayEvidence.hostBroker.providerBroker.method} destination, store:false, redirect rejection, credential omission, secret-safe errors, and a ${Math.round(gatewayEvidence.hostBroker.providerBroker.responseLimitBytes / 1024 / 1024)} MB response limit without making a live request.`
          : "Provider traffic must cross a fixed-destination, secret-redacting browser-host broker before live testing."
      },
      {
        id: "host-broker-turn",
        label: "OpenClaw host-broker turn",
        status: gatewayEvidence?.gateway?.browserHostBroker?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.browserHostBroker?.result === "pass"
          ? `OpenClaw agent ${gatewayEvidence.gateway.browserHostBroker.agent} completed a typed-SSE streamed ${gatewayEvidence.gateway.browserHostBroker.toolRoundTrip?.result === "pass" ? `${gatewayEvidence.gateway.browserHostBroker.toolRoundTrip.tool} tool round-trip with matched Responses function_call/function_call_output input` : "turn"} through the loopback bridge and host-owned Responses policy using ${gatewayEvidence.gateway.browserHostBroker.browserHostModel}; chat.abort reached the provider stream, credential plaintext never entered WebContainer, and no live request was made.`
          : "A real OpenClaw agent turn must cross the browser-host provider broker without mounting or logging provider credentials."
      },
      {
        id: "provider-budget",
        label: "User-configurable provider budget",
        status: gatewayEvidence?.gateway?.browserHostBroker?.budget?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.browserHostBroker?.budget?.result === "pass"
          ? `The browser host enforces request, input-character, and streamed-output budgets; a custom ${gatewayEvidence.gateway.browserHostBroker.budget.customProbe.maxRequests}-request / ${gatewayEvidence.gateway.browserHostBroker.budget.customProbe.maxInputChars}-input / ${gatewayEvidence.gateway.browserHostBroker.budget.customProbe.maxOutputChars}-output configuration recorded ${gatewayEvidence.gateway.browserHostBroker.budget.customProbe.requestsUsed} requests and over-limit probes failed closed.`
          : "Provider traffic needs user-visible request, input, and streamed-output limits before live opt-in."
      },
      {
        id: "live-opt-in-gate",
        label: "Protected live opt-in gate",
        status: gatewayEvidence?.hostBroker?.liveOptInGate?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.hostBroker?.liveOptInGate?.result === "pass"
          ? `A stored credential plus explicit billable-request consent unlocks one fixed-prompt ${gatewayEvidence.hostBroker.liveOptInGate.model} smoke test with store:false, ${gatewayEvidence.hostBroker.liveOptInGate.maxOutputTokens} output tokens, cancel control, completed plain-text rendering, and a $${gatewayEvidence.hostBroker.liveOptInGate.pricing.displayedUpperBoundUsd.toFixed(3)} displayed upper bound; automation sent ${gatewayEvidence.hostBroker.liveOptInGate.verification.liveEndpointRequestsDuringAutomation} live requests.`
          : "Live traffic needs a fixed-prompt, cost-bounded, credential-and-consent gate before it can be enabled."
      },
      {
        id: "device-identity",
        label: "Device pairing and token reconnect",
        status: gatewayEvidence?.hostBroker?.deviceIdentity?.verification?.actualGatewayHelloOk === true
          && gatewayEvidence?.hostBroker?.deviceIdentity?.verification?.controlUiPairing === true
          && gatewayEvidence?.hostBroker?.deviceIdentity?.verification?.deviceTokenReconnect === true ? "pass" : "pending",
        detail: gatewayEvidence?.hostBroker?.deviceIdentity?.verification?.actualGatewayHelloOk === true
          && gatewayEvidence?.hostBroker?.deviceIdentity?.verification?.controlUiPairing === true
          && gatewayEvidence?.hostBroker?.deviceIdentity?.verification?.deviceTokenReconnect === true
          ? `A non-extractable ${gatewayEvidence.hostBroker.deviceIdentity.key.algorithm} key persisted in ${gatewayEvidence.hostBroker.deviceIdentity.storage}, completed local Control UI pairing, encrypted the issued device token, and used it for a second hello-ok while the private key remained outside WebContainer and token plaintext stayed out of diagnostics.`
          : "A browser-owned non-extractable device key must complete Control UI pairing and a token-authenticated reconnect without leaking credentials."
      },
      {
        id: "opfs-recovery",
        label: "OPFS runtime recovery",
        status: gatewayEvidence?.gateway?.persistence?.result === "pass" ? "pass" : "pending",
        detail: gatewayEvidence?.gateway?.persistence?.result === "pass"
          ? `A ${Math.round(gatewayEvidence.gateway.persistence.snapshotBytes / 1024)} KB mock-state backup (${gatewayEvidence.gateway.persistence.format}, ${gatewayEvidence.gateway.persistence.integrity}) restored ${gatewayEvidence.gateway.persistence.recovery.transcriptFiles} transcript files in a fresh WebContainer and remained available after document reload.`
          : "The mock session must survive OPFS save, WebContainer restart, binary mount, and document reload."
      },
      {
        id: "runtime-performance",
        label: "Measured browser runtime cost",
        status: gatewayEvidence?.gateway?.performance?.result === "pass"
          ? gatewayEvidence.gateway.performance.assessment === "warn" ? "warn" : "pass"
          : "pending",
        detail: gatewayEvidence?.gateway?.performance?.result === "pass"
          ? `Chromium measured ${(gatewayEvidence.gateway.performance.install.coldTotalMs / 1000).toFixed(1)}s cold install (${(gatewayEvidence.gateway.performance.install.nestedDependencyRepairMs / 1000).toFixed(1)}s dependency repair), ${(gatewayEvidence.gateway.performance.install.warmInstallMs / 1000).toFixed(1)}s warm reinstall, ${Math.round(gatewayEvidence.gateway.performance.footprint.nodeModules.bytes / 1_000_000)} MB node_modules, ${Math.round(gatewayEvidence.gateway.performance.footprint.npmCache.bytes / 1_000_000)} MB npm cache, and ${(gatewayEvidence.gateway.performance.gateway.protocolReadyMs / 1000).toFixed(1)}s to protocol-ready. Suppressing redundant repair lifecycle scripts improved cold time by ${gatewayEvidence.gateway.performance.install.improvement?.coldTotalPercent ?? 0}%; npm ci remains blocked by missing published shrinkwrap entries.`
          : "Cold/warm install time, actual filesystem footprint, and Gateway-ready latency have not been measured in the browser lane."
      }
    ]
  };
}

export function assertReport(report) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!Number.isFinite(Date.parse(report?.generatedAt))) failures.push("generatedAt must be an ISO date-time");
  if (!["probing", "supported", "partial", "unsupported"].includes(report?.status)) failures.push("status is invalid");
  if (!report?.artifact?.package || !report?.artifact?.version || !report?.artifact?.integrity) failures.push("artifact identity is incomplete");
  if (!Array.isArray(report?.evidence)) failures.push("evidence must be an array");
  if (!Array.isArray(report?.checks) || report.checks.length === 0) failures.push("checks must not be empty");
  if (report?.checks?.some((check) => !["pass", "warn", "fail", "pending"].includes(check.status))) failures.push("a check status is invalid");
  if (failures.length) throw new Error(`Invalid compatibility report: ${failures.join("; ")}`);
  return report;
}
