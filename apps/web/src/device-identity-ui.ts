import { runDeviceIdentityProbe } from "./device-identity";
import { getCredentialMetadata } from "./credential-vault";

export function setupDeviceIdentity(): void {
  const status = document.querySelector<HTMLElement>("[data-device-health]");
  const id = document.querySelector<HTMLElement>("[data-device-id]");
  if (!status || !id) return;
  const refresh = () => Promise.all([runDeviceIdentityProbe(), getCredentialMetadata("openclaw-device")])
    .then(([probe, token]) => {
      status.dataset.state = "pass";
      status.textContent = token ? "SIGNATURE + TOKEN / PASS" : "SIGNATURE / PASS";
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
