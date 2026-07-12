import type {
  CapabilityAuditEvent,
  CapabilityBroker,
  CapabilityHandlerContext
} from "../capability-broker/capability-broker.mjs";
import type { BrowserPodApi, BrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import type { VerifiedOpenClawInstaller } from "../browser-runtime/openclaw-installer.mjs";
import type { VerifiedOpenClawGateway } from "../browser-runtime/openclaw-gateway.mjs";
import type { FilesystemCapabilityMailboxHost } from "../capability-broker/filesystem-mailbox-host.mjs";
import type { StagedGuestMailboxClient } from "../capability-broker/guest-mailbox-artifact.mjs";
import type {
  CapabilityConsentController,
  PermissionAuditEvent
} from "../capability-broker/capability-consent.mjs";
import type { EmbedManifest } from "./embed-manifest.mjs";
import type { BrowserDeviceIdentity } from "./gateway-device-identity.mjs";
import type { GatewayDeviceTokenVault } from "./gateway-device-token-vault.mjs";
import type { OpenClawGatewayClient } from "./gateway-client.mjs";

export function bootVerifiedEmbed(options: {
  manifest: EmbedManifest;
  BrowserPod: BrowserPodApi;
  browserPodApiKey: string;
  workspaceId?: string;
  capabilityHandlers?: Record<string, (input: unknown, context: CapabilityHandlerContext) => unknown | Promise<unknown>>;
  sessionId?: string;
  mailboxChannelId?: string;
  onRuntimeAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onInstallOutput?: (event: Readonly<{ phase: "install"; chunk: string }>) => void;
  onInstallAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onGatewayOutput?: (event: Readonly<{ phase: "configure" | "gateway" | "health"; chunk: string }>) => void;
  onGatewayAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onProtocolAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onCapabilityAudit?: (event: CapabilityAuditEvent) => void;
  onPermissionAudit?: (event: PermissionAuditEvent) => void;
  mailboxOptions?: {
    pollIntervalMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxRequests?: number;
    clock?: () => number;
  };
  gatewayOptions?: {
    port?: number;
    allowedOrigins?: readonly string[];
    tokenFactory?: () => string;
    supervisorNonceFactory?: () => string;
    clock?: () => number;
  };
}): Promise<Readonly<{
  schemaVersion: 1;
  manifest: Readonly<EmbedManifest>;
  runtime: Readonly<BrowserPodRuntime>;
  installer: Readonly<VerifiedOpenClawInstaller>;
  gateway: Readonly<VerifiedOpenClawGateway>;
  capabilities: CapabilityBroker;
  permissions: CapabilityConsentController;
  mailbox: FilesystemCapabilityMailboxHost;
  guestTransport: Readonly<{
    schemaVersion: 1;
    kind: "filesystem-mailbox";
    channelId: string;
    mailboxRoot: string;
    client: Readonly<StagedGuestMailboxClient>;
    environment: readonly [
      `CLAWSEMBLY_MAILBOX_ROOT=${string}`,
      `CLAWSEMBLY_MAILBOX_CHANNEL=${string}`,
      `CLAWSEMBLY_MAILBOX_CLIENT=${string}`
    ];
  }>;
  createGatewayClient(options?: {
    identity?: BrowserDeviceIdentity;
    deviceTokenVault?: GatewayDeviceTokenVault;
    browserOrigin?: string;
    createWebSocket?: (url: string) => WebSocket;
    requestIdFactory?: () => string;
    timeoutMs?: number;
    onAudit?: (event: Readonly<Record<string, unknown>>) => void;
    onGap?: (gap: Readonly<{ expected: number; received: number }>) => void;
    now?: () => number;
  }): Readonly<OpenClawGatewayClient>;
  readonly closed: boolean;
  dispose(): Readonly<{ complete: false; reason: string; activeTaskIds: readonly string[] }>;
  close(): Promise<Readonly<{
    logicalSessionClosed: boolean;
    reason: string;
    gatewayStop: Awaited<ReturnType<VerifiedOpenClawGateway["stop"]>> | null;
    runtimeDisposition: ReturnType<BrowserPodRuntime["dispose"]> | null;
  }>>;
}>>;

export function createArtifactStorageKey(manifest: EmbedManifest, workspaceId: string): string;

export function createEmbedSessionLifecycle(options: {
  runtime: Pick<BrowserPodRuntime, "dispose">;
  gateway: Pick<VerifiedOpenClawGateway, "state" | "task" | "stop">;
  closeConnections?: () => void;
}): Readonly<{
  readonly closed: boolean;
  dispose(): Readonly<{ complete: false; reason: string; activeTaskIds: readonly string[] }>;
  close(): Promise<Readonly<{
    logicalSessionClosed: boolean;
    reason: string;
    gatewayStop: Awaited<ReturnType<VerifiedOpenClawGateway["stop"]>> | null;
    runtimeDisposition: ReturnType<BrowserPodRuntime["dispose"]> | null;
  }>>;
}>;
