import { withProviderCredential, type CredentialProvider } from "./credential-vault";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const OPENAI_BROKER_MODEL = "gpt-5.6-luna";
const MAX_INPUT_CHARS = 100_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface OpenAITextRequest {
  model: string;
  input: OpenAIResponseInput;
  tools?: OpenAIFunctionTool[];
  maxOutputTokens?: number;
}

export type OpenAIResponseInput = string | OpenAIResponseInputItem[];

export type OpenAIResponseInputItem =
  | {
    role: "system" | "developer" | "user" | "assistant";
    content: string;
  }
  | {
    type: "function_call";
    call_id: string;
    name: string;
    arguments: string;
  }
  | {
    type: "function_call_output";
    call_id: string;
    output: string;
  };

export interface OpenAIFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface ProviderBrokerProbe {
  endpoint: typeof OPENAI_RESPONSES_ENDPOINT;
  method: "POST";
  redirectPolicy: "error";
  browserCredentials: "omit";
  responseLimitBytes: number;
  store: false;
  stream: false;
  authorizationApplied: true;
  secretRedacted: true;
  invalidModelRejected: true;
  oversizedResponseRejected: true;
  outputTextValidated: true;
  invalidOutputRejected: true;
  streamingEventsValidated: true;
  functionCallEventsValidated: true;
  functionResultInputValidated: true;
  maxOutputTokensValidated: true;
  requestBudgetValidated: true;
  cancellationPropagated: true;
  bodyCancellationPropagated: true;
  result: "pass";
}

export interface OpenAIStreamResult {
  completed: true;
  deltaCount: number;
  outputTextChars: number;
  functionCallCount: number;
}

export interface OpenAIStreamFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface OpenAIStreamHandlers {
  onTextDelta: (delta: string) => void | Promise<void>;
  onFunctionCall?: (call: OpenAIStreamFunctionCall) => void | Promise<void>;
}

export interface ProviderBudgetLimits {
  maxRequests: number;
  maxInputChars: number;
  maxOutputChars: number;
}

export interface ProviderBudgetSnapshot extends ProviderBudgetLimits {
  requestsUsed: number;
  inputCharsUsed: number;
  outputCharsUsed: number;
}

export class ProviderBrokerError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, options: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = "ProviderBrokerError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export class ProviderBudgetTracker {
  readonly limits: ProviderBudgetLimits;
  private requestsUsed = 0;
  private inputCharsUsed = 0;
  private outputCharsUsed = 0;

  constructor(limits: ProviderBudgetLimits) {
    if (![limits.maxRequests, limits.maxInputChars, limits.maxOutputChars]
      .every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new ProviderBrokerError("provider budget limits are invalid");
    }
    this.limits = { ...limits };
  }

  consumeRequest(request: OpenAITextRequest): void {
    const inputChars = typeof request.input === "string" ? request.input.length : JSON.stringify(request.input).length;
    if (this.requestsUsed + 1 > this.limits.maxRequests) {
      throw new ProviderBrokerError("provider request budget exhausted");
    }
    if (this.inputCharsUsed + inputChars > this.limits.maxInputChars) {
      throw new ProviderBrokerError("provider input budget exhausted");
    }
    this.requestsUsed += 1;
    this.inputCharsUsed += inputChars;
  }

  consumeOutput(chars: number): void {
    if (!Number.isSafeInteger(chars) || chars < 0) throw new ProviderBrokerError("provider output budget increment is invalid");
    if (this.outputCharsUsed + chars > this.limits.maxOutputChars) {
      throw new ProviderBrokerError("provider output budget exhausted");
    }
    this.outputCharsUsed += chars;
  }

  snapshot(): ProviderBudgetSnapshot {
    return {
      ...this.limits,
      requestsUsed: this.requestsUsed,
      inputCharsUsed: this.inputCharsUsed,
      outputCharsUsed: this.outputCharsUsed
    };
  }
}

