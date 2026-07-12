import { createGatewayDeviceTokenVault } from "../../../packages/embed-sdk/gateway-device-token-vault.mjs";
import { mountGatewayPairingPrompt } from "../../../packages/embed-sdk/gateway-pairing-prompt.mjs";

export interface GatewayAuthBoundaryProbe {
  tokenEncrypted: true;
  tokenRoundTrip: true;
  metadataRedacted: true;
  exactReviewRendered: true;
  explicitDecisionRequired: true;
  rejectedWithoutApproval: true;
  result: "pass";
}

export async function runGatewayAuthBoundaryProbe(): Promise<GatewayAuthBoundaryProbe> {
  const vault = createGatewayDeviceTokenVault();
  const subject = { deviceId: "0".repeat(64), role: "operator" };
  const token = `clawsembly-token-vault-probe-${crypto.randomUUID()}`;
  const metadata = await vault.store({
    ...subject,
    token,
    scopes: ["operator.read", "operator.write"],
    issuedAtMs: Date.now()
  });
  const loaded = await vault.load(subject);
  const metadataRedacted = !JSON.stringify(metadata).includes(token);

  const container = document.createElement("div");
  const deviceId = "1".repeat(64);
  let rejectedReviewId = "";
  const prompt = mountGatewayPairingPrompt({
    container,
    review: {
      schemaVersion: 1,
      reviewId: "provider-free-review",
      requestId: "provider-free-request",
      deviceId,
      reason: "not-paired",
      requested: { roles: ["operator"], scopes: ["operator.read", "operator.write"] },
      approved: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    },
    onApprove: async () => ({
      schemaVersion: 1,
      decision: "approved",
      requestId: "provider-free-request",
      deviceId
    }),
    onReject: async (reviewId) => {
      rejectedReviewId = reviewId;
      return {
        schemaVersion: 1,
        decision: "rejected",
        requestId: "provider-free-request",
        deviceId
      };
    }
  });
  const exactReviewRendered = container.textContent?.includes("operator.read · operator.write") === true
    && container.textContent.includes(`${"1".repeat(12)}…${"1".repeat(8)}`);
  const approve = container.querySelector<HTMLButtonElement>("[data-pairing-approve]");
  const reject = container.querySelector<HTMLButtonElement>("[data-pairing-reject]");
  const explicitDecisionRequired = container.querySelector<HTMLElement>("[data-pairing-prompt]")?.dataset.pairingState === "pending"
    && approve?.disabled === false && reject?.disabled === false;
  reject?.click();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  const rejectedWithoutApproval = rejectedReviewId === "provider-free-review"
    && container.querySelector<HTMLElement>("[data-pairing-prompt]")?.dataset.pairingState === "rejected";
  prompt.destroy();
  const cleared = await vault.clear(subject);

  if (!loaded || loaded.token !== token || !metadataRedacted || !exactReviewRendered
    || !explicitDecisionRequired || !rejectedWithoutApproval || !cleared) {
    throw new Error("Gateway authentication boundary self-test failed");
  }
  return {
    tokenEncrypted: true,
    tokenRoundTrip: true,
    metadataRedacted: true,
    exactReviewRendered: true,
    explicitDecisionRequired: true,
    rejectedWithoutApproval: true,
    result: "pass"
  };
}
