// Compile-only conformance for the handwritten .d.mts API contracts.
// Exercises the public modules through Node16 resolution exactly as a strict
// TypeScript consumer would, including negative-space assertions that keep
// declaration drift visible in `npm run typecheck`.
import {
  CapabilityBroker,
  CapabilityBrokerError
} from "../../packages/capability-broker/capability-broker.mjs";
import { FilesystemCapabilityMailboxHost } from "../../packages/capability-broker/filesystem-mailbox-host.mjs";
import { FilesystemCapabilityMailboxClient } from "../../packages/capability-broker/guest-mailbox-client.mjs";
import { startCooperativeProcess } from "../../packages/browser-runtime/cooperative-process.mjs";
import {
  createWorkspaceBackup,
  decodeWorkspaceBackup,
  exportBrowserPodWorkspace,
  migrateLegacyWorkspaceSnapshot,
  restoreBrowserPodWorkspace,
  type WorkspaceBackupSubject
} from "../../packages/browser-runtime/workspace-backup.mjs";
import {
  createVerifiedOpenClawGateway,
  type GatewayPairingRequirement as HostPairingRequirement,
  type ReviewableGatewayPairingRequirement,
  type VerifiedOpenClawGateway
} from "../../packages/browser-runtime/openclaw-gateway.mjs";
import {
  createOpenClawGatewayClient,
  OpenClawGatewayClientError,
  resolveGatewayWebSocketConnection,
  type GatewayPairingRequirement,
  type OpenClawGatewayClient,
  type RemoteGatewayConnectionMaterial
} from "../../packages/embed-sdk/gateway-client.mjs";
import {
  connectRemoteOpenClawGateway,
  createRemoteGatewayConnection
} from "../../packages/embed-sdk/remote-gateway.mjs";
import { createBrowserDeviceIdentity } from "../../packages/embed-sdk/gateway-device-identity.mjs";
import { createGatewayDeviceTokenVault } from "../../packages/embed-sdk/gateway-device-token-vault.mjs";
import { mountGatewayPairingPrompt } from "../../packages/embed-sdk/gateway-pairing-prompt.mjs";
import { mountCapabilityPermissionPrompt } from "../../packages/embed-sdk/permission-prompt.mjs";
import { bootVerifiedEmbed } from "../../packages/embed-sdk/boot.mjs";
import { createEmbedManifest } from "../../packages/embed-sdk/embed-manifest.mjs";
import { loadVerifiedCompatibilityReport } from "../../packages/embed-sdk/report-loader.mjs";

declare const gateway: VerifiedOpenClawGateway;
declare const clientError: OpenClawGatewayClientError;
declare const backupSubject: WorkspaceBackupSubject;
void backupSubject;

// The client pairing requirement narrows the shared host contract.
const sharedPairing: HostPairingRequirement | undefined = clientError.pairing;
void sharedPairing;

// review() only accepts requirements whose ids are proven present.
declare const unproven: GatewayPairingRequirement;
// @ts-expect-error -- requestId/deviceId are optional on the client shape.
void gateway.pairing.review(unproven);
declare const reviewable: ReviewableGatewayPairingRequirement;
void gateway.pairing.review(reviewable);

// Remote mode: the builder's material feeds both the client resolver and
// the remote connect surface, and the connect result is the same bounded
// generated client.
const remoteMaterial: Readonly<RemoteGatewayConnectionMaterial> = createRemoteGatewayConnection({
  url: "https://gateway.example:18789",
  token: "remote-gateway-shared-token",
  allowedOrigins: ["https://cockpit.example"]
});
void resolveGatewayWebSocketConnection(remoteMaterial, "https://cockpit.example");
const remoteClient: Readonly<OpenClawGatewayClient> = connectRemoteOpenClawGateway({
  connection: remoteMaterial,
  browserOrigin: "https://cockpit.example",
  deviceManagement: true
});
const devicesListing: ReturnType<typeof remoteClient.devices.list> = remoteClient.devices.list();
const rotation = remoteClient.devices.rotateToken({ deviceId: "a".repeat(64), role: "operator" });
void devicesListing;
void rotation;
void remoteClient;

// Broker construction and its request surface stay exercisable.
const broker = new CapabilityBroker({
  subject: {
    artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-types" },
    runtime: "browserpod",
    sessionId: "type-conformance"
  },
  grants: [{ capability: "storage.read", scope: "workspace:primary", maxCalls: 1 }],
  handlers: { "storage.read": async () => null }
});
const brokerRequest: Promise<unknown> = broker.request({
  id: "request-1",
  capability: "storage.read",
  scope: "workspace:primary",
  input: null
});
void brokerRequest;
void CapabilityBrokerError;

// Value-level identity between implementation exports and declared callables.
const callableSurface = [
  createOpenClawGatewayClient,
  createVerifiedOpenClawGateway,
  startCooperativeProcess,
  createBrowserDeviceIdentity,
  createGatewayDeviceTokenVault,
  mountGatewayPairingPrompt,
  mountCapabilityPermissionPrompt,
  bootVerifiedEmbed,
  createEmbedManifest,
  loadVerifiedCompatibilityReport,
  resolveGatewayWebSocketConnection,
  createWorkspaceBackup,
  decodeWorkspaceBackup,
  exportBrowserPodWorkspace,
  migrateLegacyWorkspaceSnapshot,
  restoreBrowserPodWorkspace
] as const;
callableSurface.forEach((entry) => void (entry satisfies (...parameters: never[]) => unknown));
void FilesystemCapabilityMailboxHost;
void FilesystemCapabilityMailboxClient;

export {};
