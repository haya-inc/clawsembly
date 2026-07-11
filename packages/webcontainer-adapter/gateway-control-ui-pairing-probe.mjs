import { createInterface } from "node:readline";
import WebSocket from "ws";

const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const sharedToken = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
if (!Number.isInteger(port) || !sharedToken) throw new Error("Gateway pairing probe port and token are required");

const client = {
  id: "openclaw-control-ui",
  version: "clawsembly-browser-probe",
  platform: "browser",
  mode: "webchat",
  instanceId: `clawsembly-control-ui-${Date.now().toString(36)}-${process.pid}`
};
const role = "operator";
const scopes = ["operator.read", "operator.write"];
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function readHostSignature(expectedKind) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser host signature timed out")), 15_000);
    input.once("line", (line) => {
      clearTimeout(timeout);
      try {
        const value = JSON.parse(line);
        if (value?.kind !== expectedKind || !value.device) throw new Error("signature kind mismatch");
        resolve(value);
      } catch {
        reject(new Error("browser host returned invalid signature JSON"));
      }
    });
  });
}

function connect({ phase, authToken }) {
  return new Promise((resolve, reject) => {
    const requestId = `clawsembly-control-ui-${phase}`;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
    let settled = false;
    const timeout = setTimeout(() => finish(undefined, new Error(`Gateway ${phase} pairing timed out`)), 25_000);
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "pairing probe complete");
      if (error) reject(error);
      else resolve(value);
    };

    socket.on("error", () => finish(undefined, new Error(`Gateway ${phase} websocket failed`)));
    socket.on("close", (code, reason) => {
      if (!settled && code !== 1000) finish(undefined, new Error(`Gateway ${phase} closed (${code}): ${String(reason)}`));
    });
    socket.on("message", async (raw) => {
      try {
        const frame = JSON.parse(String(raw));
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce : "";
          if (!nonce) throw new Error("Gateway pairing challenge has no nonce");
          const challenge = { phase, nonce, client, role, scopes };
          if (phase === "shared-token") console.log(`[control-ui-pairing-challenge] ${JSON.stringify(challenge)}`);
          else console.log(`[device-token-challenge] ${JSON.stringify({ ...challenge, deviceToken: authToken })}`);
          const signed = await readHostSignature(phase);
          socket.send(JSON.stringify({
            type: "req",
            id: requestId,
            method: "connect",
            params: {
              minProtocol: 4,
              maxProtocol: 4,
              client,
              role,
              scopes,
              caps: [],
              auth: phase === "shared-token" ? { token: authToken } : { deviceToken: authToken },
              device: signed.device
            }
          }));
          return;
        }
        if (frame.type === "res" && frame.id === requestId) {
          if (!frame.ok) throw new Error(`${frame.error?.code ?? "RPC_ERROR"}: ${frame.error?.message ?? "pairing connect failed"}`);
          if (frame.payload?.type !== "hello-ok" || frame.payload.protocol !== 4) throw new Error("pairing probe received an invalid hello");
          finish({
            protocol: frame.payload.protocol,
            serverVersion: frame.payload.server?.version ?? "unknown",
            deviceToken: typeof frame.payload?.auth?.deviceToken === "string" ? frame.payload.auth.deviceToken : null
          });
        }
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(`Gateway ${phase} pairing failed`));
      }
    });
  });
}

const paired = await connect({ phase: "shared-token", authToken: sharedToken });
if (!paired.deviceToken || paired.deviceToken.length < 16) throw new Error("Gateway did not issue a device token after Control UI pairing");
console.log(`[control-ui-paired] ${JSON.stringify({ protocol: paired.protocol, serverVersion: paired.serverVersion, deviceTokenIssued: true })}`);

const reconnected = await connect({ phase: "device-token", authToken: paired.deviceToken });
console.log(`[device-token-reconnect] ${JSON.stringify({
  protocol: reconnected.protocol,
  serverVersion: reconnected.serverVersion,
  authenticatedWith: "device-token",
  result: "pass"
})}`);
input.close();