function validateRequest(request: OpenAITextRequest): OpenAITextRequest {
  if (!MODEL_PATTERN.test(request.model)) throw new ProviderBrokerError("provider model identifier is invalid");
  if (request.maxOutputTokens !== undefined
    && (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 4_096)) {
    throw new ProviderBrokerError("provider output token limit is invalid");
  }
  if (typeof request.input === "string") {
    if (request.input.length === 0) throw new ProviderBrokerError("provider input is empty");
    if (request.input.length > MAX_INPUT_CHARS) throw new ProviderBrokerError("provider input exceeds the 100,000 character limit");
  } else {
    if (!Array.isArray(request.input) || request.input.length === 0 || request.input.length > 512
      || JSON.stringify(request.input).length > MAX_INPUT_CHARS) {
      throw new ProviderBrokerError("provider input item list is invalid");
    }
    const calls = new Set<string>();
    for (const item of request.input) {
      if (!item || typeof item !== "object") throw new ProviderBrokerError("provider input item is invalid");
      if ("role" in item) {
        if (!["system", "developer", "user", "assistant"].includes(item.role)
          || typeof item.content !== "string" || item.content.length === 0) {
          throw new ProviderBrokerError("provider input message is invalid");
        }
        continue;
      }
      if (item.type === "function_call") {
        if (!CALL_ID_PATTERN.test(item.call_id) || !FUNCTION_NAME_PATTERN.test(item.name)
          || typeof item.arguments !== "string") {
          throw new ProviderBrokerError("provider function call input is invalid");
        }
        let parsedArguments: unknown;
        try { parsedArguments = JSON.parse(item.arguments); }
        catch { throw new ProviderBrokerError("provider function call input arguments are not valid JSON"); }
        if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)
          || calls.has(item.call_id)) {
          throw new ProviderBrokerError("provider function call input is invalid");
        }
        calls.add(item.call_id);
        continue;
      }
      if (item.type === "function_call_output") {
        if (!CALL_ID_PATTERN.test(item.call_id) || typeof item.output !== "string"
          || item.output.length === 0 || !calls.has(item.call_id)) {
          throw new ProviderBrokerError("provider function call output is invalid");
        }
        calls.delete(item.call_id);
        continue;
      }
      throw new ProviderBrokerError("provider input item type is invalid");
    }
  }
  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools) || request.tools.length > 16) throw new ProviderBrokerError("provider tools exceed the allowlist limit");
    for (const tool of request.tools) {
      if (tool?.type !== "function" || !FUNCTION_NAME_PATTERN.test(tool.name)
        || (tool.description !== undefined && (typeof tool.description !== "string" || tool.description.length > 4_096))
        || !tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)
        || tool.strict !== true) {
        throw new ProviderBrokerError("provider tool definition is invalid");
      }
    }
    if (JSON.stringify(request.tools).length > MAX_INPUT_CHARS) throw new ProviderBrokerError("provider tool definitions exceed the 100,000 character limit");
  }
  return request;
}

