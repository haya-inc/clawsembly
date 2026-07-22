import type {
  OpenClawGatewayClient,
  RemoteGatewayConnectionMaterial
} from "./gateway-client.mjs";
import type { BrowserDeviceIdentity } from "./gateway-device-identity.mjs";
import type { GatewayDeviceTokenVault } from "./gateway-device-token-vault.mjs";

/**
 * Validates a user-supplied Gateway endpoint and token into the client's
 * remote-gateway connection material. HTTP(S) schemes normalize onto their
 * WebSocket counterparts; cleartext endpoints are admissible only on the
 * loopback host.
 */
export function createRemoteGatewayConnection(options: {
  url: string;
  token: string;
  allowedOrigins: readonly string[];
}): Readonly<RemoteGatewayConnectionMaterial>;

/**
 * Opens the generated, version-locked Gateway client against a
 * user-operated Gateway with browser-persistent defaults (IndexedDB device
 * identity, encrypted device-token vault). Interoperability only: nothing
 * runs browser-locally, and the connection can never satisfy the
 * browser-local acceptance gates or stand in for BrowserPod evidence.
 */
export function connectRemoteOpenClawGateway(options: {
  connection?: Readonly<RemoteGatewayConnectionMaterial>;
  getConnection?: () => Readonly<RemoteGatewayConnectionMaterial>;
  browserOrigin?: string;
  identity?: BrowserDeviceIdentity;
  deviceTokenVault?: GatewayDeviceTokenVault;
  createWebSocket?: (url: string) => WebSocket;
  timeoutMs?: number;
  deviceManagement?: boolean;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onGap?: (gap: Readonly<{ expected: number; received: number }>) => void;
  now?: () => number;
}): Readonly<OpenClawGatewayClient>;
