import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import { createDeviceConnectParams, runDeviceIdentityProbe } from "./device-identity";
import sqlitePolyfillSource from "../../../packages/webcontainer-adapter/node-sqlite-polyfill.mjs?raw";
import openclawBootstrapSource from "../../../packages/webcontainer-adapter/openclaw-bootstrap.mjs?raw";
import mockOpenAiServerSource from "../../../packages/webcontainer-adapter/mock-openai-server.mjs?raw";
import gatewayLifecycleProbeSource from "../../../packages/webcontainer-adapter/gateway-lifecycle-probe.mjs?raw";
import gatewayDeviceIdentityProbeSource from "../../../packages/webcontainer-adapter/gateway-device-identity-probe.mjs?raw";
import gatewayControlUiPairingProbeSource from "../../../packages/webcontainer-adapter/gateway-control-ui-pairing-probe.mjs?raw";
import hostBrokerOpenAiServerSource from "../../../packages/webcontainer-adapter/host-broker-openai-server.mjs?raw";
import gatewayHostBrokerTurnProbeSource from "../../../packages/webcontainer-adapter/gateway-host-broker-turn-probe.mjs?raw";
import measureInstallFootprintSource from "../../../packages/webcontainer-adapter/measure-install-footprint.mjs?raw";
import ed25519VerifyAdapterSource from "../../../packages/webcontainer-adapter/ed25519-verify-adapter.mjs?raw";
import openclawEd25519SourcePatch from "../../../packages/webcontainer-adapter/openclaw-ed25519-source-patch.mjs?raw";
import { getCredentialMetadata, removeProviderCredential, storeProviderCredential, withProviderCredential } from "./credential-vault";
import {
  OPENAI_BROKER_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
  ProviderBudgetTracker,
  streamOpenAIResponseWithTransport,
  type OpenAIFunctionTool,
  type OpenAIResponseInput
} from "./provider-broker";
import {
  createStoredStateBackup,
  decodeStateBackup,
  importStateBackup,
  exportStateSnapshot,
  formatSnapshotSize,
  loadStateSnapshot,
  persistStateSnapshot,
  removeStateSnapshot,
  verifyStateBackupGuards
} from "./state-persistence";

type ProbeState = "idle" | "running" | "pass" | "fail";
let activeContainer: WebContainer | undefined;
let lastStateSnapshot: Uint8Array | undefined;
interface InstallPerformanceEvidence {
  coldRootInstallMs: number;
  nestedRepairMs: number;
  coldTotalMs: number;
  warmInstallMs: number;
  nodeModules: { bytes: number; files: number; directories: number; symlinks: number };
  npmCache: { bytes: number; files: number; directories: number; symlinks: number };
}
let lastInstallPerformance: InstallPerformanceEvidence | undefined;
const GATEWAY_PROBE_TOKEN = "clawsembly-local-probe-token";
const HOST_BROKER_CAPABILITY = "clawsembly-ephemeral-host-broker-probe";

function cleanTerminal(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function appendOutput(target: HTMLElement, value: string): void {
  const next = `${target.textContent ?? ""}${cleanTerminal(value)}`;
  target.textContent = next.slice(-12_000);
  target.scrollTop = target.scrollHeight;
}

function updateLine(index: number, state: ProbeState, value: string): void {
  const lines = Array.from(document.querySelectorAll<HTMLElement>("[data-probe-output] li"));
  const line = lines[index];
  if (!line) return;
  line.dataset.state = state;
  const output = line.querySelector<HTMLElement>("em");
  if (output) output.textContent = value;
}

async function readProcessOutput(instance: WebContainer): Promise<{ code: number; output: string }> {
  const child = await instance.spawn("node", ["--version"]);
  let output = "";
  const outputComplete = child.output.pipeTo(new WritableStream({
    write(chunk: string) { output += chunk; }
  }));
  const code = await child.exit;
  await outputComplete;
  return { code, output: output.trim() };
}

async function runTransientProcessProbe(
  instance: WebContainer,
  command: string,
  args: string[],
  attempts = 2
): Promise<{ code: number; output: string; attempts: number }> {
  let last = { code: -1, output: "" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const child = await instance.spawn(command, args);
    let output = "";
    const complete = child.output.pipeTo(new WritableStream({ write(chunk: string) { output += chunk; } }));
    const code = await child.exit;
    await complete;
    last = { code, output };
    if (code === 0) return { ...last, attempts: attempt };
    if (attempt < attempts) await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return { ...last, attempts };
}

async function readSqliteCapability(instance: WebContainer): Promise<{ close: string; exec: string; prepare: string }> {
  const script = [
    'const { DatabaseSync } = require("node:sqlite")',
    'const db = new DatabaseSync(":memory:")',
    'console.log(JSON.stringify({ close: typeof db.close, exec: typeof db.exec, prepare: typeof db.prepare }))',
    'if (typeof db.close === "function") db.close()'
  ].join(";");
  const child = await instance.spawn("node", ["-e", script], { env: { NODE_NO_WARNINGS: "1" } });
  let output = "";
  const outputComplete = child.output.pipeTo(new WritableStream({ write(chunk: string) { output += chunk; } }));
  const code = await child.exit;
  await outputComplete;
  if (code !== 0) throw new Error(`node:sqlite probe exited with ${code}: ${cleanTerminal(output).trim()}`);
  const json = cleanTerminal(output).trim().split("\n").find((line) => line.startsWith("{"));
  if (!json) throw new Error("node:sqlite probe returned no JSON result");
  return JSON.parse(json) as { close: string; exec: string; prepare: string };
}

async function verifyRecoveredTranscript(instance: WebContainer): Promise<{
  transcriptFiles: number;
  userMessage: boolean;
  assistantMessage: boolean;
}> {
  const script = [
    "import fs from 'node:fs'",
    "import path from 'node:path'",
    "const root = '.clawsembly-openclaw'",
    "function walk(directory) {",
    "  const files = []",
    "  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {",
    "    const target = path.join(directory, entry.name)",
    "    if (entry.isDirectory()) files.push(...walk(target))",
    "    else files.push(target)",
    "  }",
    "  return files",
    "}",
    "const transcripts = walk(root).filter((file) => file.endsWith('.jsonl'))",
    "const content = transcripts.map((file) => fs.readFileSync(file, 'utf8')).join('\\n')",
    "const result = { transcriptFiles: transcripts.length, userMessage: content.includes('Reply with the deterministic mock response.'), assistantMessage: content.includes('Clawsembly tool round-trip passed.') }",
    "console.log(JSON.stringify(result))",
    "if (!result.transcriptFiles || !result.userMessage || !result.assistantMessage) process.exit(1)"
  ].join("\n");
  const child = await instance.spawn("node", ["--input-type=module", "-e", script]);
  let output = "";
  const complete = child.output.pipeTo(new WritableStream({ write(chunk: string) { output += chunk; } }));
  const code = await child.exit;
  await complete;
  const line = cleanTerminal(output).trim().split("\n").find((value) => value.startsWith("{"));
  if (code !== 0 || !line) throw new Error(`recovered transcript verification failed: ${output.trim()}`);
  return JSON.parse(line) as { transcriptFiles: number; userMessage: boolean; assistantMessage: boolean };
}

async function verifyBrowserDeviceHandshake(instance: WebContainer, port: number, token: string): Promise<{
  deviceId: string;
  protocol: number;
  serverVersion: string;
  signatureVersion: "v2" | "v3";
}> {
  const process = await instance.spawn("node", ["adapter/gateway-device-identity-probe.mjs"], {
    env: { NO_COLOR: "1", CLAWSEMBLY_GATEWAY_PORT: String(port), CLAWSEMBLY_GATEWAY_TOKEN: token }
  });
  const writer = process.input.getWriter();
  let output = "";
  let pending = "";
  let signedDeviceId = "";
  const complete = process.output.pipeTo(new WritableStream({
    async write(chunk: string) {
      output += chunk;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("[device-challenge] ")) continue;
        const challenge = JSON.parse(line.slice("[device-challenge] ".length)) as {
          nonce: string;
          client: { id: string; mode: string; platform?: string; deviceFamily?: string };
          role: string;
          scopes: string[];
        };
        const signedAtMs = Date.now();
        const signatureVersion = "v3" as const;
        const device = await createDeviceConnectParams({
          clientId: challenge.client.id,
          clientMode: challenge.client.mode,
          role: challenge.role,
          scopes: challenge.scopes,
          signedAtMs,
          token,
          nonce: challenge.nonce,
          platform: challenge.client.platform,
          deviceFamily: challenge.client.deviceFamily
        }, signatureVersion);
        signedDeviceId = device.id;
        await writer.write(`${JSON.stringify({ device, signatureVersion })}\n`);
        await writer.close();
      }
    }
  }));
  const code = await process.exit;
  await complete;
  if (code !== 0) throw new Error(`browser-host device handshake exited with ${code}: ${cleanTerminal(output).trim()}`);
  const helloLine = cleanTerminal(output).split("\n").find((line) => line.startsWith("[device-hello] "));
  if (!helloLine) throw new Error(`browser-host device handshake returned no hello: ${output.trim()}`);
  const hello = JSON.parse(helloLine.slice("[device-hello] ".length)) as {
    protocol: number;
    serverVersion: string;
    signatureVersion: "v2" | "v3";
  };
  const identity = await runDeviceIdentityProbe();
  if (!signedDeviceId || signedDeviceId !== identity.deviceId || hello.protocol !== 4) {
    throw new Error("browser-host device identity did not match the Gateway handshake");
  }
  return { deviceId: identity.deviceId, ...hello };
}

