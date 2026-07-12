import { createBrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import { createVerifiedOpenClawInstaller } from "../browser-runtime/openclaw-installer.mjs";
import {
  assertOpenClawBrowserOrigins,
  assertOpenClawGatewayPort,
  createVerifiedOpenClawGateway
} from "../browser-runtime/openclaw-gateway.mjs";
import { CapabilityBroker } from "../capability-broker/capability-broker.mjs";
import { CapabilityConsentController } from "../capability-broker/capability-consent.mjs";
import { FilesystemCapabilityMailboxHost } from "../capability-broker/filesystem-mailbox-host.mjs";
import { stageGuestMailboxClient } from "../capability-broker/guest-mailbox-artifact.mjs";
import { assertVerifiedLaunch } from "./embed-manifest.mjs";
import { createBrowserDeviceIdentity } from "./gateway-device-identity.mjs";
import { createOpenClawGatewayClient } from "./gateway-client.mjs";

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

export function createEmbedSessionLifecycle({ runtime, gateway, closeConnections = () => {} }) {
  if (!runtime || typeof runtime.dispose !== "function" || !gateway
    || typeof gateway.stop !== "function" || typeof gateway.state !== "string"
    || typeof closeConnections !== "function") {
    throw new TypeError("embed session lifecycle dependencies are invalid");
  }
  let closed = false;
  const gatewayNeedsStop = () => ["starting", "ready", "stopping"].includes(gateway.state)
    || (gateway.state === "failed" && gateway.task
      && !["completed", "failed"].includes(gateway.task.status));
  return Object.freeze({
    get closed() { return closed; },
    dispose() {
      if (closed) {
        return Object.freeze({ complete: false, reason: "embed session already closed", activeTaskIds: Object.freeze([]) });
      }
      if (gatewayNeedsStop()) {
        return Object.freeze({
          complete: false,
          reason: "OpenClaw Gateway must stop before logical runtime disposal",
          activeTaskIds: Object.freeze(gateway.task?.id ? [gateway.task.id] : [])
        });
      }
      closed = true;
      return runtime.dispose();
    },
    async close() {
      if (closed) {
        return Object.freeze({
          logicalSessionClosed: false,
          reason: "embed session already closed",
          gatewayStop: null,
          runtimeDisposition: null
        });
      }
      if (gateway.state === "stopping") {
        return Object.freeze({
          logicalSessionClosed: false,
          reason: "OpenClaw Gateway stop is already in progress",
          gatewayStop: null,
          runtimeDisposition: null
        });
      }
      closeConnections();
      let gatewayStop = null;
      if (gatewayNeedsStop()) {
        try { gatewayStop = await gateway.stop(); }
        catch {
          return Object.freeze({
            logicalSessionClosed: false,
            reason: "OpenClaw Gateway stop failed",
            gatewayStop: null,
            runtimeDisposition: null
          });
        }
        if (!gatewayStop.complete) {
          return Object.freeze({
            logicalSessionClosed: false,
            reason: gatewayStop.reason,
            gatewayStop,
            runtimeDisposition: null
          });
        }
      }
      closed = true;
      const runtimeDisposition = runtime.dispose();
      return Object.freeze({
        logicalSessionClosed: true,
        reason: "Gateway stopped and logical runtime session closed",
        gatewayStop,
        runtimeDisposition
      });
    }
  });
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
  onGatewayOutput,
  onGatewayAudit,
  onProtocolAudit,
  onCapabilityAudit,
  onPermissionAudit,
  mailboxOptions = {},
  gatewayOptions = {}
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
  if (onGatewayOutput !== undefined && typeof onGatewayOutput !== "function") {
    throw new TypeError("embed Gateway output sink is invalid");
  }
  if (onGatewayAudit !== undefined && typeof onGatewayAudit !== "function") {
    throw new TypeError("embed Gateway audit sink is invalid");
  }
  if (onProtocolAudit !== undefined && typeof onProtocolAudit !== "function") {
    throw new TypeError("embed protocol audit sink is invalid");
  }
  if (!gatewayOptions || typeof gatewayOptions !== "object" || Array.isArray(gatewayOptions)) {
    throw new TypeError("embed Gateway options are invalid");
  }
  const allowedGatewayOptions = new Set([
    "port",
    "allowedOrigins",
    "tokenFactory",
    "supervisorNonceFactory",
    "clock"
  ]);
  if (Object.keys(gatewayOptions).some((key) => !allowedGatewayOptions.has(key))) {
    throw new TypeError("embed Gateway options contain an unknown field");
  }
  if (gatewayOptions.port !== undefined) assertOpenClawGatewayPort(gatewayOptions.port);
  if (gatewayOptions.allowedOrigins !== undefined) assertOpenClawBrowserOrigins(gatewayOptions.allowedOrigins);
  for (const key of ["tokenFactory", "supervisorNonceFactory", "clock"]) {
    if (gatewayOptions[key] !== undefined && typeof gatewayOptions[key] !== "function") {
      throw new TypeError(`embed Gateway ${key} is invalid`);
    }
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
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer,
    ...(gatewayOptions.port === undefined ? {} : { port: gatewayOptions.port }),
    ...(gatewayOptions.allowedOrigins === undefined ? {} : { allowedOrigins: gatewayOptions.allowedOrigins }),
    ...(gatewayOptions.tokenFactory === undefined ? {} : { tokenFactory: gatewayOptions.tokenFactory }),
    ...(gatewayOptions.supervisorNonceFactory === undefined
      ? {}
      : { supervisorNonceFactory: gatewayOptions.supervisorNonceFactory }),
    ...(gatewayOptions.clock === undefined ? {} : { now: gatewayOptions.clock }),
    onOutput: onGatewayOutput,
    onAudit: onGatewayAudit
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
  const protocolClients = new Set();
  const lifecycle = createEmbedSessionLifecycle({
    runtime,
    gateway,
    closeConnections() {
      for (const client of protocolClients) client.close();
      protocolClients.clear();
    }
  });
  return Object.freeze({
    schemaVersion: 1,
    manifest: verifiedManifest,
    runtime,
    installer,
    gateway,
    capabilities,
    permissions,
    mailbox,
    guestTransport,
    createGatewayClient(options = {}) {
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("Gateway client options are invalid");
      }
      const allowed = new Set([
        "identity",
        "browserOrigin",
        "createWebSocket",
        "requestIdFactory",
        "timeoutMs",
        "onAudit",
        "onGap",
        "now"
      ]);
      if (Object.keys(options).some((key) => !allowed.has(key))) {
        throw new TypeError("Gateway client options contain an unknown field");
      }
      const client = createOpenClawGatewayClient({
        artifact: verifiedManifest.artifact,
        getConnection: () => gateway.connection(),
        identity: options.identity ?? createBrowserDeviceIdentity(),
        ...(options.browserOrigin === undefined ? {} : { browserOrigin: options.browserOrigin }),
        ...(options.createWebSocket === undefined ? {} : { createWebSocket: options.createWebSocket }),
        ...(options.requestIdFactory === undefined ? {} : { requestIdFactory: options.requestIdFactory }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        onAudit: options.onAudit ?? onProtocolAudit,
        ...(options.onGap === undefined ? {} : { onGap: options.onGap }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
      protocolClients.add(client);
      return client;
    },
    get closed() { return lifecycle.closed; },
    dispose() { return lifecycle.dispose(); },
    close() { return lifecycle.close(); }
  });
}
