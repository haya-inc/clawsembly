import { createBrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import { createVerifiedOpenClawInstaller } from "../browser-runtime/openclaw-installer.mjs";
import { CapabilityBroker } from "../capability-broker/capability-broker.mjs";
import { CapabilityConsentController } from "../capability-broker/capability-consent.mjs";
import { FilesystemCapabilityMailboxHost } from "../capability-broker/filesystem-mailbox-host.mjs";
import { stageGuestMailboxClient } from "../capability-broker/guest-mailbox-artifact.mjs";
import { assertVerifiedLaunch } from "./embed-manifest.mjs";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAILBOX_CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
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
  mailboxChannelId = `mailbox_${crypto.randomUUID().replaceAll("-", "")}`,
  onRuntimeAudit,
  onInstallOutput,
  onInstallAudit,
  onCapabilityAudit,
  onPermissionAudit,
  mailboxOptions = {}
}) {
  const verifiedManifest = assertVerifiedLaunch(manifest);
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new TypeError("embed session identifier is invalid");
  }
  if (typeof mailboxChannelId !== "string" || !MAILBOX_CHANNEL_PATTERN.test(mailboxChannelId)) {
    throw new TypeError("embed mailbox channel identifier is invalid");
  }
  if (!mailboxOptions || typeof mailboxOptions !== "object" || Array.isArray(mailboxOptions)) {
    throw new TypeError("embed mailbox options are invalid");
  }
  const allowedMailboxOptions = new Set([
    "pollIntervalMs",
    "maxRequestBytes",
    "maxResponseBytes",
    "maxRequests",
    "clock"
  ]);
  if (Object.keys(mailboxOptions).some((key) => !allowedMailboxOptions.has(key))) {
    throw new TypeError("embed mailbox options contain an unknown field");
  }
  if (onInstallOutput !== undefined && typeof onInstallOutput !== "function") {
    throw new TypeError("embed install output sink is invalid");
  }
  if (onInstallAudit !== undefined && typeof onInstallAudit !== "function") {
    throw new TypeError("embed install audit sink is invalid");
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
    handlers: capabilityHandlers,
    auditSink: onCapabilityAudit
  });
  const permissions = new CapabilityConsentController({
    broker: capabilities,
    requests: verifiedManifest.capabilities,
    auditSink: onPermissionAudit
  });
  const installer = createVerifiedOpenClawInstaller({
    runtime,
    artifact: verifiedManifest.artifact,
    onOutput: onInstallOutput,
    onAudit: onInstallAudit
  });
  const mailboxRoot = `/workspace/.clawsembly/mailbox/${mailboxChannelId}`;
  const mailbox = new FilesystemCapabilityMailboxHost({
    runtime,
    broker: capabilities,
    root: mailboxRoot,
    channelId: mailboxChannelId,
    ...(mailboxOptions.pollIntervalMs === undefined ? {} : { pollIntervalMs: mailboxOptions.pollIntervalMs }),
    ...(mailboxOptions.maxRequestBytes === undefined ? {} : { maxRequestBytes: mailboxOptions.maxRequestBytes }),
    ...(mailboxOptions.maxResponseBytes === undefined ? {} : { maxResponseBytes: mailboxOptions.maxResponseBytes }),
    ...(mailboxOptions.maxRequests === undefined ? {} : { maxRequests: mailboxOptions.maxRequests }),
    ...(mailboxOptions.clock === undefined ? {} : { clock: mailboxOptions.clock })
  });
  await mailbox.initialize();
  const guestClient = await stageGuestMailboxClient({
    runtime,
    root: `${mailboxRoot}/guest-client-v1`
  });
  const guestTransport = Object.freeze({
    schemaVersion: 1,
    kind: "filesystem-mailbox",
    channelId: mailboxChannelId,
    mailboxRoot,
    client: guestClient,
    environment: Object.freeze([
      `CLAWSEMBLY_MAILBOX_ROOT=${mailboxRoot}`,
      `CLAWSEMBLY_MAILBOX_CHANNEL=${mailboxChannelId}`,
      `CLAWSEMBLY_MAILBOX_CLIENT=${guestClient.entrypointPath}`
    ])
  });
  let closed = false;
  return Object.freeze({
    schemaVersion: 1,
    manifest: verifiedManifest,
    runtime,
    installer,
    capabilities,
    permissions,
    mailbox,
    guestTransport,
    get closed() { return closed; },
    dispose() {
      if (closed) return Object.freeze({ complete: false, reason: "embed session already closed", activeTaskIds: Object.freeze([]) });
      closed = true;
      return runtime.dispose();
    }
  });
}
