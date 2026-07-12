import { createBrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import { CapabilityBroker } from "../capability-broker/capability-broker.mjs";
import { assertVerifiedLaunch } from "./embed-manifest.mjs";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export function createArtifactStorageKey(manifest, workspaceId) {
  if (typeof workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new TypeError("embed workspace identifier is invalid");
  }
  const key = `clawsembly:${manifest.artifact.version}:${workspaceId}`;
  if (key.length > 128) throw new TypeError("embed artifact storage key is too long");
  return key;
}

/**
 * Boots the first evidence-bound Clawsembly session. There is intentionally no
 * unverified escape hatch here; BrowserPod probes use the lower runtime adapter
 * until the provider earns a supported compatibility report.
 */
export async function bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey,
  workspaceId,
  capabilityHandlers = {},
  sessionId = crypto.randomUUID(),
  onRuntimeAudit,
  onCapabilityAudit
}) {
  const verifiedManifest = assertVerifiedLaunch(manifest);
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new TypeError("embed session identifier is invalid");
  }
  const storageKey = workspaceId === undefined
    ? undefined
    : createArtifactStorageKey(verifiedManifest, workspaceId);
  const runtime = await createBrowserPodRuntime({
    BrowserPod,
    apiKey: browserPodApiKey,
    storageKey,
    onAudit: onRuntimeAudit
  });
  const capabilities = new CapabilityBroker({
    subject: {
      artifact: verifiedManifest.artifact,
      runtime: "browserpod",
      sessionId
    },
    grants: verifiedManifest.capabilities,
    handlers: capabilityHandlers,
    auditSink: onCapabilityAudit
  });
  let closed = false;
  return Object.freeze({
    schemaVersion: 1,
    manifest: verifiedManifest,
    runtime,
    capabilities,
    get closed() { return closed; },
    dispose() {
      if (closed) return Object.freeze({ complete: false, reason: "embed session already closed", activeTaskIds: Object.freeze([]) });
      closed = true;
      return runtime.dispose();
    }
  });
}
