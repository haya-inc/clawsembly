import { runDeviceIdentityProbe } from "./device-identity";
import { createGatewayDeviceTokenVault } from "../../../packages/embed-sdk/gateway-device-token-vault.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "../../../packages/embed-sdk/openclaw-gateway-contract.generated.mjs";
import { runGatewayAuthBoundaryProbe } from "./gateway-auth-probe";

export function setupDeviceIdentity(): void {
  const status = document.querySelector<HTMLElement>("[data-device-health]");
  const id = document.querySelector<HTMLElement>("[data-device-id]");
  if (!status || !id) return;
  const refresh = () => Promise.all([runDeviceIdentityProbe(), runGatewayAuthBoundaryProbe()])
    .then(async ([probe]) => {
      const token = await createGatewayDeviceTokenVault().metadata({
        deviceId: probe.deviceId,
        role: OPENCLAW_GATEWAY_CONTRACT.profile.role
      });
      status.dataset.state = "pass";
      status.textContent = token
        ? "SIGNATURE + TOKEN STORED / PASS"
        : "SIGNATURE + PAIRING UI + TOKEN VAULT / PASS";
      id.textContent = `${probe.deviceId.slice(0, 12)}…`;
      id.title = probe.deviceId;
    }).catch((error: unknown) => {
      status.dataset.state = "fail";
      status.textContent = "IDENTITY / FAIL";
      id.textContent = error instanceof Error ? error.message : "Device identity unavailable";
    });

  void refresh();
  window.addEventListener("clawsembly:device-token-stored", () => { void refresh(); });
}
