import { CapabilityBroker } from "../../../packages/capability-broker/capability-broker.mjs";
import { CapabilityConsentController } from "../../../packages/capability-broker/capability-consent.mjs";
import {
  downloadCapabilityAudit,
  mountCapabilityPermissionPrompt
} from "../../../packages/embed-sdk/permission-prompt.mjs";

export function setupPermissionDemo(): void {
  const container = document.querySelector<HTMLElement>("[data-permission-demo]");
  if (!container) return;
  const version = document.documentElement.dataset.openclawVersion;
  const integrity = document.documentElement.dataset.openclawIntegrity;
  if (!version || !integrity?.startsWith("sha512-")) {
    container.textContent = "Permission demo unavailable · compatibility report identity missing";
    return;
  }

  const broker = new CapabilityBroker({
    subject: {
      artifact: { package: "openclaw", version, integrity },
      runtime: "browserpod",
      sessionId: "public-permission-demo"
    }
  });
  const permissions = new CapabilityConsentController({
    broker,
    requests: [
      { capability: "storage.snapshot", scope: "workspace:demo", maxCalls: 2 },
      { capability: "identity.sign", scope: "challenge:gateway", maxCalls: 3 },
      { capability: "provider.openai.responses", scope: "model:gpt-5.6-luna", maxCalls: 1 }
    ]
  });

  mountCapabilityPermissionPrompt({
    container,
    permissions,
    onAuditExport(audit) {
      const safeVersion = version.replace(/[^A-Za-z0-9._-]/gu, "-");
      downloadCapabilityAudit(audit, {
        filename: `clawsembly-${safeVersion}-capability-audit.json`
      });
    }
  });
}
