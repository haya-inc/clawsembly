import http from "node:http";

const port = Number(process.env.CLAWSEMBLY_MOCK_PORT ?? 19002);
const responseText = "Clawsembly tool round-trip passed.";
const requiredToolName = "agents_list";
const maxBodyBytes = 1024 * 1024;
let toolCallSequence = 0;

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    sendJson(response, 200, { object: "list", data: [{ id: "mock-v1", object: "model" }] });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "not found" } });
    return;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      sendJson(response, 413, { error: { message: "request too large" } });
      request.destroy();
      return;
    }
  }
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: { message: "invalid JSON request body" } });
    return;
  }
  const toolNames = Array.isArray(input.tools)
    ? input.tools.map((tool) => tool?.function?.name).filter(Boolean)
    : [];
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const latestUserIndex = messages.findLastIndex((message) => message?.role === "user");
  const currentTurnMessages = latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : messages;
  const toolResultMessage = currentTurnMessages.find((message) => message?.role === "tool");
  const hasToolResult = Boolean(toolResultMessage);
  const isCancellationProbe = latestUserIndex >= 0 && JSON.stringify(messages[latestUserIndex]).includes("CANCEL_ME");
  console.log(JSON.stringify({
    event: "request",
    model: input.model,
    stream: input.stream === true,
    messageCount: Array.isArray(input.messages) ? input.messages.length : 0,
    toolCount: toolNames.length,
    toolNames,
    hasToolResult,
    toolResultCallId: toolResultMessage?.tool_call_id ?? null,
    toolResultChars: typeof toolResultMessage?.content === "string" ? toolResultMessage.content.length : 0
  }));

  if (input.stream !== true) {
    sendJson(response, 200, {
      id: "clawsembly-mock",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-v1",
      choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
    });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const chunk = (delta, finishReason = null) => {
    response.write(`data: ${JSON.stringify({
      id: "clawsembly-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-v1",
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`);
  };
  chunk({ role: "assistant" });

  if (isCancellationProbe) {
    chunk({ content: "Cancellation probe started." });
    let completed = false;
    const finish = (event) => {
      if (completed) return;
      completed = true;
      clearTimeout(fallback);
      console.log(JSON.stringify({ event, scenario: "cancellation" }));
    };
    const fallback = setTimeout(() => {
      finish("timeout");
      if (!response.writableEnded) {
        chunk({ content: " Cancellation was not received." });
        chunk({}, "stop");
        response.write("data: [DONE]\n\n");
        response.end();
      }
    }, 60_000);
    request.once("aborted", () => finish("request-aborted"));
    response.once("close", () => {
      if (!response.writableEnded) finish("response-closed");
    });
    return;
  }

  if (!hasToolResult) {
    if (!toolNames.includes(requiredToolName)) {
      chunk({ content: `Required ${requiredToolName} tool was not advertised.` });
      chunk({}, "stop");
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    chunk({
      tool_calls: [{
        index: 0,
        id: `call_clawsembly_agents_${++toolCallSequence}`,
        type: "function",
        function: { name: requiredToolName, arguments: "{}" }
      }]
    });
    chunk({}, "tool_calls");
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }

  chunk({ content: "Clawsembly tool " });
  chunk({ content: "round-trip passed." });
  chunk({}, "stop");
  response.write("data: [DONE]\n\n");
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log(JSON.stringify({ event: "ready", port: typeof address === "object" && address ? address.port : port }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 250).unref();
  });
}