function createRequestBody(request: OpenAITextRequest, stream: boolean): Record<string, unknown> {
  return {
    model: request.model,
    input: request.input,
    store: false,
    stream,
    ...(request.tools?.length ? { tools: request.tools } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_output_tokens: request.maxOutputTokens } : {})
  };
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderBrokerError("provider response exceeds the 2 MB safety limit", { status: response.status });
  }
  if (!response.body) throw new ProviderBrokerError("provider response has no body", { status: response.status });

  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderBrokerError("provider response exceeds the 2 MB safety limit", { status: response.status });
      }
      chunks.push(value);
    }
    if (signal.aborted) throw new ProviderBrokerError("provider request cancelled", { status: response.status });

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new ProviderBrokerError("provider returned invalid JSON", { status: response.status });
    }
  } catch (error: unknown) {
    if (signal.aborted) throw new ProviderBrokerError("provider request cancelled", { status: response.status });
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function performOpenAIRequest(
  apiKey: string,
  untrustedRequest: OpenAITextRequest,
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<unknown> {
  const request = validateRequest(untrustedRequest);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetcher(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(createRequestBody(request, false)),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderBrokerError(`provider request failed with HTTP ${response.status}`, { status: response.status, requestId });
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderBrokerError("provider returned an unsupported content type", { status: response.status, requestId });
    }
    return await readBoundedJson(response, controller.signal);
  } catch (error: unknown) {
    if (timedOut) throw new ProviderBrokerError("provider request timed out");
    if (controller.signal.aborted) throw new ProviderBrokerError("provider request cancelled");
    if (error instanceof ProviderBrokerError) throw error;
    throw new ProviderBrokerError("provider network request failed");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function readBoundedResponseStream(
  response: Response,
  handlers: OpenAIStreamHandlers,
  signal: AbortSignal,
  budget?: ProviderBudgetTracker
): Promise<OpenAIStreamResult> {
  if (!response.body) throw new ProviderBrokerError("provider stream has no body", { status: response.status });
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let totalBytes = 0;
  let outputTextChars = 0;
  let deltaCount = 0;
  let functionCallCount = 0;
  let completed = false;
  const functionCalls = new Map<string, OpenAIStreamFunctionCall>();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });

  const consumeEvent = async (block: string) => {
    const data = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event: {
      type?: unknown;
      delta?: unknown;
      item_id?: unknown;
      arguments?: unknown;
      response?: { status?: unknown };
      item?: { type?: unknown; id?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown };
    };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      throw new ProviderBrokerError("provider stream returned invalid JSON", { status: response.status });
    }
    if (event.type === "response.output_text.delta") {
      if (typeof event.delta !== "string" || event.delta.length === 0) {
        throw new ProviderBrokerError("provider stream returned an invalid text delta", { status: response.status });
      }
      outputTextChars += event.delta.length;
      if (outputTextChars > MAX_INPUT_CHARS) {
        throw new ProviderBrokerError("provider stream output exceeds the 100,000 character limit", { status: response.status });
      }
      try { budget?.consumeOutput(event.delta.length); }
      catch (error: unknown) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }
      deltaCount += 1;
      await handlers.onTextDelta(event.delta);
      return;
    }
    if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
      if (typeof event.item.id !== "string" || typeof event.item.call_id !== "string"
        || typeof event.item.name !== "string" || !FUNCTION_NAME_PATTERN.test(event.item.name)
        || (event.item.arguments !== undefined && typeof event.item.arguments !== "string")) {
        throw new ProviderBrokerError("provider stream returned an invalid function call", { status: response.status });
      }
      functionCalls.set(event.item.id, {
        callId: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments ?? ""
      });
      return;
    }
    if (event.type === "response.function_call_arguments.delta") {
      if (typeof event.item_id !== "string" || typeof event.delta !== "string") {
        throw new ProviderBrokerError("provider stream returned invalid function arguments", { status: response.status });
      }
      const call = functionCalls.get(event.item_id);
      if (!call) throw new ProviderBrokerError("provider stream referenced an unknown function call", { status: response.status });
      call.arguments += event.delta;
      if (call.arguments.length > MAX_INPUT_CHARS) {
        throw new ProviderBrokerError("provider function arguments exceed the 100,000 character limit", { status: response.status });
      }
      try { budget?.consumeOutput(event.delta.length); }
      catch (error: unknown) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }
      return;
    }
    if (event.type === "response.function_call_arguments.done") {
      const itemId = typeof event.item?.id === "string" ? event.item.id : typeof event.item_id === "string" ? event.item_id : "";
      const call = functionCalls.get(itemId);
      if (!call) throw new ProviderBrokerError("provider stream completed an unknown function call", { status: response.status });
      const finalArguments = typeof event.arguments === "string"
        ? event.arguments
        : typeof event.item?.arguments === "string"
          ? event.item.arguments
          : call.arguments;
      if (call.arguments && finalArguments !== call.arguments) {
        throw new ProviderBrokerError("provider stream returned inconsistent function arguments", { status: response.status });
      }
      let parsedArguments: unknown;
      try { parsedArguments = JSON.parse(finalArguments); }
      catch { throw new ProviderBrokerError("provider function arguments are not valid JSON", { status: response.status }); }
      if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) {
        throw new ProviderBrokerError("provider function arguments must be a JSON object", { status: response.status });
      }
      functionCallCount += 1;
      await handlers.onFunctionCall?.({ ...call, arguments: finalArguments });
      functionCalls.delete(itemId);
      return;
    }
    if (event.type === "response.completed") {
      if (event.response?.status !== undefined && event.response.status !== "completed") {
        throw new ProviderBrokerError("provider stream completed with an invalid status", { status: response.status });
      }
      completed = true;
      return;
    }
    if (event.type === "error" || event.type === "response.failed") {
      throw new ProviderBrokerError("provider stream failed", { status: response.status });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderBrokerError("provider stream exceeds the 2 MB safety limit", { status: response.status });
      }
      pending += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      const blocks = pending.split("\n\n");
      pending = blocks.pop() ?? "";
      for (const block of blocks) await consumeEvent(block);
    }
    pending += decoder.decode();
    if (pending.trim()) await consumeEvent(pending);
  } catch (error: unknown) {
    if (error instanceof ProviderBrokerError) throw error;
    throw new ProviderBrokerError(signal.aborted ? "provider request cancelled" : "provider stream could not be read", { status: response.status });
  } finally {
    signal.removeEventListener("abort", abort);
  }
  if (signal.aborted) throw new ProviderBrokerError("provider request cancelled", { status: response.status });
  if (!completed) throw new ProviderBrokerError("provider stream ended before completion", { status: response.status });
  if (functionCalls.size > 0) throw new ProviderBrokerError("provider stream ended with incomplete function calls", { status: response.status });
  return { completed: true, deltaCount, outputTextChars, functionCallCount };
}

