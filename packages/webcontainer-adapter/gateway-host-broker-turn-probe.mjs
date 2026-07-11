const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const token = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
const sessionKey = "agent:broker:clawsembly-host-broker-probe";
const runId = `clawsembly-host-broker-${Date.now().toString(36)}-${process.pid}`;
const cancelledRunId = `${runId}-cancel`;
const expectedText = "Clawsembly browser-host broker tool round-trip passed.";

if (!Number.isInteger(port) || !token) throw new Error("Gateway broker probe port and token are required");

function withTimeout(promise, label, milliseconds = 40_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

const socket = new WebSocket(`ws://127.0.0.1:${port}`);
const pending = new Map();
const events = new Set();
let sequence = 0;
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

function request(method, params, id = `broker-${++sequence}`) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

function waitForEvent(predicate) {
  return new Promise((resolve) => events.add({ predicate, resolve }));
}

socket.addEventListener("error", () => readyReject(new Error("broker probe websocket error")));
socket.addEventListener("close", (event) => {
  const error = new Error(`broker probe websocket closed (${event.code}): ${event.reason}`);
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});
socket.addEventListener("message", (event) => {
  const frame = JSON.parse(String(event.data));
  if (frame.type === "event" && frame.event === "connect.challenge") {
    request("connect", {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "gateway-client",
        version: "clawsembly-host-broker-probe",
        platform: "webcontainer",
        mode: "backend",
        instanceId: runId
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      auth: { token }
    }, "broker-connect").then((hello) => {
      if (hello?.type !== "hello-ok" || hello.protocol !== 4) throw new Error("broker probe returned an invalid hello");
      readyResolve(hello);
    }).catch(readyReject);
    return;
  }
  if (frame.type === "res") {
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.ok) waiter.resolve(frame.payload);
    else waiter.reject(new Error(`${frame.error?.code ?? "RPC_ERROR"}: ${frame.error?.message ?? "request failed"}`));
    return;
  }
  if (frame.type === "event") for (const waiter of [...events]) {
    if (!waiter.predicate(frame)) continue;
    events.delete(waiter);
    waiter.resolve(frame);
  }
});

await withTimeout(ready, "broker probe connect");
const deltaEvent = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === runId && frame.payload?.state === "delta"
), "broker delta event");
const finalEvent = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === runId && frame.payload?.state === "final"
), "broker final event");
await withTimeout(request("chat.send", {
  sessionKey,
  message: "Reply through the browser-host provider broker.",
  deliver: false,
  timeoutMs: 30_000,
  idempotencyKey: runId
}), "broker chat.send");
await deltaEvent;
const finalFrame = await finalEvent;
if (!JSON.stringify(finalFrame.payload?.message).includes(expectedText)) throw new Error("browser-host broker response did not reach OpenClaw");

const cancellationDelta = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "delta"
), "broker cancellation delta");
const cancellationAborted = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "aborted"
), "broker cancellation aborted");
await withTimeout(request("chat.send", {
  sessionKey,
  message: "BROKER_CANCEL_ME after the first streamed delta.",
  deliver: false,
  timeoutMs: 30_000,
  idempotencyKey: cancelledRunId
}), "broker cancellation chat.send");
await cancellationDelta;
const abortResult = await withTimeout(request("chat.abort", { sessionKey, runId: cancelledRunId }), "broker chat.abort");
if (abortResult?.aborted !== true || !abortResult.runIds?.includes(cancelledRunId)) {
  throw new Error("browser-host broker chat.abort did not report the active run");
}
console.log(`[host-broker-abort] ${JSON.stringify({ runId: cancelledRunId })}`);
await cancellationAborted;

console.log(JSON.stringify({
  event: "host-broker-turn",
  state: "final",
  provider: "clawsembly-browser-host/broker-v1",
  response: expectedText,
  streaming: true,
  deltaObserved: true,
  toolRoundTrip: true,
  cancellation: true,
  abortRpc: true,
  result: "pass"
}));

if (socket.readyState !== WebSocket.CLOSED) {
  const closed = new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
  socket.close(1000, "broker probe complete");
  await withTimeout(closed, "broker probe close", 5_000);
}
