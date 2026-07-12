import { getCredentialMetadata } from "./credential-vault";
import {
  extractOpenAIResponseText,
  OPENAI_BROKER_MODEL,
  requestOpenAIResponse,
  type OpenAITextRequest
} from "./provider-broker";
import { CapabilityBroker } from "../../../packages/capability-broker/capability-broker.mjs";

export const LIVE_SMOKE_PROMPT = "Reply with exactly CLAWSEMBLY_LIVE_OK and nothing else.";
export const LIVE_SMOKE_EXPECTED = "CLAWSEMBLY_LIVE_OK";
export const LIVE_SMOKE_MAX_OUTPUT_TOKENS = 128;
export const LIVE_PRICING_CAPTURED_AT = "2026-07-12";

const INPUT_USD_PER_MILLION = 1.25;
const OUTPUT_USD_PER_MILLION = 6;
const REGIONAL_UPLIFT_FACTOR = 1.1;

export interface LiveSmokeCostPreview {
  model: typeof OPENAI_BROKER_MODEL;
  promptUtf8Bytes: number;
  maxOutputTokens: typeof LIVE_SMOKE_MAX_OUTPUT_TOKENS;
  displayedUpperBoundUsd: number;
  pricingCapturedAt: typeof LIVE_PRICING_CAPTURED_AT;
}

export function getLiveSmokeCostPreview(): LiveSmokeCostPreview {
  const promptUtf8Bytes = new TextEncoder().encode(LIVE_SMOKE_PROMPT).byteLength;
  const conservativeUsd = (
    (promptUtf8Bytes * INPUT_USD_PER_MILLION)
    + (LIVE_SMOKE_MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION)
  ) / 1_000_000 * REGIONAL_UPLIFT_FACTOR;
  return {
    model: OPENAI_BROKER_MODEL,
    promptUtf8Bytes,
    maxOutputTokens: LIVE_SMOKE_MAX_OUTPUT_TOKENS,
    displayedUpperBoundUsd: Math.ceil(conservativeUsd * 1_000) / 1_000,
    pricingCapturedAt: LIVE_PRICING_CAPTURED_AT
  };
}

export async function runLiveProviderSmokeTest(signal?: AbortSignal): Promise<string> {
  const version = document.documentElement.dataset.openclawVersion;
  const integrity = document.documentElement.dataset.openclawIntegrity;
  if (!version || !integrity) throw new Error("exact OpenClaw artifact identity is unavailable");
  const scope = `model:${OPENAI_BROKER_MODEL}`;
  const broker = new CapabilityBroker({
    subject: {
      artifact: { package: "openclaw", version, integrity },
      runtime: "browser-host",
      sessionId: crypto.randomUUID()
    },
    grants: [{ capability: "provider.openai.responses", scope, maxCalls: 1 }],
    handlers: {
      "provider.openai.responses": (input, context) => requestOpenAIResponse(input as OpenAITextRequest, context.signal)
    }
  });
  const response = await broker.request<OpenAITextRequest, unknown>({
    id: crypto.randomUUID(),
    capability: "provider.openai.responses",
    scope,
    input: {
      model: OPENAI_BROKER_MODEL,
      input: LIVE_SMOKE_PROMPT,
      maxOutputTokens: LIVE_SMOKE_MAX_OUTPUT_TOKENS
    }
  }, { signal });
  const text = extractOpenAIResponseText(response).trim();
  if (text !== LIVE_SMOKE_EXPECTED) throw new Error("live provider returned an unexpected smoke-test response");
  return text;
}

export function setupLiveProvider(): void {
  const root = document.querySelector<HTMLElement>("[data-live-provider]");
  const consent = document.querySelector<HTMLInputElement>("[data-live-consent]");
  const runButton = document.querySelector<HTMLButtonElement>("[data-live-run]");
  const cancelButton = document.querySelector<HTMLButtonElement>("[data-live-cancel]");
  const status = document.querySelector<HTMLElement>("[data-live-status]");
  const output = document.querySelector<HTMLElement>("[data-live-output]");
  const cost = document.querySelector<HTMLElement>("[data-live-cost]");
  if (!root || !consent || !runButton || !cancelButton || !status || !output || !cost) return;

  const preview = getLiveSmokeCostPreview();
  cost.textContent = `≤ $${preview.displayedUpperBoundUsd.toFixed(3)} upper bound · ${preview.maxOutputTokens} output tokens · pricing checked ${preview.pricingCapturedAt}`;

  let credentialStored = false;
  let running = false;
  let controller: AbortController | undefined;

  const updateGate = () => {
    runButton.disabled = running || !credentialStored || !consent.checked;
    cancelButton.disabled = !running;
    if (running) return;
    status.textContent = credentialStored
      ? consent.checked
        ? "Live test armed · only the fixed probe prompt will be sent"
        : "Live test locked · review the disclosure and provide consent"
      : "Live test locked · save an OpenAI credential first";
  };

  const refreshCredential = async () => {
    credentialStored = Boolean(await getCredentialMetadata("openai"));
    if (!credentialStored) consent.checked = false;
    updateGate();
  };

  window.addEventListener("clawsembly:credential-state", () => { void refreshCredential(); });
  consent.addEventListener("change", updateGate);
  cancelButton.addEventListener("click", () => controller?.abort());
  runButton.addEventListener("click", async () => {
    await refreshCredential();
    if (!credentialStored || !consent.checked || running) return;
    running = true;
    controller = new AbortController();
    output.hidden = true;
    output.textContent = "";
    runButton.textContent = "Running live test…";
    status.textContent = "Sending fixed probe prompt through the browser-host Responses broker…";
    updateGate();
    let finalStatus = "Live provider smoke test failed";
    try {
      const text = await runLiveProviderSmokeTest(controller.signal);
      output.textContent = text;
      output.hidden = false;
      finalStatus = "Live test passed · completed plain-text output only";
    } catch (error: unknown) {
      finalStatus = error instanceof Error ? error.message : "Live provider smoke test failed";
    } finally {
      running = false;
      controller = undefined;
      consent.checked = false;
      runButton.textContent = "Run protected live test";
      updateGate();
      status.textContent = finalStatus;
    }
  });

  void refreshCredential();
}
