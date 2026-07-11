import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import { removeProviderCredential, storeProviderCredential } from "./credential-vault";
import {
  OPENAI_BROKER_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
  ProviderBudgetTracker,
  streamOpenAIResponseWithTransport,
  type OpenAIFunctionTool,
  type OpenAIResponseInput
} from "./provider-broker";
import {
  createStoredStateBackup,
  decodeStateBackup,
  exportStateSnapshot,
  loadStateSnapshot,
  persistStateSnapshot,
  verifyStateBackupGuards
} from "./state-persistence";
import {
  GATEWAY_PROBE_TOKEN,
  HOST_BROKER_CAPABILITY,
  appendOutput,
  cleanTerminal,
  runTransientProcessProbe,
  verifyBrowserDeviceHandshake,
  verifyControlUiPairing,
  verifyRecoveredTranscript,
  type InstallPerformanceEvidence
} from "./runtime-probe-support";

interface GatewayProbeOptions {
  gatewayButton: HTMLButtonElement | null;
  installOutput: HTMLElement | null;
  budgetRequestsInput: HTMLInputElement | null;
  budgetInputCharsInput: HTMLInputElement | null;
  budgetOutputCharsInput: HTMLInputElement | null;
  getActiveContainer: () => WebContainer | undefined;
  setActiveContainer: (container: WebContainer | undefined) => void;
  getInstallPerformance: () => InstallPerformanceEvidence | undefined;
  showStoredState: (snapshot: Uint8Array | undefined, message?: string) => void;
}

