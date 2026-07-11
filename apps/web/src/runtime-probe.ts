import type { WebContainer } from "@webcontainer/api";
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
import {
  createStoredStateBackup,
  importStateBackup,
  formatSnapshotSize,
  loadStateSnapshot,
  removeStateSnapshot
} from "./state-persistence";
import { setupGatewayProbe } from "./runtime-gateway-probe";

import {
  appendOutput,
  cleanTerminal,
  readProcessOutput,
  readSqliteCapability,
  runTransientProcessProbe,
  updateLine,
  type InstallPerformanceEvidence
} from "./runtime-probe-support";

let activeContainer: WebContainer | undefined;
let lastStateSnapshot: Uint8Array | undefined;
let lastInstallPerformance: InstallPerformanceEvidence | undefined;
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

  setupGatewayProbe({
    gatewayButton,
    installOutput,
    budgetRequestsInput,
    budgetInputCharsInput,
    budgetOutputCharsInput,
    getActiveContainer: () => activeContainer,
    setActiveContainer: (container) => { activeContainer = container; },
    getInstallPerformance: () => lastInstallPerformance,
    showStoredState
  });

  window.addEventListener("beforeunload", () => activeContainer?.teardown(), { once: true });
}