async function performOpenAIStream(
  apiKey: string,
  untrustedRequest: OpenAITextRequest,
  fetcher: typeof fetch,
  handlers: OpenAIStreamHandlers,
  signal?: AbortSignal,
  budget?: ProviderBudgetTracker
): Promise<OpenAIStreamResult> {
  const request = validateRequest(untrustedRequest);
  budget?.consumeRequest(request);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetcher(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(createRequestBody(request, true)),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderBrokerError(`provider request failed with HTTP ${response.status}`, { status: response.status, requestId });
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderBrokerError("provider returned an unsupported streaming content type", { status: response.status, requestId });
    }
    return await readBoundedResponseStream(response, handlers, controller.signal, budget);
  } catch (error: unknown) {
    if (timedOut) throw new ProviderBrokerError("provider request timed out");
    if (error instanceof ProviderBrokerError) throw error;
    throw new ProviderBrokerError(controller.signal.aborted ? "provider request cancelled" : "provider streaming network request failed");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function requestOpenAIResponse(request: OpenAITextRequest, signal?: AbortSignal): Promise<unknown> {
  return withProviderCredential("openai", (apiKey) => performOpenAIRequest(apiKey, request, fetch, signal));
}

export async function requestOpenAIResponseWithTransport(
  request: OpenAITextRequest,
  fetcher: typeof fetch,
  credentialProvider: CredentialProvider,
  signal?: AbortSignal
): Promise<unknown> {
  return withProviderCredential(credentialProvider, (apiKey) => performOpenAIRequest(apiKey, request, fetcher, signal));
}

export async function streamOpenAIResponseWithTransport(
  request: OpenAITextRequest,
  fetcher: typeof fetch,
  credentialProvider: CredentialProvider,
  handlers: OpenAIStreamHandlers,
  signal?: AbortSignal,
  budget?: ProviderBudgetTracker
): Promise<OpenAIStreamResult> {
  return withProviderCredential(
    credentialProvider,
    (apiKey) => performOpenAIStream(apiKey, request, fetcher, handlers, signal, budget)
  );
}

export function extractOpenAIResponseText(value: unknown): string {
  if (!value || typeof value !== "object") throw new ProviderBrokerError("provider response is not an object");
  const response = value as { status?: unknown; output?: unknown };
  if (response.status !== "completed" || !Array.isArray(response.output)) {
    throw new ProviderBrokerError("provider response did not complete");
  }
  const text = response.output.flatMap((item) => {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => part && typeof part === "object"
      && (part as { type?: unknown }).type === "output_text"
      && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : []);
  }).join("");
  if (!text) throw new ProviderBrokerError("provider response contains no output text");
  if (text.length > MAX_INPUT_CHARS) throw new ProviderBrokerError("provider output text exceeds the 100,000 character limit");
  return text;
}

