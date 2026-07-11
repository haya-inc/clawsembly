import { createInterface } from "node:readline";

const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const token = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
if (!Number.isInteger(port) || !token) throw new Error("Gateway device probe port and token are required");

const client = {
  id: "gateway-client",
  version: "clawsembly-browser-probe",
  platform: "browser",
  mode: "backend",
  instanceId: `clawsembly-browser-${Date.now().toString(36)}-${process.pid}`
};
const role = "operator";
const scopes = ["operator.read", "operator.write"];
const requestId = "clawsembly-browser-device-connect";
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let signedConnection;

function readHostSignature() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser host signature timed out")), 15_000);
    input.once("line", (line) => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(line)); }
      catch { reject(new Error("browser host returned invalid signature JSON")); }
    });
  });
}

const finished = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Gateway device identity probe timed out")), 25_000);
  const finish = (value, error) => {
    clearTimeout(timeout);
    input.close();
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "device identity probe complete");
    if (error) reject(error);
    else resolve(value);
  };
  socket.addEventListener("error", () => finish(undefined, new Error("Gateway device probe websocket failed")));
  socket.addEventListener("close", (event) => {
    if (event.code !== 1000) finish(undefined, new Error(`Gateway device probe closed (${event.code}): ${event.reason}`));
  });
  socket.addEventListener("message", async (event) => {
    try {
      const frame = JSON.parse(String(event.data));
      if (frame.type === "event" && frame.event === "connect.challenge") {
        const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce : "";
        if (!nonce) throw new Error("Gateway device challenge has no nonce");
        console.log(`[device-challenge] ${JSON.stringify({ nonce, client, role, scopes })}`);
        signedConnection = await readHostSignature();
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
            auth: { token },
            device: signedConnection.device
          }
        }));
        return;
      }
      if (frame.type === "res" && frame.id === requestId) {
        if (!frame.ok) throw new Error(`${frame.error?.code ?? "RPC_ERROR"}: ${frame.error?.message ?? "device connect failed"}`);
        if (frame.payload?.type !== "hello-ok" || frame.payload.protocol !== 4) throw new Error("device probe received an invalid hello");
        const result = {
          deviceId: frame.payload?.auth?.deviceId ?? signedConnection?.device?.id ?? null,
          protocol: frame.payload.protocol,
          serverVersion: frame.payload.server?.version ?? "unknown",
          signatureVersion: signedConnection?.signatureVersion === "v2" ? "v2" : "v3"
        };
        console.log(`[device-hello] ${JSON.stringify(result)}`);
        finish(result);
      }
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error("Gateway device probe failed"));
    }
  });
});

await finished;
