import type { WebContainer } from "@webcontainer/api";
import { createDeviceConnectParams, runDeviceIdentityProbe } from "./device-identity";
import { getCredentialMetadata, storeProviderCredential, withProviderCredential } from "./credential-vault";

export type ProbeState = "idle" | "running" | "pass" | "fail";
export interface InstallPerformanceEvidence {
  coldRootInstallMs: number;
  nestedRepairMs: number;
  coldTotalMs: number;
  warmInstallMs: number;
  nodeModules: { bytes: number; files: number; directories: number; symlinks: number };
  npmCache: { bytes: number; files: number; directories: number; symlinks: number };
}
export const GATEWAY_PROBE_TOKEN = "clawsembly-local-probe-token";
export const HOST_BROKER_CAPABILITY = "clawsembly-ephemeral-host-broker-probe";

export function cleanTerminal(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

export function appendOutput(target: HTMLElement, value: string): void {
  const next = `${target.textContent ?? ""}${cleanTerminal(value)}`;
  target.textContent = next.slice(-12_000);
  target.scrollTop = target.scrollHeight;
}

export function updateLine(index: number, state: ProbeState, value: string): void {
  const lines = Array.from(document.querySelectorAll<HTMLElement>("[data-probe-output] li"));
  const line = lines[index];
  if (!line) return;
  line.dataset.state = state;
  const output = line.querySelector<HTMLElement>("em");
  if (output) output.textContent = value;
}

export async function readProcessOutput(instance: WebContainer): Promise<{ code: number; output: string }> {
  const child = await instance.spawn("node", ["--version"]);
  let output = "";
  const outputComplete = child.output.pipeTo(new WritableStream({
    write(chunk: string) { output += chunk; }
  }));
  const code = await child.exit;
  await outputComplete;
  return { code, output: output.trim() };
}

export async function runTransientProcessProbe(
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

export async function readSqliteCapability(instance: WebContainer): Promise<{ close: string; exec: string; prepare: string }> {
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

export async function verifyRecoveredTranscript(instance: WebContainer): Promise<{
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

export async function verifyBrowserDeviceHandshake(instance: WebContainer, port: number, token: string): Promise<{
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

export async function verifyControlUiPairing(instance: WebContainer, port: number, token: string): Promise<{
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