async function verifyControlUiPairing(instance: WebContainer, port: number, token: string): Promise<{
  deviceId: string;
  protocol: number;
  serverVersion: string;
  deviceTokenIssued: true;
  deviceTokenEncryptedAtRest: true;
  deviceTokenReconnect: true;
  tokenPlaintextLogged: false;
}> {
  const process = await instance.spawn("node", ["adapter/gateway-control-ui-pairing-probe.mjs"], {
    env: { NO_COLOR: "1", CLAWSEMBLY_GATEWAY_PORT: String(port), CLAWSEMBLY_GATEWAY_TOKEN: token }
  });
  const writer = process.input.getWriter();
  let safeOutput = "";
  let pending = "";
  let signedDeviceId = "";
  let secretLineSeen = false;
  let receivedDeviceToken = "";
  const complete = process.output.pipeTo(new WritableStream({
    async write(chunk: string) {
      pending += cleanTerminal(chunk);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("[control-ui-pairing-challenge] ")) {
          const challenge = JSON.parse(line.slice("[control-ui-pairing-challenge] ".length)) as {
            nonce: string;
            client: { id: string; mode: string; platform?: string; deviceFamily?: string };
            role: string;
            scopes: string[];
          };
          const device = await createDeviceConnectParams({
            clientId: challenge.client.id,
            clientMode: challenge.client.mode,
            role: challenge.role,
            scopes: challenge.scopes,
            signedAtMs: Date.now(),
            token,
            nonce: challenge.nonce,
            platform: challenge.client.platform,
            deviceFamily: challenge.client.deviceFamily
          });
          signedDeviceId = device.id;
          await writer.write(`${JSON.stringify({ kind: "shared-token", device })}\n`);
          safeOutput += "[control-ui-pairing-challenge] browser-host signature supplied\n";
          continue;
        }
        if (line.startsWith("[device-token-challenge] ")) {
          const challenge = JSON.parse(line.slice("[device-token-challenge] ".length)) as {
            deviceToken: string;
            nonce: string;
            client: { id: string; mode: string; platform?: string; deviceFamily?: string };
            role: string;
            scopes: string[];
          };
          if (typeof challenge.deviceToken !== "string" || challenge.deviceToken.length < 16) {
            throw new Error("Gateway returned an invalid device token");
          }
          secretLineSeen = true;
          receivedDeviceToken = challenge.deviceToken;
          await storeProviderCredential("openclaw-device", challenge.deviceToken);
          const device = await withProviderCredential("openclaw-device", async (storedToken) => createDeviceConnectParams({
            clientId: challenge.client.id,
            clientMode: challenge.client.mode,
            role: challenge.role,
            scopes: challenge.scopes,
            signedAtMs: Date.now(),
            token: storedToken,
            nonce: challenge.nonce,
            platform: challenge.client.platform,
            deviceFamily: challenge.client.deviceFamily
          }));
          if (device.id !== signedDeviceId) throw new Error("paired device identity changed before token reconnect");
          await writer.write(`${JSON.stringify({ kind: "device-token", device })}\n`);
          await writer.close();
          safeOutput += "[device-token-challenge] encrypted by browser host; plaintext suppressed\n";
          continue;
        }
        safeOutput += `${line}\n`;
      }
    }
  }));
  const code = await process.exit;
  await complete;
  if (pending && !pending.startsWith("[device-token-challenge] ")) safeOutput += pending;
  if (code !== 0) throw new Error(`Control UI pairing probe exited with ${code}: ${safeOutput.trim()}`);
  const pairedLine = safeOutput.split("\n").find((line) => line.startsWith("[control-ui-paired] "));
  const reconnectLine = safeOutput.split("\n").find((line) => line.startsWith("[device-token-reconnect] "));
  if (!pairedLine || !reconnectLine || !secretLineSeen) throw new Error("Control UI pairing probe returned incomplete evidence");
  const paired = JSON.parse(pairedLine.slice("[control-ui-paired] ".length)) as {
    protocol: number;
    serverVersion: string;
    deviceTokenIssued: boolean;
  };
  const reconnected = JSON.parse(reconnectLine.slice("[device-token-reconnect] ".length)) as {
    protocol: number;
    authenticatedWith: string;
    result: string;
  };
  const metadata = await getCredentialMetadata("openclaw-device");
  const identity = await runDeviceIdentityProbe();
  if (!metadata || !receivedDeviceToken || safeOutput.includes(receivedDeviceToken)
    || !signedDeviceId || signedDeviceId !== identity.deviceId || paired.protocol !== 4
    || paired.deviceTokenIssued !== true || reconnected.protocol !== 4
    || reconnected.authenticatedWith !== "device-token" || reconnected.result !== "pass") {
    throw new Error("browser-host Control UI pairing evidence did not satisfy policy");
  }
  return {
    deviceId: identity.deviceId,
    protocol: paired.protocol,
    serverVersion: paired.serverVersion,
    deviceTokenIssued: true,
    deviceTokenEncryptedAtRest: true,
    deviceTokenReconnect: true,
    tokenPlaintextLogged: false
  };
}

