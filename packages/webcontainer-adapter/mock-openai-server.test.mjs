import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";

const serverPath = new URL("./mock-openai-server.mjs", import.meta.url);

async function startServer(t) {
  const child = spawn(process.execPath, [serverPath.pathname], {
    env: { ...process.env, CLAWSEMBLY_MOCK_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => undefined);
    }
  });
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const event = JSON.parse(line);
    if (event.event === "ready") return { port: event.port };
  }
  throw new Error("mock provider exited before readiness");
}

function requestBody(messages) {
  return {
    model: "mock-v1",
    stream: true,
    messages,
    tools: [{ type: "function", function: { name: "agents_list", parameters: { type: "object" } } }]
  };
}

test("mock provider requires agents_list then completes after its tool result", async (t) => {
  const { port } = await startServer(t);
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  const first = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody([{ role: "user", content: "probe" }]))
  });
  const firstStream = await first.text();
  assert.equal(first.status, 200);
  assert.match(firstStream, /call_clawsembly_agents_1/);
  assert.match(firstStream, /agents_list/);
  assert.match(firstStream, /"finish_reason":"tool_calls"/);

  const second = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody([
      { role: "user", content: "probe" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_clawsembly_agents_1",
          type: "function",
          function: { name: "agents_list", arguments: "{}" }
        }]
      },
      { role: "tool", tool_call_id: "call_clawsembly_agents_1", content: "agents ok" }
    ]))
  });
  const secondStream = await second.text();
  assert.equal(second.status, 200);
  assert.match(secondStream, /Clawsembly tool/);
  assert.match(secondStream, /round-trip passed/);
  assert.match(secondStream, /"finish_reason":"stop"/);
});

test("mock provider rejects invalid JSON with HTTP 400 instead of hanging", async (t) => {
  const { port } = await startServer(t);
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json"
  });
  assert.equal(response.status, 400);
  const failure = await response.json();
  assert.match(failure.error.message, /invalid JSON/);
});

test("mock provider keeps a cancellation scenario open until the client aborts", async (t) => {
  const { port } = await startServer(t);
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify(requestBody([{ role: "user", content: "CANCEL_ME" }]))
  });
  assert.equal(response.status, 200);
  const body = response.text();
  controller.abort();
  await assert.rejects(body, /abort/i);
});
