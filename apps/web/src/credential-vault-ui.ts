import {
  getCredentialMetadata,
  removeProviderCredential,
  runCredentialVaultProbe,
  storeProviderCredential
} from "./credential-vault";
import { runProviderBrokerPolicyProbe } from "./provider-broker";

export function setupCredentialVault(): void {
  const form = document.querySelector<HTMLFormElement>("[data-credential-vault]");
  const input = document.querySelector<HTMLInputElement>("[data-credential-input]");
  const saveButton = document.querySelector<HTMLButtonElement>("[data-save-credential]");
  const clearButton = document.querySelector<HTMLButtonElement>("[data-clear-credential]");
  const health = document.querySelector<HTMLElement>("[data-vault-health]");
  const status = document.querySelector<HTMLElement>("[data-vault-status]");
  if (!form || !input || !saveButton || !clearButton || !health || !status) return;

  const showReadyState = async (prefix = "Vault verified") => {
    const metadata = await getCredentialMetadata("openai");
    health.dataset.state = "pass";
    health.textContent = "VAULT + BROKER / PASS";
    clearButton.disabled = !metadata;
    status.textContent = metadata
      ? `${prefix} · OpenAI credential stored · browser host only`
      : `${prefix} · no OpenAI credential stored`;
    window.dispatchEvent(new CustomEvent("clawsembly:credential-state", {
      detail: { provider: "openai", stored: Boolean(metadata) }
    }));
  };

  Promise.all([runCredentialVaultProbe(), runProviderBrokerPolicyProbe()])
    .then(() => showReadyState())
    .catch((error: unknown) => {
      health.dataset.state = "fail";
      health.textContent = "VAULT / FAIL";
      status.textContent = error instanceof Error ? error.message : "Credential vault unavailable";
      input.disabled = true;
      saveButton.disabled = true;
      clearButton.disabled = true;
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    saveButton.textContent = "Encrypting…";
    try {
      await storeProviderCredential("openai", input.value);
      input.value = "";
      await showReadyState("Encrypted and stored");
    } catch (error: unknown) {
      status.textContent = error instanceof Error ? error.message : "Credential storage failed";
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save encrypted";
    }
  });

  clearButton.addEventListener("click", async () => {
    clearButton.disabled = true;
    try {
      await removeProviderCredential("openai");
      await showReadyState("Credential removed");
    } catch (error: unknown) {
      status.textContent = error instanceof Error ? error.message : "Credential removal failed";
      clearButton.disabled = false;
    }
  });
}