export function setupRuntimeProbe(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-run-probe]");
  const installButton = document.querySelector<HTMLButtonElement>("[data-run-openclaw-probe]");
  const gatewayButton = document.querySelector<HTMLButtonElement>("[data-run-gateway-probe]");
  const installOutput = document.querySelector<HTMLElement>("[data-install-output]");
  const exportButton = document.querySelector<HTMLButtonElement>("[data-export-state]");
  const importInput = document.querySelector<HTMLInputElement>("[data-import-state]");
  const clearButton = document.querySelector<HTMLButtonElement>("[data-clear-state]");
  const storageStatus = document.querySelector<HTMLElement>("[data-storage-status]");
  const budgetRequestsInput = document.querySelector<HTMLInputElement>("[data-budget-requests]");
  const budgetInputCharsInput = document.querySelector<HTMLInputElement>("[data-budget-input]");
  const budgetOutputCharsInput = document.querySelector<HTMLInputElement>("[data-budget-output]");
  if (!button) return;

  const showStoredState = (snapshot: Uint8Array | undefined, message?: string) => {
    lastStateSnapshot = snapshot;
    if (exportButton) exportButton.disabled = !snapshot;
    if (storageStatus) storageStatus.textContent = message ?? (snapshot
      ? `Saved mock state: ${formatSnapshotSize(snapshot.byteLength)} · v1 verified · origin-private storage`
      : "No saved mock state");
  };

  loadStateSnapshot()
    .then((snapshot) => showStoredState(snapshot))
    .catch((error: unknown) => showStoredState(undefined, error instanceof Error ? error.message : "Unable to inspect saved state"));

  exportButton?.addEventListener("click", async () => {
    const openclawVersion = document.documentElement.dataset.openclawVersion ?? "unknown";
    const backup = await createStoredStateBackup(openclawVersion);
    if (!backup) return;
    const backupCopy = new Uint8Array(backup.byteLength);
    backupCopy.set(backup);
    const url = URL.createObjectURL(new Blob([backupCopy.buffer], { type: "application/vnd.clawsembly.backup" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clawsembly-mock-state-${openclawVersion}.clawsembly-backup`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const decoded = await importStateBackup(new Uint8Array(await file.arrayBuffer()));
      showStoredState(decoded.snapshot, `Imported v${decoded.manifest.version} mock state: ${formatSnapshotSize(decoded.snapshot.byteLength)} · OpenClaw ${decoded.manifest.openclawVersion}`);
    } catch (error: unknown) {
      showStoredState(lastStateSnapshot, error instanceof Error ? error.message : "State import failed");
    } finally {
      importInput.value = "";
    }
  });

  clearButton?.addEventListener("click", async () => {
    try {
      await removeStateSnapshot();
      showStoredState(undefined);
    } catch (error: unknown) {
      showStoredState(lastStateSnapshot, error instanceof Error ? error.message : "Unable to clear saved state");
    }
  });

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Running preflight…";

    const isolated = window.crossOriginIsolated;
    const hasSharedMemory = typeof SharedArrayBuffer !== "undefined";
    updateLine(0, isolated ? "pass" : "fail", String(isolated));
    updateLine(1, hasSharedMemory ? "pass" : "fail", hasSharedMemory ? "available" : "unavailable");

    if (!isolated || !hasSharedMemory) {
      updateLine(2, "fail", "host headers required");
      updateLine(3, "fail", "not attempted");
      updateLine(4, "fail", "not attempted");
      button.textContent = "Host is not isolated";
      return;
    }

    try {
      activeContainer?.teardown();
      activeContainer = undefined;
      if (installButton) installButton.disabled = true;
      if (gatewayButton) gatewayButton.disabled = true;
      updateLine(2, "running", "booting…");
      const { WebContainer } = await import("@webcontainer/api");
      activeContainer = await WebContainer.boot({ coep: "credentialless" });
      const savedSnapshot = await loadStateSnapshot();
      if (savedSnapshot) {
        await activeContainer.fs.mkdir(".clawsembly-openclaw", { recursive: true });
        await activeContainer.mount(savedSnapshot, { mountPoint: ".clawsembly-openclaw" });
        showStoredState(savedSnapshot, `Mounted saved mock state: ${formatSnapshotSize(savedSnapshot.byteLength)}`);
      }
      updateLine(2, "pass", "ready");
      updateLine(3, "running", "spawning…");
      const result = await readProcessOutput(activeContainer);
      if (result.code !== 0 || !result.output.startsWith("v")) {
        throw new Error(result.output || `node exited with ${result.code}`);
      }
      updateLine(3, "pass", result.output);
      updateLine(4, "running", "probing…");
      const sqlite = await readSqliteCapability(activeContainer);
      const sqliteCompatible = sqlite.close === "function" && sqlite.exec === "function" && sqlite.prepare === "function";
      updateLine(4, sqliteCompatible ? "pass" : "fail", `close=${sqlite.close}; exec=${sqlite.exec}; prepare=${sqlite.prepare}`);
      button.textContent = "Probe complete";
      if (installButton) {
        installButton.disabled = false;
        installButton.textContent = "Install pinned OpenClaw";
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "unknown boot error";
      updateLine(2, "fail", detail.slice(0, 80));
      updateLine(3, "fail", "not available");
      updateLine(4, "fail", "not available");
      button.textContent = "Probe failed";
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = "Run again";
      }, 1800);
    }
  });

  installButton?.addEventListener("click", async () => {
    if (!activeContainer || !installOutput) return;
    const version = document.documentElement.dataset.openclawVersion;
    if (!version) return;

    installButton.disabled = true;
    installButton.textContent = "Installing…";
    lastInstallPerformance = undefined;
    installOutput.hidden = false;
    installOutput.textContent = `$ npm install openclaw@${version}\n`;

    try {
      await activeContainer.mount({
        "package.json": {
          file: {
            contents: JSON.stringify({
              name: "clawsembly-probe",
              private: true,
              dependencies: { openclaw: version, "sql.js": "1.14.1", "@noble/curves": "2.2.0", "ws": "8.21.0" }
            }, null, 2)
          }
        },
        adapter: {
          directory: {
            "node-sqlite-polyfill.mjs": { file: { contents: sqlitePolyfillSource } },
            "ed25519-verify-adapter.mjs": { file: { contents: ed25519VerifyAdapterSource } },
            "openclaw-ed25519-source-patch.mjs": { file: { contents: openclawEd25519SourcePatch } },
            "openclaw-bootstrap.mjs": { file: { contents: openclawBootstrapSource } },
            "mock-openai-server.mjs": { file: { contents: mockOpenAiServerSource } },
            "gateway-lifecycle-probe.mjs": { file: { contents: gatewayLifecycleProbeSource } },
            "gateway-device-identity-probe.mjs": { file: { contents: gatewayDeviceIdentityProbeSource } },
            "gateway-control-ui-pairing-probe.mjs": { file: { contents: gatewayControlUiPairingProbeSource } },
            "host-broker-openai-server.mjs": { file: { contents: hostBrokerOpenAiServerSource } },
            "gateway-host-broker-turn-probe.mjs": { file: { contents: gatewayHostBrokerTurnProbeSource } },
            "measure-install-footprint.mjs": { file: { contents: measureInstallFootprintSource } }
          }
        }
      });
      const coldInstallStarted = performance.now();
      const coldRootInstallStarted = performance.now();
      const install = await activeContainer.spawn(
        "npm",
        ["install", "--no-audit", "--no-fund", "--no-progress", "--loglevel", "warn"],
        { env: { CI: "1", NO_COLOR: "1" } }
      );
      const outputComplete = install.output.pipeTo(new WritableStream({
        write(chunk: string) { appendOutput(installOutput, chunk); }
      }));
      const exitCode = await install.exit;
      await outputComplete;
      if (exitCode !== 0) throw new Error(`npm install exited with ${exitCode}`);
      const coldRootInstallMs = Math.round(performance.now() - coldRootInstallStarted);

      const installedManifest = JSON.parse(await activeContainer.fs.readFile("node_modules/openclaw/package.json", "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const declaredDependencies = Object.keys(installedManifest.dependencies ?? {});
      let nestedDependencies: string[] = [];
      try {
        nestedDependencies = await activeContainer.fs.readdir("node_modules/openclaw/node_modules");
      } catch {
        nestedDependencies = [];
      }
      appendOutput(
        installOutput,
        `\n[dependency-tree] ${declaredDependencies.length} declared; ${nestedDependencies.length} nested entries installed\n`
      );

      let nestedRepairMs = 0;
      if (declaredDependencies.includes("json5") && !nestedDependencies.includes("json5")) {
        appendOutput(
          installOutput,
          "[adapter] WebContainer npm omitted the published nested dependency tree; installing the pinned package prefix explicitly.\n"
        );
        const repairStarted = performance.now();
        const repair = await activeContainer.spawn(
          "npm",
          [
            "install",
            "--prefix",
            "node_modules/openclaw",
            "--omit=dev",
            "--omit=optional",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--no-progress",
            "--loglevel",
            "warn"
          ],
          { env: { CI: "1", NO_COLOR: "1" } }
        );
        const repairComplete = repair.output.pipeTo(new WritableStream({
          write(chunk: string) { appendOutput(installOutput, chunk); }
        }));
        const repairExit = await repair.exit;
        await repairComplete;
        if (repairExit !== 0) throw new Error(`nested dependency install exited with ${repairExit}`);
        nestedRepairMs = Math.round(performance.now() - repairStarted);
      }
      const coldTotalMs = Math.round(performance.now() - coldInstallStarted);

      appendOutput(installOutput, "\n$ npm install # warm-cache measurement\n");
      const warmInstallStarted = performance.now();
      const warmInstall = await activeContainer.spawn(
        "npm",
        ["install", "--no-audit", "--no-fund", "--no-progress", "--loglevel", "error"],
        { env: { CI: "1", NO_COLOR: "1" } }
      );
      let warmOutput = "";
      const warmComplete = warmInstall.output.pipeTo(new WritableStream({ write(chunk: string) { warmOutput += chunk; } }));
      const warmExit = await warmInstall.exit;
      await warmComplete;
      if (warmExit !== 0) throw new Error(`warm npm install exited with ${warmExit}: ${cleanTerminal(warmOutput).trim()}`);
      const warmInstallMs = Math.round(performance.now() - warmInstallStarted);

      const footprint = await runTransientProcessProbe(
        activeContainer,
        "node",
        ["adapter/measure-install-footprint.mjs"]
      );
      const footprintLine = cleanTerminal(footprint.output).trim().split("\n").find((line) => line.startsWith("{"));
      if (footprint.code !== 0 || !footprintLine) throw new Error(`install footprint measurement failed: ${footprint.output.trim()}`);
      const measured = JSON.parse(footprintLine) as {
        nodeModules: InstallPerformanceEvidence["nodeModules"];
        npmCache: InstallPerformanceEvidence["npmCache"];
      };
      lastInstallPerformance = {
        coldRootInstallMs,
        nestedRepairMs,
        coldTotalMs,
        warmInstallMs,
        nodeModules: measured.nodeModules,
        npmCache: measured.npmCache
      };
      appendOutput(installOutput, `[install-performance] ${JSON.stringify(lastInstallPerformance)}\n`);

      appendOutput(installOutput, "\n$ npx --no-install openclaw --version\n");
      const versionCheck = await activeContainer.spawn("npx", ["--no-install", "openclaw", "--version"]);
      let cliOutput = "";
      const cliComplete = versionCheck.output.pipeTo(new WritableStream({ write(chunk: string) { cliOutput += chunk; } }));
      const cliExit = await versionCheck.exit;
      await cliComplete;
      appendOutput(installOutput, cliOutput);
      if (cliExit !== 0) throw new Error(`OpenClaw version check exited with ${cliExit}`);
      const identityPatch = await activeContainer.spawn("node", ["adapter/openclaw-ed25519-source-patch.mjs"]);
      let identityPatchOutput = "";
      const identityPatchComplete = identityPatch.output.pipeTo(new WritableStream({
        write(chunk: string) { identityPatchOutput += chunk; }
      }));
      const identityPatchExit = await identityPatch.exit;
      await identityPatchComplete;
      appendOutput(installOutput, `[source-patch] ${identityPatchOutput.trim()}\n`);
      if (identityPatchExit !== 0) throw new Error("Ed25519 source patch failed");
      installButton.textContent = "Install probe passed";
      if (gatewayButton) {
        gatewayButton.disabled = false;
        gatewayButton.textContent = "Run lifecycle probe";
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "unknown install error";
      appendOutput(installOutput, `\n[probe failed] ${detail}\n`);
      installButton.textContent = "Install probe failed";
    } finally {
      window.setTimeout(() => { installButton.disabled = false; }, 1800);
    }
  });

  gatewayButton?.addEventListener("click", async () => {
    if (!activeContainer || !installOutput) return;
    gatewayButton.disabled = true;
    gatewayButton.textContent = "Starting Gateway…";
    const readBudget = (input: HTMLInputElement | null, fallback: number) => {
      const value = Number(input?.value ?? fallback);
      return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    };
    const brokerBudgetLimits = {
      maxRequests: readBudget(budgetRequestsInput, 4),
      maxInputChars: readBudget(budgetInputCharsInput, 100_000),
      maxOutputChars: readBudget(budgetOutputCharsInput, 100_000)
    };
    for (const input of [budgetRequestsInput, budgetInputCharsInput, budgetOutputCharsInput]) {
      if (input) input.disabled = true;
    }
    appendOutput(
      installOutput,
      "\n$ node adapter/openclaw-bootstrap.mjs --dev gateway --allow-unconfigured --token <ephemeral-probe-token>\n"
    );

    let unsubscribe: (() => void) | undefined;
    let gateway: WebContainerProcess | undefined;
    let outputComplete: Promise<void> | undefined;
    let mockProvider: WebContainerProcess | undefined;
    let mockOutputComplete: Promise<void> | undefined;
    let hostBrokerProvider: WebContainerProcess | undefined;
    let hostBrokerOutputComplete: Promise<void> | undefined;
    let gatewayPortReadyMs = 0;
    let gatewayProtocolReadyMs = 0;
    let recoveryCompleted = false;
    try {
      const installPerformance = lastInstallPerformance;
      if (!installPerformance) throw new Error("install performance evidence is unavailable");
      const brokerProbeSecret = `sk-clawsembly-host-broker-${crypto.randomUUID()}`;
      await storeProviderCredential("broker-probe", brokerProbeSecret);
      const config = {
        gateway: {
          controlUi: { allowedOrigins: ["http://127.0.0.1:19001", "http://localhost:19001"] }
        },
        agents: {
          defaults: { model: { primary: "clawsembly-mock/mock-v1" }, skipBootstrap: true },
          list: [
            { id: "main", default: true, workspace: "~/.openclaw/workspace-dev" },
            {
              id: "broker",
              workspace: "~/.openclaw/workspace-broker",
              model: "clawsembly-browser-host/broker-v1"
            }
          ]
        },
        models: {
          mode: "merge",
          providers: {
            "clawsembly-mock": {
              baseUrl: "http://127.0.0.1:19002/v1",
              apiKey: "clawsembly-local",
              api: "openai-completions",
              models: [{
                id: "mock-v1",
                name: "Clawsembly deterministic mock",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 120_000,
                maxTokens: 8_192
              }]
            },
            "clawsembly-browser-host": {
              baseUrl: "http://127.0.0.1:19003/v1",
              apiKey: HOST_BROKER_CAPABILITY,
              api: "openai-completions",
              models: [{
                id: "broker-v1",
                name: "Clawsembly browser-host Responses bridge",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 120_000,
                maxTokens: 8_192
              }]
            }
          }
        },
        tools: { allow: ["agents_list"] }
      };
      await activeContainer.fs.mkdir(".clawsembly-openclaw", { recursive: true });
      await activeContainer.fs.writeFile(
        ".clawsembly-openclaw/openclaw.json",
        JSON.stringify(config, null, 2)
      );

      let resolveMockReady: (() => void) | undefined;
      const mockReady = new Promise<void>((resolve) => { resolveMockReady = resolve; });
      mockProvider = await activeContainer.spawn("node", ["adapter/mock-openai-server.mjs"], {
        env: { NO_COLOR: "1", CLAWSEMBLY_MOCK_PORT: "19002" }
      });
      mockOutputComplete = mockProvider.output.pipeTo(new WritableStream({
        write(chunk: string) {
          appendOutput(installOutput, `[mock-provider] ${chunk}`);
          if (chunk.includes('"event":"ready"')) resolveMockReady?.();
        }
      }));
      const mockOutcome = await Promise.race([
        mockReady.then(() => "ready" as const),
        mockProvider.exit.then(() => "exit" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 5_000))
      ]);
      if (mockOutcome !== "ready") throw new Error(`mock provider did not start (${mockOutcome})`);

      let resolveHostBrokerReady: (() => void) | undefined;
      const hostBrokerReady = new Promise<void>((resolve) => { resolveHostBrokerReady = resolve; });
      let hostBrokerPending = "";
      let brokerRequestCount = 0;
      let brokerPolicyPassCount = 0;
      let brokerStreamDeltaCount = 0;
      let brokerCompletedCount = 0;
      let brokerToolCallCount = 0;
      let brokerToolResultRequestCount = 0;
      let brokerHostCancelCount = 0;
      let brokerProviderCancelCount = 0;
      let brokerCancellationPropagated = 0;
      const brokerBudget = new ProviderBudgetTracker({
        ...brokerBudgetLimits
      });
      const brokerControllers = new Map<string, AbortController>();
      const brokerTaskHistory: Promise<void>[] = [];
      hostBrokerProvider = await activeContainer.spawn("node", ["adapter/host-broker-openai-server.mjs"], {
        env: {
          NO_COLOR: "1",
          CLAWSEMBLY_HOST_BROKER_PORT: "19003",
          CLAWSEMBLY_HOST_BROKER_CAPABILITY: HOST_BROKER_CAPABILITY,
          CLAWSEMBLY_HOST_BROKER_MAX_REQUESTS: "4"
        }
      });
      const hostBrokerWriter = hostBrokerProvider.input.getWriter();
      let hostBrokerWriteChain = Promise.resolve();
      const sendHostBrokerMessage = (message: unknown) => {
        hostBrokerWriteChain = hostBrokerWriteChain.then(() => hostBrokerWriter.write(`${JSON.stringify(message)}\n`));
        return hostBrokerWriteChain;
      };
      hostBrokerOutputComplete = hostBrokerProvider.output.pipeTo(new WritableStream({
        write(chunk: string) {
          hostBrokerPending += cleanTerminal(chunk);
          const lines = hostBrokerPending.split("\n");
          hostBrokerPending = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("[host-broker-ready] ")) {
              resolveHostBrokerReady?.();
              appendOutput(installOutput, `${line}\n`);
              continue;
            }
            if (line.startsWith("[host-broker-cancel] ")) {
              const cancellation = JSON.parse(line.slice("[host-broker-cancel] ".length)) as { id?: string };
              const controller = cancellation.id ? brokerControllers.get(cancellation.id) : undefined;
              if (controller && !controller.signal.aborted) {
                brokerHostCancelCount += 1;
                controller.abort();
              }
              appendOutput(installOutput, "[host-broker-cancel] provider AbortSignal triggered\n");
              continue;
            }
            if (!line.startsWith("[host-broker-request] ")) {
              if (line.trim()) appendOutput(installOutput, `[host-broker-process] ${line}\n`);
              continue;
            }
            const request = JSON.parse(line.slice("[host-broker-request] ".length)) as {
              id: string;
              model: string;
              input: OpenAIResponseInput;
              stream: boolean;
              tools: OpenAIFunctionTool[];
              hasToolResult: boolean;
            };
            brokerRequestCount += 1;
            const controller = new AbortController();
            brokerControllers.set(request.id, controller);
            const task = (async () => {
              try {
                if (request.model !== "broker-v1" || request.stream !== true
                  || !Array.isArray(request.tools) || request.tools.length !== 1
                  || request.tools[0]?.name !== "agents_list" || request.tools[0]?.strict !== true) {
                  throw new Error("unapproved bridge request");
                }
                const serializedInput = typeof request.input === "string" ? request.input : JSON.stringify(request.input);
                const isCancellationProbe = serializedInput.includes("BROKER_CANCEL_ME");
                if (request.hasToolResult) brokerToolResultRequestCount += 1;
                const fakeFetch: typeof fetch = async (input, init) => {
                  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
                  const headers = new Headers(init?.headers);
                  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                  const outboundTools = body.tools as Array<{ name?: unknown }> | undefined;
                  const outboundInput = body.input as OpenAIResponseInput;
                  const outboundItems = Array.isArray(outboundInput) ? outboundInput : [];
                  const outboundFunctionCalls = outboundItems.filter(
                    (item) => "type" in item && item.type === "function_call"
                  );
                  const outboundFunctionOutputs = outboundItems.filter(
                    (item) => "type" in item && item.type === "function_call_output"
                  );
                  const exactToolPairs = outboundFunctionOutputs.every((output) => output.type === "function_call_output"
                    && outboundFunctionCalls.some((call) => call.type === "function_call"
                      && call.call_id === output.call_id));
                  const lastUserIndex = outboundItems.findLastIndex((item) => "role" in item && item.role === "user");
                  const lastFunctionOutputIndex = outboundItems.findLastIndex(
                    (item) => "type" in item && item.type === "function_call_output"
                  );
                  const currentToolContinuation = lastFunctionOutputIndex > lastUserIndex;
                  const policyPassed = headers.get("authorization") === `Bearer ${brokerProbeSecret}`
                    && url === OPENAI_RESPONSES_ENDPOINT
                    && init?.method === "POST"
                    && init.redirect === "error"
                    && init.credentials === "omit"
                    && init.referrerPolicy === "no-referrer"
                    && body.model === OPENAI_BROKER_MODEL
                    && body.store === false
                    && body.stream === true
                    && Array.isArray(outboundTools)
                    && outboundTools.length === 1
                    && outboundTools[0]?.name === "agents_list"
                    && Array.isArray(outboundInput)
                    && exactToolPairs
                    && currentToolContinuation === request.hasToolResult;
                  if (!policyPassed) throw new Error("browser host broker policy mismatch");
                  brokerPolicyPassCount += 1;
                  const encoder = new TextEncoder();
                  const encodeEvent = (event: Record<string, unknown>) => encoder.encode(
                    `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`
                  );
                  return new Response(new ReadableStream<Uint8Array>({
                    start(streamController) {
                      streamController.enqueue(encodeEvent({ type: "response.created", response: { status: "in_progress" } }));
                      if (isCancellationProbe) {
                        streamController.enqueue(encodeEvent({ type: "response.output_text.delta", delta: "Broker cancellation started." }));
                        return;
                      }
                      if (!request.hasToolResult) {
                        const item = {
                          type: "function_call",
                          id: "fc_clawsembly_agents",
                          call_id: "call_clawsembly_broker_agents",
                          name: "agents_list",
                          arguments: ""
                        };
                        streamController.enqueue(encodeEvent({ type: "response.output_item.added", item }));
                        streamController.enqueue(encodeEvent({
                          type: "response.function_call_arguments.delta",
                          item_id: item.id,
                          delta: "{}"
                        }));
                        streamController.enqueue(encodeEvent({
                          type: "response.function_call_arguments.done",
                          item_id: item.id,
                          arguments: "{}"
                        }));
                        streamController.enqueue(encodeEvent({ type: "response.completed", response: { status: "completed" } }));
                        streamController.close();
                        return;
                      }
                      streamController.enqueue(encodeEvent({ type: "response.output_text.delta", delta: "Clawsembly browser-host " }));
                      streamController.enqueue(encodeEvent({ type: "response.output_text.delta", delta: "broker tool round-trip passed." }));
                      streamController.enqueue(encodeEvent({ type: "response.completed", response: { status: "completed" } }));
                      streamController.close();
                    },
                    cancel() { brokerProviderCancelCount += 1; }
                  }), {
                    status: 200,
                    headers: { "content-type": "text/event-stream", "x-request-id": "req_host_broker_probe" }
                  });
                };
                await streamOpenAIResponseWithTransport(
                  { model: OPENAI_BROKER_MODEL, input: request.input, tools: request.tools },
                  fakeFetch,
                  "broker-probe",
                  {
                    onTextDelta: async (delta) => {
                      brokerStreamDeltaCount += 1;
                      await sendHostBrokerMessage({ id: request.id, event: "delta", delta });
                    },
                    onFunctionCall: async (call) => {
                      brokerToolCallCount += 1;
                      await sendHostBrokerMessage({ id: request.id, event: "tool_call", ...call });
                    }
                  },
                  controller.signal,
                  brokerBudget
                );
                brokerCompletedCount += 1;
                await sendHostBrokerMessage({ id: request.id, event: "done" });
                appendOutput(installOutput, `[host-broker-request] ${JSON.stringify({
                  modelAlias: request.model,
                  hostModel: OPENAI_BROKER_MODEL,
                  inputChars: serializedInput.length,
                  streaming: true,
                  credentialInWebContainer: false,
                  result: "pass"
                })}\n`);
              } catch {
                if (controller.signal.aborted) brokerCancellationPropagated += 1;
                await sendHostBrokerMessage({ id: request.id, event: "error" }).catch(() => undefined);
                if (!controller.signal.aborted) appendOutput(installOutput, "[host-broker-request] rejected by browser-host policy\n");
              } finally {
                brokerControllers.delete(request.id);
              }
            })();
            brokerTaskHistory.push(task);
          }
        }
      }));
      const hostBrokerOutcome = await Promise.race([
        hostBrokerReady.then(() => "ready" as const),
        hostBrokerProvider.exit.then(() => "exit" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 5_000))
      ]);
      if (hostBrokerOutcome !== "ready") throw new Error(`browser-host provider bridge did not start (${hostBrokerOutcome})`);

      const serverReady = new Promise<{ port: number; url: string }>((resolve) => {
        unsubscribe = activeContainer?.on("server-ready", (port, url) => resolve({ port, url }));
      });
      let resolveGatewayReady: (() => void) | undefined;
      const gatewayReady = new Promise<void>((resolve) => { resolveGatewayReady = resolve; });
      let gatewayLogTail = "";
      const gatewayStarted = performance.now();
      gateway = await activeContainer.spawn(
        "node",
        [
          "adapter/openclaw-bootstrap.mjs",
          "--dev",
          "gateway",
          "--allow-unconfigured",
          "--token",
          GATEWAY_PROBE_TOKEN
        ],
        {
          env: {
            CI: "1",
            NO_COLOR: "1",
            OPENCLAW_SKIP_CHANNELS: "1",
            OPENCLAW_STATE_DIR: ".clawsembly-openclaw"
          }
        }
      );
      outputComplete = gateway.output.pipeTo(new WritableStream({
        write(chunk: string) {
          appendOutput(installOutput, chunk);
          gatewayLogTail = `${gatewayLogTail}${cleanTerminal(chunk)}`.slice(-2_000);
          if (gatewayLogTail.includes("[gateway] ready")) resolveGatewayReady?.();
        }
      }));
      const outcome = await Promise.race([
        serverReady.then((ready) => ({ kind: "ready" as const, ready })),
        gateway.exit.then((code) => ({ kind: "exit" as const, code })),
        new Promise<{ kind: "timeout" }>((resolve) => window.setTimeout(() => resolve({ kind: "timeout" }), 40_000))
      ]);

      if (outcome.kind === "exit") throw new Error(`Gateway exited before readiness with ${outcome.code}`);
      if (outcome.kind === "timeout") throw new Error("Gateway did not open a port within 40 seconds");
      gatewayPortReadyMs = Math.round(performance.now() - gatewayStarted);

      appendOutput(installOutput, `\n[server-ready] ${outcome.ready.url} (port ${outcome.ready.port})\n`);
      const healthScript = [
        `const url = "http://127.0.0.1:${outcome.ready.port}/healthz"`,
        "let lastError = 'not ready'",
        "for (let attempt = 0; attempt < 20; attempt += 1) {",
        "  try {",
        "    const response = await fetch(url)",
        "    const body = await response.text()",
        "    if (response.ok) { console.log(JSON.stringify({ status: response.status, body })); process.exit(0) }",
        "    lastError = `HTTP ${response.status}`",
        "  } catch (error) { lastError = error instanceof Error ? error.message : String(error) }",
        "  await new Promise((resolve) => setTimeout(resolve, 1000))",
        "}",
        "console.error(lastError)",
        "process.exit(1)"
      ].join("\n");
      const health = await runTransientProcessProbe(activeContainer, "node", ["--input-type=module", "-e", healthScript]);
      appendOutput(installOutput, `[healthz] ${health.output.trim()}${health.attempts > 1 ? ` [attempts=${health.attempts}]` : ""}\n`);
      if (health.code !== 0) throw new Error("internal /healthz probe failed");

      const readinessScript = [
        `const url = "http://127.0.0.1:${outcome.ready.port}/readyz"`,
        "let lastError = 'not ready'",
        "for (let attempt = 0; attempt < 60; attempt += 1) {",
        "  try {",
        "    const response = await fetch(url)",
        "    const body = await response.text()",
        "    if (response.ok) { console.log(JSON.stringify({ status: response.status, body })); process.exit(0) }",
        "    lastError = `HTTP ${response.status}: ${body}`",
        "  } catch (error) { lastError = error instanceof Error ? error.message : String(error) }",
        "  await new Promise((resolve) => setTimeout(resolve, 500))",
        "}",
        "console.error(lastError)",
        "process.exit(1)"
      ].join("\n");
      const readiness = await runTransientProcessProbe(activeContainer, "node", ["--input-type=module", "-e", readinessScript]);
      appendOutput(installOutput, `[readyz] ${readiness.output.trim()}${readiness.attempts > 1 ? ` [attempts=${readiness.attempts}]` : ""}\n`);
      if (readiness.code !== 0) throw new Error("internal /readyz probe failed");

      const fullyReady = await Promise.race([
        gatewayReady.then(() => "ready" as const),
        gateway.exit.then(() => "exit" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 30_000))
      ]);
      if (fullyReady !== "ready") throw new Error(`Gateway did not reach protocol readiness (${fullyReady})`);
      gatewayProtocolReadyMs = Math.round(performance.now() - gatewayStarted);
      appendOutput(installOutput, "[gateway-ready] protocol services available\n");

      const deviceHandshake = await verifyBrowserDeviceHandshake(activeContainer, outcome.ready.port, GATEWAY_PROBE_TOKEN);
      appendOutput(installOutput, `[device-handshake] ${JSON.stringify({
        deviceId: deviceHandshake.deviceId,
        protocol: deviceHandshake.protocol,
        serverVersion: deviceHandshake.serverVersion,
        signatureVersion: deviceHandshake.signatureVersion,
        privateKeyInWebContainer: false,
        result: "pass"
      })}\n`);

      const pairing = await verifyControlUiPairing(activeContainer, outcome.ready.port, GATEWAY_PROBE_TOKEN);
      appendOutput(installOutput, `[device-pairing] ${JSON.stringify({
        deviceId: pairing.deviceId,
        protocol: pairing.protocol,
        serverVersion: pairing.serverVersion,
        deviceTokenIssued: pairing.deviceTokenIssued,
        deviceTokenEncryptedAtRest: pairing.deviceTokenEncryptedAtRest,
        deviceTokenReconnect: pairing.deviceTokenReconnect,
        tokenPlaintextLogged: pairing.tokenPlaintextLogged,
        result: "pass"
      })}\n`);
      window.dispatchEvent(new CustomEvent("clawsembly:device-token-stored"));

      const brokerTurn = await activeContainer.spawn("node", ["adapter/gateway-host-broker-turn-probe.mjs"], {
        env: {
          NO_COLOR: "1",
          CLAWSEMBLY_GATEWAY_PORT: String(outcome.ready.port),
          CLAWSEMBLY_GATEWAY_TOKEN: GATEWAY_PROBE_TOKEN
        }
      });
      let brokerTurnOutput = "";
      let brokerTurnPending = "";
      const brokerTurnComplete = brokerTurn.output.pipeTo(new WritableStream({
        write(chunk: string) {
          const cleaned = cleanTerminal(chunk);
          brokerTurnOutput += cleaned;
          brokerTurnPending += cleaned;
          const lines = brokerTurnPending.split("\n");
          brokerTurnPending = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("[host-broker-abort] ")) continue;
            const activeController = [...brokerControllers.values()].find((controller) => !controller.signal.aborted);
            if (!activeController) continue;
            brokerHostCancelCount += 1;
            activeController.abort();
            appendOutput(installOutput, "[host-broker-cancel] provider AbortSignal triggered\n");
          }
        }
      }));
      const brokerTurnExit = await brokerTurn.exit;
      await brokerTurnComplete;
      await Promise.all(brokerTaskHistory);
      await hostBrokerWriteChain;
      const brokerBudgetSnapshot = brokerBudget.snapshot();
      const brokerTurnLine = cleanTerminal(brokerTurnOutput).trim().split("\n").find((line) => line.startsWith("{"));
      if (brokerTurnExit !== 0 || !brokerTurnLine) throw new Error(`browser-host broker turn failed: ${cleanTerminal(brokerTurnOutput).trim()}`);
      const brokerTurnResult = JSON.parse(brokerTurnLine) as {
        event?: string;
        state?: string;
        streaming?: boolean;
        deltaObserved?: boolean;
        toolRoundTrip?: boolean;
        cancellation?: boolean;
        abortRpc?: boolean;
        result?: string;
      };
      if (brokerTurnResult.event !== "host-broker-turn" || brokerTurnResult.state !== "final"
        || brokerTurnResult.streaming !== true || brokerTurnResult.deltaObserved !== true
        || brokerTurnResult.toolRoundTrip !== true
        || brokerTurnResult.cancellation !== true || brokerTurnResult.abortRpc !== true
        || brokerTurnResult.result !== "pass" || brokerRequestCount !== 3
        || brokerPolicyPassCount !== 3 || brokerCompletedCount !== 2
        || brokerToolCallCount !== 1 || brokerToolResultRequestCount !== 1
        || brokerStreamDeltaCount < 3 || brokerHostCancelCount !== 1
        || brokerProviderCancelCount !== 1 || brokerCancellationPropagated !== 1
        || brokerBudgetSnapshot.requestsUsed !== 3
        || brokerBudgetSnapshot.inputCharsUsed <= 0
        || brokerBudgetSnapshot.inputCharsUsed > brokerBudgetSnapshot.maxInputChars
        || brokerBudgetSnapshot.outputCharsUsed <= 0
        || brokerBudgetSnapshot.outputCharsUsed > brokerBudgetSnapshot.maxOutputChars
        || (installOutput.textContent ?? "").includes(brokerProbeSecret)) {
        throw new Error("browser-host broker turn evidence did not satisfy policy");
      }
      appendOutput(installOutput, `[host-broker-turn] ${JSON.stringify({
        openclawAgent: "broker",
        providerAlias: "clawsembly-browser-host/broker-v1",
        hostModel: OPENAI_BROKER_MODEL,
        endpoint: OPENAI_RESPONSES_ENDPOINT,
        store: false,
        streaming: true,
        typedDeltas: true,
        toolRoundTrip: true,
        responsesFunctionResultInput: true,
        budget: brokerBudgetSnapshot,
        cancellationPropagated: true,
        credentialInWebContainer: false,
        credentialPlaintextLogged: false,
        responseReachedOpenClaw: true,
        result: "pass"
      })}\n`);
      await removeProviderCredential("broker-probe");

      const lifecycle = await activeContainer.spawn("node", ["adapter/gateway-lifecycle-probe.mjs"], {
        env: {
          NO_COLOR: "1",
          CLAWSEMBLY_GATEWAY_PORT: String(outcome.ready.port),
          CLAWSEMBLY_GATEWAY_TOKEN: GATEWAY_PROBE_TOKEN
        }
      });
      let lifecycleOutput = "";
      const lifecycleComplete = lifecycle.output.pipeTo(new WritableStream({
        write(chunk: string) { lifecycleOutput += chunk; }
      }));
      const lifecycleExit = await lifecycle.exit;
      await lifecycleComplete;
      appendOutput(installOutput, `[lifecycle] ${lifecycleOutput.trim()}\n`);
      if (lifecycleExit !== 0) throw new Error("Gateway lifecycle probe failed");

      gatewayButton.textContent = "Persisting state…";
      if (gateway) {
        try { gateway.kill(); } catch { /* Process may already be closed. */ }
        await gateway.exit.catch(() => undefined);
        await outputComplete?.catch(() => undefined);
        gateway = undefined;
        outputComplete = undefined;
      }
      if (mockProvider) {
        try { mockProvider.kill(); } catch { /* Process may already be closed. */ }
        await mockProvider.exit.catch(() => undefined);
        await mockOutputComplete?.catch(() => undefined);
        mockProvider = undefined;
        mockOutputComplete = undefined;
      }
      if (hostBrokerProvider) {
        try { hostBrokerProvider.kill(); } catch { /* Process may already be closed. */ }
        await hostBrokerProvider.exit.catch(() => undefined);
        await hostBrokerOutputComplete?.catch(() => undefined);
        hostBrokerProvider = undefined;
        hostBrokerOutputComplete = undefined;
      }
      unsubscribe?.();
      unsubscribe = undefined;

      const snapshot = await exportStateSnapshot(activeContainer);
      const openclawVersion = document.documentElement.dataset.openclawVersion ?? "unknown";
      await persistStateSnapshot(snapshot, openclawVersion);
      const storedBackup = await createStoredStateBackup(openclawVersion);
      if (!storedBackup) throw new Error("versioned state backup was not persisted");
      const verifiedBackup = await decodeStateBackup(storedBackup);
      const backupGuards = await verifyStateBackupGuards(storedBackup);
      showStoredState(snapshot);
      activeContainer.teardown();
      activeContainer = undefined;

      const { WebContainer } = await import("@webcontainer/api");
      const recoveredContainer = await WebContainer.boot({ coep: "credentialless" });
      await recoveredContainer.fs.mkdir(".clawsembly-openclaw", { recursive: true });
      const recoveredSnapshot = await loadStateSnapshot();
      if (!recoveredSnapshot) throw new Error("OPFS snapshot disappeared before recovery");
      await recoveredContainer.mount(recoveredSnapshot, { mountPoint: ".clawsembly-openclaw" });
      const recovery = await verifyRecoveredTranscript(recoveredContainer);
      activeContainer = recoveredContainer;
      appendOutput(installOutput, `[opfs-recovery] ${JSON.stringify({
        snapshotBytes: snapshot.byteLength,
        backupVersion: verifiedBackup.manifest.version,
        integrity: "sha256",
        ...backupGuards,
        ...recovery,
        runtimeRestart: true,
        result: "pass"
      })}\n`);
      appendOutput(installOutput, `[runtime-performance] ${JSON.stringify({
        ...installPerformance,
        gatewayPortReadyMs,
        gatewayProtocolReadyMs,
        result: "pass"
      })}\n`);
      recoveryCompleted = true;
      gatewayButton.textContent = "Runtime + recovery passed";
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "unknown Gateway error";
      appendOutput(installOutput, `\n[probe failed] ${detail}\n`);
      gatewayButton.textContent = "Gateway probe failed";
    } finally {
      for (const input of [budgetRequestsInput, budgetInputCharsInput, budgetOutputCharsInput]) {
        if (input) input.disabled = false;
      }
      if (gateway) {
        try { gateway.kill(); } catch { /* Process may already be closed. */ }
        await gateway.exit.catch(() => undefined);
        await outputComplete?.catch(() => undefined);
      }
      if (mockProvider) {
        try { mockProvider.kill(); } catch { /* Process may already be closed. */ }
        await mockProvider.exit.catch(() => undefined);
        await mockOutputComplete?.catch(() => undefined);
      }
      if (hostBrokerProvider) {
        try { hostBrokerProvider.kill(); } catch { /* Process may already be closed. */ }
        await hostBrokerProvider.exit.catch(() => undefined);
        await hostBrokerOutputComplete?.catch(() => undefined);
      }
      await removeProviderCredential("broker-probe").catch(() => undefined);
      unsubscribe?.();
      window.setTimeout(() => { gatewayButton.disabled = recoveryCompleted; }, 1800);
    }
  });

  window.addEventListener("beforeunload", () => activeContainer?.teardown(), { once: true });
}