export async function runProviderBrokerPolicyProbe(): Promise<ProviderBrokerProbe> {
  const probeSecret = `clawsembly-provider-probe-${crypto.randomUUID()}`;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    capturedInit = init;
    return new Response(JSON.stringify({
      id: "resp_clawsembly_probe",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "Broker policy passed." }] }]
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_clawsembly_probe" }
    });
  };
  const result = await performOpenAIRequest(
    probeSecret,
    { model: "clawsembly-policy-probe", input: "Verify the provider boundary." },
    fakeFetch
  );
  const headers = new Headers(capturedInit?.headers);
  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  const authorizationApplied = headers.get("authorization") === `Bearer ${probeSecret}`;
  const publicProbeMaterial = JSON.stringify({ result, body, url: capturedUrl, method: capturedInit?.method });
  const secretRedacted = !publicProbeMaterial.includes(probeSecret);
  const outputTextValidated = extractOpenAIResponseText(result) === "Broker policy passed.";
  let invalidOutputRejected = false;
  try {
    extractOpenAIResponseText({ status: "completed", output: [] });
  } catch (error: unknown) {
    invalidOutputRejected = error instanceof ProviderBrokerError && error.message.includes("no output text");
  }

  let invalidModelRejected = false;
  try {
    await performOpenAIRequest(probeSecret, { model: "../invalid model", input: "blocked" }, fakeFetch);
  } catch (error: unknown) {
    invalidModelRejected = error instanceof ProviderBrokerError && error.message.includes("model identifier");
  }

  let oversizedResponseRejected = false;
  const oversizedFetch: typeof fetch = async () => new Response("", {
    status: 200,
    headers: { "content-type": "application/json", "content-length": String(MAX_RESPONSE_BYTES + 1) }
  });
  try {
    await performOpenAIRequest(probeSecret, { model: "clawsembly-policy-probe", input: "bounded" }, oversizedFetch);
  } catch (error: unknown) {
    oversizedResponseRejected = error instanceof ProviderBrokerError && error.message.includes("2 MB");
  }

  let capturedStreamInit: RequestInit | undefined;
  const streamingFetch: typeof fetch = async (_input, init) => {
    capturedStreamInit = init;
    const events = [
      { type: "response.created", response: { status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Broker " },
      { type: "response.output_text.delta", delta: "stream passed." },
      { type: "response.completed", response: { status: "completed" } }
    ];
    const streamText = `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
    return new Response(streamText, {
      status: 200,
      headers: { "content-type": "text/event-stream", "x-request-id": "req_stream_probe" }
    });
  };
  const streamDeltas: string[] = [];
  const streamResult = await performOpenAIStream(
    probeSecret,
    { model: "clawsembly-policy-probe", input: "Verify typed streaming." },
    streamingFetch,
    { onTextDelta: (delta) => { streamDeltas.push(delta); } }
  );
  const streamBody = JSON.parse(String(capturedStreamInit?.body)) as Record<string, unknown>;
  const streamingEventsValidated = streamResult.completed
    && streamResult.deltaCount === 2
    && streamResult.functionCallCount === 0
    && streamDeltas.join("") === "Broker stream passed."
    && streamBody.store === false
    && streamBody.stream === true;

  const functionCallFetch: typeof fetch = async () => {
    const item = { type: "function_call", id: "fc_probe", call_id: "call_probe", name: "agents_list", arguments: "" };
    const events = [
      { type: "response.output_item.added", item },
      { type: "response.function_call_arguments.delta", item_id: item.id, delta: "{}" },
      { type: "response.function_call_arguments.done", item_id: item.id, arguments: "{}" },
      { type: "response.completed", response: { status: "completed" } }
    ];
    const streamText = `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
    return new Response(streamText, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const functionCalls: OpenAIStreamFunctionCall[] = [];
  const functionResult = await performOpenAIStream(
    probeSecret,
    { model: "clawsembly-policy-probe", input: "Verify function streaming." },
    functionCallFetch,
    {
      onTextDelta: () => undefined,
      onFunctionCall: (call) => { functionCalls.push(call); }
    }
  );
  const functionCallEventsValidated = functionResult.functionCallCount === 1
    && functionCalls.length === 1
    && functionCalls[0]?.callId === "call_probe"
    && functionCalls[0]?.name === "agents_list"
    && functionCalls[0]?.arguments === "{}";

  let functionResultBody: Record<string, unknown> | undefined;
  const functionResultFetch: typeof fetch = async (_input, init) => {
    functionResultBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "Function result input passed." }] }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const functionResultInput: OpenAIResponseInput = [
    { role: "user", content: "List agents." },
    { type: "function_call", call_id: "call_input_probe", name: "agents_list", arguments: "{}" },
    { type: "function_call_output", call_id: "call_input_probe", output: "{\"agents\":[]}" }
  ];
  await performOpenAIRequest(
    probeSecret,
    { model: "clawsembly-policy-probe", input: functionResultInput, maxOutputTokens: 128 },
    functionResultFetch
  );
  let mismatchedFunctionResultRejected = false;
  try {
    await performOpenAIRequest(probeSecret, {
      model: "clawsembly-policy-probe",
      input: [{ type: "function_call_output", call_id: "call_unknown", output: "{}" }]
    }, functionResultFetch);
  } catch (error: unknown) {
    mismatchedFunctionResultRejected = error instanceof ProviderBrokerError
      && error.message.includes("function call output");
  }
  const functionResultInputValidated = JSON.stringify(functionResultBody?.input) === JSON.stringify(functionResultInput)
    && mismatchedFunctionResultRejected;
  let invalidMaxOutputTokensRejected = false;
  try {
    await performOpenAIRequest(probeSecret, {
      model: "clawsembly-policy-probe",
      input: "blocked",
      maxOutputTokens: 0
    }, functionResultFetch);
  } catch (error: unknown) {
    invalidMaxOutputTokensRejected = error instanceof ProviderBrokerError
      && error.message.includes("output token limit");
  }
  const maxOutputTokensValidated = functionResultBody?.max_output_tokens === 128
    && invalidMaxOutputTokensRejected;

  const budgetProbe = new ProviderBudgetTracker({ maxRequests: 1, maxInputChars: 16, maxOutputChars: 5 });
  budgetProbe.consumeRequest({ model: "budget-probe", input: "12345678" });
  budgetProbe.consumeOutput(5);
  let requestBudgetRejected = false;
  let outputBudgetRejected = false;
  try { budgetProbe.consumeRequest({ model: "budget-probe", input: "1" }); }
  catch (error: unknown) {
    requestBudgetRejected = error instanceof ProviderBrokerError && error.message.includes("request budget");
  }
  try { budgetProbe.consumeOutput(1); }
  catch (error: unknown) {
    outputBudgetRejected = error instanceof ProviderBrokerError && error.message.includes("output budget");
  }
  const budgetSnapshot = budgetProbe.snapshot();
  const requestBudgetValidated = requestBudgetRejected && outputBudgetRejected
    && budgetSnapshot.requestsUsed === 1 && budgetSnapshot.inputCharsUsed === 8
    && budgetSnapshot.outputCharsUsed === 5;

  let cancellationStreamCancelled = false;
  const cancellationController = new AbortController();
  const cancellationFetch: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const event = { type: "response.output_text.delta", delta: "cancel-now" };
      controller.enqueue(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    },
    cancel() { cancellationStreamCancelled = true; }
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  let cancellationPropagated = false;
  try {
    await performOpenAIStream(
      probeSecret,
      { model: "clawsembly-policy-probe", input: "Verify cancellation." },
      cancellationFetch,
      { onTextDelta: () => { cancellationController.abort(); } },
      cancellationController.signal
    );
  } catch (error: unknown) {
    cancellationPropagated = error instanceof ProviderBrokerError
      && error.message.includes("cancelled")
      && cancellationStreamCancelled;
  }

  let bodyAbortObserved = false;
  const stalledBodyFetch: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    cancel() { bodyAbortObserved = true; }
  }), { status: 200, headers: { "content-type": "application/json" } });
  const bodyController = new AbortController();
  const stalledRequest = performOpenAIRequest(
    probeSecret,
    { model: "clawsembly-policy-probe", input: "Verify stalled body cancellation." },
    stalledBodyFetch,
    bodyController.signal
  );
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  bodyController.abort();
  const stalledOutcome = await Promise.race([
    stalledRequest.then(() => "resolved", (error: unknown) => error instanceof ProviderBrokerError
      && error.message.includes("cancelled") ? "cancelled" : "rejected"),
    new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 250))
  ]);
  const bodyCancellationPropagated = stalledOutcome === "cancelled" && bodyAbortObserved;

  // Named conditions so a regression reports which invariant broke instead of
  // one opaque boolean. Names are static identifiers; no payload material.
  const conditions: Record<string, boolean> = {
    endpointPinned: capturedUrl === OPENAI_RESPONSES_ENDPOINT,
    postMethod: capturedInit?.method === "POST",
    redirectRefused: capturedInit?.redirect === "error",
    credentialsOmitted: capturedInit?.credentials === "omit",
    referrerSuppressed: capturedInit?.referrerPolicy === "no-referrer",
    storeDisabled: body.store === false,
    streamDisabledByDefault: body.stream === false,
    exactBodyKeys: Object.keys(body).sort().join(",") === "input,model,store,stream",
    authorizationApplied,
    secretRedacted,
    outputTextValidated,
    invalidOutputRejected,
    invalidModelRejected,
    oversizedResponseRejected,
    streamingEventsValidated,
    functionCallEventsValidated,
    functionResultInputValidated,
    maxOutputTokensValidated,
    requestBudgetValidated,
    cancellationPropagated,
    bodyCancellationPropagated
  };
  const failedConditions = Object.entries(conditions)
    .filter(([, satisfied]) => !satisfied)
    .map(([name]) => name);
  if (failedConditions.length > 0) {
    throw new Error(`provider broker policy self-test failed: ${failedConditions.join(", ")}`);
  }

  return {
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    method: "POST",
    redirectPolicy: "error",
    browserCredentials: "omit",
    responseLimitBytes: MAX_RESPONSE_BYTES,
    store: false,
    stream: false,
    authorizationApplied: true,
    secretRedacted: true,
    invalidModelRejected: true,
    oversizedResponseRejected: true,
    outputTextValidated: true,
    invalidOutputRejected: true,
    streamingEventsValidated: true,
    functionCallEventsValidated: true,
    functionResultInputValidated: true,
    maxOutputTokensValidated: true,
    requestBudgetValidated: true,
    cancellationPropagated: true,
    bodyCancellationPropagated: true,
    result: "pass"
  };
}
