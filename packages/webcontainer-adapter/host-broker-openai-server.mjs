import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createInterface } from "node:readline";

const port = Number(process.env.CLAWSEMBLY_HOST_BROKER_PORT ?? 19003);
const capability = process.env.CLAWSEMBLY_HOST_BROKER_CAPABILITY;
const maxRequests = Number(process.env.CLAWSEMBLY_HOST_BROKER_MAX_REQUESTS ?? 4);
const maxBodyBytes = 1024 * 1024;
const pending = new Map();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let requestCount = 0;
const callIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const functionNamePattern = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

if (!capability || capability.length < 24) throw new Error("host broker capability is required");

const expectedAuthorization = Buffer.from(`Bearer ${capability}`);

function authorizationMatches(header) {
  const actual = Buffer.from(header ?? "");
  return actual.length === expectedAuthorization.length && timingSafeEqual(actual, expectedAuthorization);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function completionChunk(entry, delta, finishReason = null) {
  entry.response.write(`data: ${JSON.stringify({
    id: entry.completionId,
    object: "chat.completion.chunk",
    created: entry.created,
    model: "browser-host-broker",
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`);
}

function completeEntry(entry) {
  if (entry.completed) return;
  entry.completed = true;
  pending.delete(entry.id);
  const finishReason = entry.toolCalls.length > 0 ? "tool_calls" : "stop";
  if (entry.stream) {
    completionChunk(entry, {}, finishReason);
    entry.response.write("data: [DONE]\n\n");
    entry.response.end();
    return;
  }
  sendJson(entry.response, 200, {
    id: entry.completionId,
    object: "chat.completion",
    created: entry.created,
    model: "browser-host-broker",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: entry.text || null,
        ...(entry.toolCalls.length > 0 ? { tool_calls: entry.toolCalls } : {})
      },
      finish_reason: finishReason
    }]
  });
}

function failEntry(entry) {
  if (entry.completed) return;
  entry.completed = true;
  pending.delete(entry.id);
  if (entry.stream) entry.response.destroy();
  else sendJson(entry.response, 502, { error: { message: "browser host broker rejected the request" } });
}

function readChatContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) throw new Error("unsupported chat content");
  return content.map((part) => {
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    throw new Error("unsupported chat content part");
  }).join("");
}

function toResponsesInput(messages) {
  const result = [];
  for (const message of messages) {
    const role = message?.role;
    if (role === "tool") {
      const output = readChatContent(message.content);
      if (!callIdPattern.test(message.tool_call_id ?? "") || !output) throw new Error("invalid tool result");
      result.push({ type: "function_call_output", call_id: message.tool_call_id, output });
      continue;
    }
    if (!["system", "developer", "user", "assistant"].includes(role)) throw new Error("unsupported chat role");
    const content = readChatContent(message.content);
    if (content) result.push({ role, content });
    if (role !== "assistant" || message.tool_calls == null) continue;
    if (!Array.isArray(message.tool_calls)) throw new Error("invalid tool calls");
    for (const toolCall of message.tool_calls) {
      const fn = toolCall?.type === "function" ? toolCall.function : null;
      if (!callIdPattern.test(toolCall?.id ?? "") || !functionNamePattern.test(fn?.name ?? "")
        || typeof fn?.arguments !== "string") throw new Error("invalid tool call");
      const parsedArguments = JSON.parse(fn.arguments);
      if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) {
        throw new Error("invalid tool call arguments");
      }
      result.push({
        type: "function_call",
        call_id: toolCall.id,
        name: fn.name,
        arguments: fn.arguments
      });
    }
  }
  if (result.length === 0 || JSON.stringify(result).length > 100_000) throw new Error("invalid broker input");
  return result;
}

input.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    const entry = pending.get(message?.id);
    if (!entry) return;
    if (message.event === "delta" && typeof message.delta === "string" && message.delta.length > 0) {
      entry.text += message.delta;
      if (entry.text.length > 100_000) return failEntry(entry);
      if (entry.stream) completionChunk(entry, { content: message.delta });
      return;
    }
    if (message.event === "tool_call" && typeof message.callId === "string"
      && typeof message.name === "string" && typeof message.arguments === "string") {
      const toolCall = {
        index: entry.toolCalls.length,
        id: message.callId,
        type: "function",
        function: { name: message.name, arguments: message.arguments }
      };
      entry.toolCalls.push(toolCall);
      if (entry.stream) completionChunk(entry, { tool_calls: [toolCall] });
      return;
    }
    if (message.event === "done") return completeEntry(entry);
    if (message.event === "error") return failEntry(entry);
  } catch {
    // Invalid host messages are ignored; their bounded host request times out.
  }
});

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    sendJson(response, 200, { object: "list", data: [{ id: "broker-v1", object: "model" }] });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "not found" } });
    return;
  }
  if (!authorizationMatches(request.headers.authorization)) {
    sendJson(response, 401, { error: { message: "invalid bridge capability" } });
    return;
  }
  if (requestCount >= maxRequests) {
    sendJson(response, 429, { error: { message: "bridge request budget exhausted" } });
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
  try {
    const parsed = JSON.parse(body);
    if (parsed.model !== "broker-v1" || !Array.isArray(parsed.messages)) throw new Error("invalid broker request");
    const responsesInput = toResponsesInput(parsed.messages);
    const latestUserIndex = parsed.messages.findLastIndex((message) => message?.role === "user");
    const currentTurnMessages = latestUserIndex >= 0 ? parsed.messages.slice(latestUserIndex + 1) : parsed.messages;
    const hasToolResult = currentTurnMessages.some((message) => message?.role === "tool");
    const tools = Array.isArray(parsed.tools) ? parsed.tools.flatMap((tool) => {
      const fn = tool?.type === "function" ? tool.function : null;
      if (!fn || typeof fn.name !== "string" || !fn.parameters || typeof fn.parameters !== "object") return [];
      return [{
        type: "function",
        name: fn.name,
        description: typeof fn.description === "string" ? fn.description : undefined,
        parameters: fn.parameters,
        strict: true
      }];
    }) : [];

    requestCount += 1;
    const created = Math.floor(Date.now() / 1000);
    const id = `broker-${Date.now().toString(36)}-${requestCount}`;
    const entry = {
      id,
      response,
      stream: parsed.stream === true,
      text: "",
      toolCalls: [],
      created,
      completionId: `chatcmpl-clawsembly-${created}-${requestCount}`,
      completed: false
    };
    pending.set(id, entry);
    if (entry.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      completionChunk(entry, { role: "assistant" });
    }

    const cancel = () => {
      const active = pending.get(id);
      if (!active || active.completed) return;
      active.completed = true;
      pending.delete(id);
      console.log(`[host-broker-cancel] ${JSON.stringify({ id })}`);
    };
    request.once("aborted", cancel);
    response.once("close", () => {
      if (!response.writableEnded) cancel();
    });
    console.log(`[host-broker-request] ${JSON.stringify({
      id,
      model: parsed.model,
      input: responsesInput,
      stream: entry.stream,
      tools,
      hasToolResult
    })}`);
  } catch {
    sendJson(response, 400, { error: { message: "browser host broker request failed" } });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[host-broker-ready] ${JSON.stringify({ port, maxRequests, streaming: true, credentialInWebContainer: false })}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const entry of pending.values()) {
      entry.completed = true;
      entry.response.destroy();
    }
    pending.clear();
    input.close();
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 250).unref();
  });
}