export function setupGatewayProbe({
  gatewayButton,
  installOutput,
  budgetRequestsInput,
  budgetInputCharsInput,
  budgetOutputCharsInput,
  getActiveContainer,
  setActiveContainer,
  getInstallPerformance,
  showStoredState
}: GatewayProbeOptions): void {
  gatewayButton?.addEventListener("click", async () => {
    const activeContainer = getActiveContainer();
    if (!activeContainer || !installOutput) return;
    gatewayButton.disabled = true;
    gatewayButton.textContent = "Starting Gateway…";
    const readBudget = (input: HTMLInputElement | null, fallback: number) => {
      const value = Number(input?.value ?? fallback);
      return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    };
    const brokerBudgetLimits = {
      maxRequests: readBudget(budgetRequestsInput, 4),
      maxInputChars: readBudget(budgetInputCharsInput, 100_000),
      maxOutputChars: readBudget(budgetOutputCharsInput, 100_000)
    };
    for (const input of [budgetRequestsInput, budgetInputCharsInput, budgetOutputCharsInput]) {
      if (input) input.disabled = true;
    }
    appendOutput(
      installOutput,
      "\n$ node adapter/openclaw-bootstrap.mjs --dev gateway --allow-unconfigured --token <ephemeral-probe-token>\n"
    );

    let unsubscribe: (() => void) | undefined;
    let gateway: WebContainerProcess | undefined;
    let outputComplete: Promise<void> | undefined;
    let mockProvider: WebContainerProcess | undefined;
    let mockOutputComplete: Promise<void> | undefined;
    let hostBrokerProvider: WebContainerProcess | undefined;
    let hostBrokerOutputComplete: Promise<void> | undefined;
    let gatewayPortReadyMs = 0;
    let gatewayProtocolReadyMs = 0;
    let recoveryCompleted = false;
    try {
      const installPerformance = getInstallPerformance();
      if (!installPerformance) throw new Error("install performance evidence is unavailable");
      const brokerProbeSecret = `sk-clawsembly-host-broker-${crypto.randomUUID()}`;
      await storeProviderCredential("broker-probe", brokerProbeSecret);
      const config = {
        gateway: {
          controlUi: { allowedOrigins: ["http://127.0.0.1:19001", "http://localhost:19001"] }
        },
        agents: {
          defaults: { model: { primary: "clawsembly-mock/mock-v1" }, skipBootstrap: true },
          list: [
            { id: "main", default: true, workspace: "~/.openclaw/workspace-dev" },
            {
              id: "broker",
              workspace: "~/.openclaw/workspace-broker",
              model: "clawsembly-browser-host/broker-v1"
            }
          ]
        },
        models: {
          mode: "merge",
          providers: {
            "clawsembly-mock": {
              baseUrl: "http://127.0.0.1:19002/v1",
              apiKey: "clawsembly-local",
              api: "openai-completions",
              models: [{
                id: "mock-v1",
                name: "Clawsembly deterministic mock",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 120_000,
                maxTokens: 8_192
              }]
            },
            "clawsembly-browser-host": {
              baseUrl: "http://127.0.0.1:19003/v1",
              apiKey: HOST_BROKER_CAPABILITY,
              api: "openai-completions",
              models: [{
                id: "broker-v1",
                name: "Clawsembly browser-host Responses bridge",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 120_000,
                maxTokens: 8_192
              }]
            }
          }
        },
        tools: { allow: ["agents_list"] }
      };
      await activeContainer.fs.mkdir(".clawsembly-openclaw", { recursive: true });
      await activeContainer.fs.writeFile(
        ".clawsembly-openclaw/openclaw.json",
        JSON.stringify(config, null, 2)
      );

      let resolveMockReady: (() => void) | undefined;
      const mockReady = new Promise<void>((resolve) => { resolveMockReady = resolve; });
      mockProvider = await activeContainer.spawn("node", ["adapter/mock-openai-server.mjs"], {
        env: { NO_COLOR: "1", CLAWSEMBLY_MOCK_PORT: "19002" }
      });
      mockOutputComplete = mockProvider.output.pipeTo(new WritableStream({
        write(chunk: string) {
          appendOutput(installOutput, `[mock-provider] ${chunk}`);
          if (chunk.includes('"event":"ready"')) resolveMockReady?.();
        }
      }));
      const mockOutcome = await Promise.race([
        mockReady.then(() => "ready" as const),
        mockProvider.exit.then(() => "exit" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 5_000))
      ]);
      if (mockOutcome !== "ready") throw new Error(`mock provider did not start (${mockOutcome})`);

      let resolveHostBrokerReady: (() => void) | undefined;
      const hostBrokerReady = new Promise<void>((resolve) => { resolveHostBrokerReady = resolve; });
      let hostBrokerPending = "";
      let brokerRequestCount = 0;
      let brokerPolicyPassCount = 0;
      let brokerStreamDeltaCount = 0;
      let brokerCompletedCount = 0;
      let brokerToolCallCount = 0;
      let brokerToolResultRequestCount = 0;
      let brokerHostCancelCount = 0;
      let brokerProviderCancelCount = 0;
      let brokerCancellationPropagated = 0;
      const brokerBudget = new ProviderBudgetTracker({
        ...brokerBudgetLimits
      });
      const brokerControllers = new Map<string, AbortController>();
      const brokerTaskHistory: Promise<void>[] = [];
      hostBrokerProvider = await activeContainer.spawn("node", ["adapter/host-broker-openai-server.mjs"], {
        env: {
          NO_COLOR: "1",
          CLAWSEMBLY_HOST_BROKER_PORT: "19003",
          CLAWSEMBLY_HOST_BROKER_CAPABILITY: HOST_BROKER_CAPABILITY,
          CLAWSEMBLY_HOST_BROKER_MAX_REQUESTS: "4"
        }
      });
      const hostBrokerWriter = hostBrokerProvider.input.getWriter();
      let hostBrokerWriteChain = Promise.resolve();
      const sendHostBrokerMessage = (message: unknown) => {
        hostBrokerWriteChain = hostBrokerWriteChain.then(() => hostBrokerWriter.write(`${JSON.stringify(message)}\n`));
        return hostBrokerWriteChain;
      };
      hostBrokerOutputComplete = hostBrokerProvider.output.pipeTo(new WritableStream({
        write(chunk: string) {
          hostBrokerPending += cleanTerminal(chunk);
          const lines = hostBrokerPending.split("\n");
          hostBrokerPending = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("[host-broker-ready] ")) {
              resolveHostBrokerReady?.();
              appendOutput(installOutput, `${line}\n`);
              continue;
            }
            if (line.startsWith("[host-broker-cancel] ")) {
              const cancellation = JSON.parse(line.slice("[host-broker-cancel] ".length)) as { id?: string };
              const controller = cancellation.id ? brokerControllers.get(cancellation.id) : undefined;
              if (controller && !controller.signal.aborted) {
                brokerHostCancelCount += 1;
                controller.abort();
              }
              appendOutput(installOutput, "[host-broker-cancel] provider AbortSignal triggered\n");
              continue;
            }
            if (!line.startsWith("[host-broker-request] ")) {
              if (line.trim()) appendOutput(installOutput, `[host-broker-process] ${line}\n`);
              continue;
            }
            const request = JSON.parse(line.slice("[host-broker-request] ".length)) as {
              id: string;
              model: string;
              input: OpenAIResponseInput;
              stream: boolean;
              tools: OpenAIFunctionTool[];
              hasToolResult: boolean;
            };
            brokerRequestCount += 1;
            const controller = new AbortController();
            brokerControllers.set(request.id, controller);
            const task = (async () => {
              try {
                if (request.model !== "broker-v1" || request.stream !== true
                  || !Array.isArray(request.tools) || request.tools.length !== 1
                  || request.tools[0]?.name !== "agents_list" || request.tools[0]?.strict !== true) {
                  throw new Error("unapproved bridge request");
                }
                const serializedInput = typeof request.input === "string" ? request.input : JSON.stringify(request.input);
                const isCancellationProbe = serializedInput.includes("BROKER_CANCEL_ME");
                if (request.hasToolResult) brokerToolResultRequestCount += 1;
                const fakeFetch: typeof fetch = async (input, init) => {
                  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
                  const headers = new Headers(init?.headers);
                  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                  const outboundTools = body.tools as Array<{ name?: unknown }> | undefined;
                  const outboundInput = body.input as OpenAIResponseInput;
                  const outboundItems = Array.isArray(outboundInput) ? outboundInput : [];
                  const outboundFunctionCalls = outboundItems.filter(
                    (item) => "type" in item && item.type === "function_call"
                  );
                  const outboundFunctionOutputs = outboundItems.filter(
                    (item) => "type" in item && item.type === "function_call_output"
                  );
                  const exactToolPairs = outboundFunctionOutputs.every((output) => output.type === "function_call_output"
                    && outboundFunctionCalls.some((call) => call.type === "function_call"
                      && call.call_id === output.call_id));
                  const lastUserIndex = outboundItems.findLastIndex((item) => "role" in item && item.role === "user");
                  const lastFunctionOutputIndex = outboundItems.findLastIndex(
                    (item) => "type" in item && item.type === "function_call_output"
                  );
                  const currentToolContinuation = lastFunctionOutputIndex > lastUserIndex;
                  const policyPassed = headers.get("authorization") === `Bearer ${brokerProbeSecret}`
                    && url === OPENAI_RESPONSES_ENDPOINT
                    && init?.method === "POST"
                    && init.redirect === "error"
                    && init.credentials === "omit"
                    && init.referrerPolicy === "no-referrer"
                    && body.model === OPENAI_BROKER_MODEL
                    && body.store === false
                    && body.stream === true
                    && Array.isArray(outboundTools)
                    && outboundTools.length === 1
                    && outboundTools[0]?.name === "agents_list"
                    && Array.isArray(outboundInput)
                    && exactToolPairs
                    && currentToolContinuation === request.hasToolResult;
                  if (!policyPassed) throw new Error("browser host broker policy mismatch");
                  brokerPolicyPassCount += 1;
                  const encoder = new TextEncoder();
                  const encodeEvent = (event: Record<string, unknown>) => encoder.encode(
                    `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`
                  );
                  return new Response(new ReadableStream<Uint8Array>({
                    start(streamController) {
                      streamController.enqueue(encodeEvent({ type: "response.created", response: { status: "in_progress" } }));
                      if (isCancellationProbe) {
                        streamController.enqueue(encodeEvent({ type: "response.output_text.delta", delta: "Broker cancellation started." }));
                        return;
                      }
                      if (!request.hasToolResult) {
                        const item = {
                          type: "function_call",
                          id: "fc_clawsembly_agents",
                          call_id: "call_clawsembly_broker_agents",
                          name: "agents_list",
                          arguments: ""
                        };
                        streamController.enqueue(encodeEvent({ type: "response.output_item.added", item }));
                        streamController.enqueue(encodeEvent({
                          type: "response.function_call_arguments.delta",
                          item_id: item.id,
                          delta: "{}"
                        }));
                        streamController.enqueue(encodeEvent({
                          type: "response.function_call_arguments.done",
                          item_id: item.id,
                          arguments: "{}"
                        }));
                        streamController.enqueue(encodeEvent({ type: "response.completed", response: { status: "completed" } }));
                        streamController.close();
                        return;
                      }
                      streamController.enqueue(encodeEvent({ type: "response.output_text.delta", delta: "Clawsembly browser-host " }));
                      streamController.enqueue(encodeEvent({ type: "response.output_text.delta", delta: "broker tool round-trip passed." }));
                      streamController.enqueue(encodeEvent({ type: "response.completed", response: { status: "completed" } }));
                      streamController.close();
                    },
                    cancel() { brokerProviderCancelCount += 1; }
                  }), {
                    status: 200,
                    headers: { "content-type": "text/event-stream", "x-request-id": "req_host_broker_probe" }
                  });
                };
                await streamOpenAIResponseWithTransport(
                  { model: OPENAI_BROKER_MODEL, input: request.input, tools: request.tools },
                  fakeFetch,
                  "broker-probe",
                  {
                    onTextDelta: async (delta) => {
                      brokerStreamDeltaCount += 1;
                      await sendHostBrokerMessage({ id: request.id, event: "delta", delta });
                    },
                    onFunctionCall: async (call) => {
                      brokerToolCallCount += 1;
                      await sendHostBrokerMessage({ id: request.id, event: "tool_call", ...call });
                    }
                  },
                  controller.signal,
                  brokerBudget
                );
                brokerCompletedCount += 1;
                await sendHostBrokerMessage({ id: request.id, event: "done" });
                appendOutput(installOutput, `[host-broker-request] ${JSON.stringify({
                  modelAlias: request.model,
                  hostModel: OPENAI_BROKER_MODEL,
                  inputChars: serializedInput.length,
                  streaming: true,
                  credentialInWebContainer: false,
                  result: "pass"
                })}\n`);
              } catch {
                if (controller.signal.aborted) brokerCancellationPropagated += 1;
                await sendHostBrokerMessage({ id: request.id, event: "error" }).catch(() => undefined);
                if (!controller.signal.aborted) appendOutput(installOutput, "[host-broker-request] rejected by browser-host policy\n");
              } finally {
                brokerControllers.delete(request.id);
              }
            })();
            brokerTaskHistory.push(task);
          }
        }
      }));
      const hostBrokerOutcome = await Promise.race([
        hostBrokerReady.then(() => "ready" as const),
        hostBrokerProvider.exit.then(() => "exit" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 5_000))
      ]);
      if (hostBrokerOutcome !== "ready") throw new Error(`browser-host provider bridge did not start (${hostBrokerOutcome})`);

      const serverReady = new Promise<{ port: number; url: string }>((resolve) => {
        unsubscribe = activeContainer?.on("server-ready", (port, url) => resolve({ port, url }));
      });
      let resolveGatewayReady: (() => void) | undefined;
      const gatewayReady = new Promise<void>((resolve) => { resolveGatewayReady = resolve; });
      let gatewayLogTail = "";
      const gatewayStarted = performance.now();
      gateway = await activeContainer.spawn(
        "node",
        [
          "adapter/openclaw-bootstrap.mjs",
          "--dev",
          "gateway",
          "--allow-unconfigured",
          "--token",
          GATEWAY_PROBE_TOKEN
        ],
        {
          env: {
            CI: "1",
            NO_COLOR: "1",
            OPENCLAW_SKIP_CHANNELS: "1",
            OPENCLAW_STATE_DIR: ".clawsembly-openclaw"
          }
        }
      );
      outputComplete = gateway.output.pipeTo(new WritableStream({
        write(chunk: string) {
          appendOutput(installOutput, chunk);
          gatewayLogTail = `${gatewayLogTail}${cleanTerminal(chunk)}`.slice(-2_000);
          if (gatewayLogTail.includes("[gateway] ready")) resolveGatewayReady?.();
        }
      }));
      const outcome = await Promise.race([
        serverReady.then((ready) => ({ kind: "ready" as const, ready })),
        gateway.exit.then((code) => ({ kind: "exit" as const, code })),
        new Promise<{ kind: "timeout" }>((resolve) => window.setTimeout(() => resolve({ kind: "timeout" }), 40_000))
      ]);

      if (outcome.kind === "exit") throw new Error(`Gateway exited before readiness with ${outcome.code}`);
      if (outcome.kind === "timeout") throw new Error("Gateway did not open a port within 40 seconds");
      gatewayPortReadyMs = Math.round(performance.now() - gatewayStarted);

      appendOutput(installOutput, `\n[server-ready] ${outcome.ready.url} (port ${outcome.ready.port})\n`);
      const healthScript = [
        `const url = "http://127.0.0.1:${outcome.ready.port}/healthz"`,
        "let lastError = 'not ready'",
        "for (let attempt = 0; attempt < 20; attempt += 1) {",
        "  try {",
        "    const response = await fetch(url)",
        "    const body = await response.text()",
        "    if (response.ok) { console.log(JSON.stringify({ status: response.status, body })); process.exit(0) }",
        "    lastError = `HTTP ${response.status}`",
        "  } catch (error) { lastError = error instanceof Error ? error.message : String(error) }",
        "  await new Promise((resolve) => setTimeout(resolve, 1000))",
        "}",
        "console.error(lastError)",
        "process.exit(1)"
      ].join("\n");
      const health = await runTransientProcessProbe(activeContainer, "node", ["--input-type=module", "-e", healthScript]);
      appendOutput(installOutput, `[healthz] ${health.output.trim()}${health.attempts > 1 ? ` [attempts=${health.attempts}]` : ""}\n`);
      if (health.code !== 0) throw new Error("internal /healthz probe failed");

      const readinessScript = [
        `const url = "http://127.0.0.1:${outcome.ready.port}/readyz"`,
        "let lastError = 'not ready'",
        "for (let attempt = 0; attempt < 60; attempt += 1) {",
        "  try {",
        "    const response = await fetch(url)",
        "    const body = await response.text()",
        "    if (response.ok) { console.log(JSON.stringify({ status: response.status, body })); process.exit(0) }",
        "    lastError = `HTTP ${response.status}: ${body}`",
        "  } catch (error) { lastError = error instanceof Error ? error.message : String(error) }",
        "  await new Promise((resolve) => setTimeout(resolve, 500))",
        "}",
        "console.error(lastError)",
        "process.exit(1)"
      ].join("\n");
      const readiness = await runTransientProcessProbe(activeContainer, "node", ["--input-type=module", "-e", readinessScript]);
      appendOutput(installOutput, `[readyz] ${readiness.output.trim()}${readiness.attempts > 1 ? ` [attempts=${readiness.attempts}]` : ""}\n`);
      if (readiness.code !== 0) throw new Error("internal /readyz probe failed");

      const fullyReady = await Promise.race([
        gatewayReady.then(() => "ready" as const),
        gateway.exit.then(() => "exit" as const),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 30_000))
      ]);
      if (fullyReady !== "ready") throw new Error(`Gateway did not reach protocol readiness (${fullyReady})`);
      gatewayProtocolReadyMs = Math.round(performance.now() - gatewayStarted);
      appendOutput(installOutput, "[gateway-ready] protocol services available\n");

      const deviceHandshake = await verifyBrowserDeviceHandshake(activeContainer, outcome.ready.port, GATEWAY_PROBE_TOKEN);
      appendOutput(installOutput, `[device-handshake] ${JSON.stringify({
        deviceId: deviceHandshake.deviceId,
        protocol: deviceHandshake.protocol,
        serverVersion: deviceHandshake.serverVersion,
        signatureVersion: deviceHandshake.signatureVersion,
        privateKeyInWebContainer: false,
        result: "pass"
      })}\n`);

      const pairing = await verifyControlUiPairing(activeContainer, outcome.ready.port, GATEWAY_PROBE_TOKEN);
      appendOutput(installOutput, `[device-pairing] ${JSON.stringify({
        deviceId: pairing.deviceId,
        protocol: pairing.protocol,
        serverVersion: pairing.serverVersion,
        deviceTokenIssued: pairing.deviceTokenIssued,
        deviceTokenEncryptedAtRest: pairing.deviceTokenEncryptedAtRest,
        deviceTokenReconnect: pairing.deviceTokenReconnect,
        tokenPlaintextLogged: pairing.tokenPlaintextLogged,
        result: "pass"
      })}\n`);
      window.dispatchEvent(new CustomEvent("clawsembly:device-token-stored"));

      const brokerTurn = await activeContainer.spawn("node", ["adapter/gateway-host-broker-turn-probe.mjs"], {
        env: {
          NO_COLOR: "1",
          CLAWSEMBLY_GATEWAY_PORT: String(outcome.ready.port),
          CLAWSEMBLY_GATEWAY_TOKEN: GATEWAY_PROBE_TOKEN
        }
      });
      let brokerTurnOutput = "";
      let brokerTurnPending = "";
      const brokerTurnComplete = brokerTurn.output.pipeTo(new WritableStream({
        write(chunk: string) {
          const cleaned = cleanTerminal(chunk);
          brokerTurnOutput += cleaned;
          brokerTurnPending += cleaned;
          const lines = brokerTurnPending.split("\n");
          brokerTurnPending = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("[host-broker-abort] ")) continue;
            const activeController = [...brokerControllers.values()].find((controller) => !controller.signal.aborted);
            if (!activeController) continue;
            brokerHostCancelCount += 1;
            activeController.abort();
            appendOutput(installOutput, "[host-broker-cancel] provider AbortSignal triggered\n");
          }
        }
      }));
      const brokerTurnExit = await brokerTurn.exit;
      await brokerTurnComplete;
      await Promise.all(brokerTaskHistory);
      await hostBrokerWriteChain;
      const brokerBudgetSnapshot = brokerBudget.snapshot();
      const brokerTurnLine = cleanTerminal(brokerTurnOutput).trim().split("\n").find((line) => line.startsWith("{"));
      if (brokerTurnExit !== 0 || !brokerTurnLine) throw new Error(`browser-host broker turn failed: ${cleanTerminal(brokerTurnOutput).trim()}`);
      const brokerTurnResult = JSON.parse(brokerTurnLine) as {
        event?: string;
        state?: string;
        streaming?: boolean;
        deltaObserved?: boolean;
        toolRoundTrip?: boolean;
        cancellation?: boolean;
        abortRpc?: boolean;
        result?: string;
      };
      if (brokerTurnResult.event !== "host-broker-turn" || brokerTurnResult.state !== "final"
        || brokerTurnResult.streaming !== true || brokerTurnResult.deltaObserved !== true
        || brokerTurnResult.toolRoundTrip !== true
        || brokerTurnResult.cancellation !== true || brokerTurnResult.abortRpc !== true
        || brokerTurnResult.result !== "pass" || brokerRequestCount !== 3
        || brokerPolicyPassCount !== 3 || brokerCompletedCount !== 2
        || brokerToolCallCount !== 1 || brokerToolResultRequestCount !== 1
        || brokerStreamDeltaCount < 3 || brokerHostCancelCount !== 1
        || brokerProviderCancelCount !== 1 || brokerCancellationPropagated !== 1
        || brokerBudgetSnapshot.requestsUsed !== 3
        || brokerBudgetSnapshot.inputCharsUsed <= 0
        || brokerBudgetSnapshot.inputCharsUsed > brokerBudgetSnapshot.maxInputChars
        || brokerBudgetSnapshot.outputCharsUsed <= 0
        || brokerBudgetSnapshot.outputCharsUsed > brokerBudgetSnapshot.maxOutputChars
        || (installOutput.textContent ?? "").includes(brokerProbeSecret)) {
        throw new Error("browser-host broker turn evidence did not satisfy policy");
      }
      appendOutput(installOutput, `[host-broker-turn] ${JSON.stringify({
        openclawAgent: "broker",
        providerAlias: "clawsembly-browser-host/broker-v1",
        hostModel: OPENAI_BROKER_MODEL,
        endpoint: OPENAI_RESPONSES_ENDPOINT,
        store: false,
        streaming: true,
        typedDeltas: true,
        toolRoundTrip: true,
        responsesFunctionResultInput: true,
        budget: brokerBudgetSnapshot,
        cancellationPropagated: true,
        credentialInWebContainer: false,
        credentialPlaintextLogged: false,
        responseReachedOpenClaw: true,
        result: "pass"
      })}\n`);
      await removeProviderCredential("broker-probe");

      const lifecycle = await activeContainer.spawn("node", ["adapter/gateway-lifecycle-probe.mjs"], {
        env: {
          NO_COLOR: "1",
          CLAWSEMBLY_GATEWAY_PORT: String(outcome.ready.port),
          CLAWSEMBLY_GATEWAY_TOKEN: GATEWAY_PROBE_TOKEN
        }
      });
      let lifecycleOutput = "";
      const lifecycleComplete = lifecycle.output.pipeTo(new WritableStream({
        write(chunk: string) { lifecycleOutput += chunk; }
      }));
      const lifecycleExit = await lifecycle.exit;
      await lifecycleComplete;
      appendOutput(installOutput, `[lifecycle] ${lifecycleOutput.trim()}\n`);
      if (lifecycleExit !== 0) throw new Error("Gateway lifecycle probe failed");

      gatewayButton.textContent = "Persisting state…";
      if (gateway) {
        try { gateway.kill(); } catch { /* Process may already be closed. */ }
        await gateway.exit.catch(() => undefined);
        await outputComplete?.catch(() => undefined);
        gateway = undefined;
        outputComplete = undefined;
      }
      if (mockProvider) {
        try { mockProvider.kill(); } catch { /* Process may already be closed. */ }
        await mockProvider.exit.catch(() => undefined);
        await mockOutputComplete?.catch(() => undefined);
        mockProvider = undefined;
        mockOutputComplete = undefined;
      }
      if (hostBrokerProvider) {
        try { hostBrokerProvider.kill(); } catch { /* Process may already be closed. */ }
        await hostBrokerProvider.exit.catch(() => undefined);
        await hostBrokerOutputComplete?.catch(() => undefined);
        hostBrokerProvider = undefined;
        hostBrokerOutputComplete = undefined;
      }
      unsubscribe?.();
      unsubscribe = undefined;

      const snapshot = await exportStateSnapshot(activeContainer);
      const openclawVersion = document.documentElement.dataset.openclawVersion ?? "unknown";
      await persistStateSnapshot(snapshot, openclawVersion);
      const storedBackup = await createStoredStateBackup(openclawVersion);
      if (!storedBackup) throw new Error("versioned state backup was not persisted");
      const verifiedBackup = await decodeStateBackup(storedBackup);
      const backupGuards = await verifyStateBackupGuards(storedBackup);
      showStoredState(snapshot);
      activeContainer.teardown();
      setActiveContainer(undefined);

      const { WebContainer } = await import("@webcontainer/api");
      const recoveredContainer = await WebContainer.boot({ coep: "credentialless" });
      await recoveredContainer.fs.mkdir(".clawsembly-openclaw", { recursive: true });
      const recoveredSnapshot = await loadStateSnapshot();
      if (!recoveredSnapshot) throw new Error("OPFS snapshot disappeared before recovery");
      await recoveredContainer.mount(recoveredSnapshot, { mountPoint: ".clawsembly-openclaw" });
      const recovery = await verifyRecoveredTranscript(recoveredContainer);
      setActiveContainer(recoveredContainer);
      appendOutput(installOutput, `[opfs-recovery] ${JSON.stringify({
        snapshotBytes: snapshot.byteLength,
        backupVersion: verifiedBackup.manifest.version,
        integrity: "sha256",
        ...backupGuards,
        ...recovery,
        runtimeRestart: true,
        result: "pass"
      })}\n`);
      appendOutput(installOutput, `[runtime-performance] ${JSON.stringify({
        ...installPerformance,
        gatewayPortReadyMs,
        gatewayProtocolReadyMs,
        result: "pass"
      })}\n`);
      recoveryCompleted = true;
      gatewayButton.textContent = "Runtime + recovery passed";
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "unknown Gateway error";
      appendOutput(installOutput, `\n[probe failed] ${detail}\n`);
      gatewayButton.textContent = "Gateway probe failed";
    } finally {
      for (const input of [budgetRequestsInput, budgetInputCharsInput, budgetOutputCharsInput]) {
        if (input) input.disabled = false;
      }
      if (gateway) {
        try { gateway.kill(); } catch { /* Process may already be closed. */ }
        await gateway.exit.catch(() => undefined);
        await outputComplete?.catch(() => undefined);
      }
      if (mockProvider) {
        try { mockProvider.kill(); } catch { /* Process may already be closed. */ }
        await mockProvider.exit.catch(() => undefined);
        await mockOutputComplete?.catch(() => undefined);
      }
      if (hostBrokerProvider) {
        try { hostBrokerProvider.kill(); } catch { /* Process may already be closed. */ }
        await hostBrokerProvider.exit.catch(() => undefined);
        await hostBrokerOutputComplete?.catch(() => undefined);
      }
      await removeProviderCredential("broker-probe").catch(() => undefined);
      unsubscribe?.();
      window.setTimeout(() => { gatewayButton.disabled = recoveryCompleted; }, 1800);
    }
  });
}
