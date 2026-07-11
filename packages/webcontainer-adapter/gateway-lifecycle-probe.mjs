const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const token = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
const sessionKey = "agent:main:clawsembly-probe";
const runSuffix = `${Date.now().toString(36)}-${process.pid}`;
const completedRunId = `clawsembly-mock-turn-${runSuffix}`;
const cancelledRunId = `clawsembly-cancel-turn-${runSuffix}`;

if (!Number.isInteger(port) || !token) throw new Error("Gateway probe port and token are required");

function withTimeout(promise, label, milliseconds = 30_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

async function createClient(instance) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map();
  const waiters = new Set();
  let requestSequence = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  function sendRequest(method, params, id = `${instance}-${++requestSequence}`) {
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  socket.addEventListener("error", () => readyReject(new Error(`${instance} websocket error`)));
  socket.addEventListener("close", (event) => {
    const error = new Error(`${instance} websocket closed (${event.code}): ${event.reason}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.type === "event" && frame.event === "connect.challenge") {
      sendRequest("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: "gateway-client",
          version: "clawsembly-probe",
          platform: "webcontainer",
          mode: "backend",
          instanceId: instance
        },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        caps: [],
        auth: { token }
      }, `${instance}-connect`).then((hello) => {
        if (hello?.type !== "hello-ok" || hello.protocol !== 4) throw new Error(`${instance} returned an invalid hello`);
        console.log(JSON.stringify({ event: "hello", instance, protocol: hello.protocol, serverVersion: hello.server?.version }));
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
    if (frame.type === "event") {
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(frame)) continue;
        waiters.delete(waiter);
        waiter.resolve(frame);
      }
    }
  });

  function waitForEvent(predicate, label) {
    return withTimeout(new Promise((resolve) => waiters.add({ predicate, resolve })), label);
  }

  await withTimeout(ready, `${instance} connect`);
  return {
    request(method, params) { return withTimeout(sendRequest(method, params), `${instance} ${method}`); },
    waitForEvent,
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
      socket.close(1000, "probe reconnect");
      await withTimeout(closed, `${instance} close`, 5_000);
    }
  };
}

function assertHistory(payload, phase) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const serialized = JSON.stringify(messages);
  if (!serialized.includes("Reply with the deterministic mock response.")) throw new Error(`${phase} history is missing the user message`);
  if (!serialized.includes("Clawsembly tool round-trip passed.")) throw new Error(`${phase} history is missing the assistant response`);
  console.log(JSON.stringify({ event: "history", phase, messageCount: messages.length, restored: true }));
}

async function requestAfterStartup(client, method, params) {
  let lastError;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      return await client.request(method, params);
    } catch (error) {
      lastError = error;
      if (!String(error).includes("UNAVAILABLE: chat.history unavailable during gateway startup")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

const first = await createClient("initial");
const finalEvent = first.waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === completedRunId && frame.payload?.state === "final",
  "completed chat event"
);
await first.request("chat.send", {
  sessionKey,
  message: "Reply with the deterministic mock response.",
  deliver: false,
  timeoutMs: 20_000,
  idempotencyKey: completedRunId
});
const finalFrame = await finalEvent;
if (!JSON.stringify(finalFrame.payload.message).includes("Clawsembly tool round-trip passed.")) {
  throw new Error("completed chat response did not match the deterministic fixture");
}
console.log(JSON.stringify({ event: "chat", state: "final", runId: completedRunId, toolRoundTrip: true }));
assertHistory(await requestAfterStartup(first, "chat.history", { sessionKey, limit: 20, maxChars: 20_000 }), "initial");
await first.close();

const reconnected = await createClient("reconnected");
assertHistory(await requestAfterStartup(reconnected, "chat.history", { sessionKey, limit: 20, maxChars: 20_000 }), "reconnected");

const deltaEvent = reconnected.waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "delta",
  "cancellation delta"
);
const abortedEvent = reconnected.waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "aborted",
  "cancellation event"
);
await reconnected.request("chat.send", {
  sessionKey,
  message: "CANCEL_ME after the first streamed delta.",
  deliver: false,
  timeoutMs: 60_000,
  idempotencyKey: cancelledRunId
});
await deltaEvent;
const abortResult = await reconnected.request("chat.abort", { sessionKey, runId: cancelledRunId });
if (abortResult?.aborted !== true || !abortResult.runIds?.includes(cancelledRunId)) throw new Error("chat.abort did not report the active run");
const abortedFrame = await abortedEvent;
console.log(JSON.stringify({
  event: "chat",
  state: abortedFrame.payload.state,
  runId: abortedFrame.payload.runId,
  abortRpc: true
}));
await reconnected.close();

console.log(JSON.stringify({
  ok: true,
  event: "lifecycle",
  history: true,
  reconnect: true,
  cancellation: true,
  toolRoundTrip: true
}));
