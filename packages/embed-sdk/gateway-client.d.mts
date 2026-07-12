import type { BrowserDeviceIdentity } from "./gateway-device-identity.mjs";
import type { OpenClawGatewayContract } from "./openclaw-gateway-contract.generated.mjs";

export interface GatewayPairingRequirement {
  readonly required: true;
  readonly requestId?: string;
  readonly deviceId?: string;
  readonly reason: "not-paired" | "role-upgrade" | "scope-upgrade" | "metadata-upgrade";
  readonly role: "operator";
  readonly scopes: readonly ["operator.read", "operator.write"];
}

export class OpenClawGatewayClientError extends Error {
  readonly code: string;
  readonly gatewayCode?: string;
  readonly pairing?: Readonly<GatewayPairingRequirement>;
}

export interface OpenClawGatewayHello {
  readonly schemaVersion: 1;
  readonly protocol: 4;
  readonly server: Readonly<{ version: string; connId: string }>;
  readonly features: Readonly<{ methods: readonly string[]; events: readonly string[] }>;
  readonly auth: Readonly<{
    role: "operator";
    scopes: readonly string[];
    deviceTokenIssued: boolean;
  }>;
  readonly policy: Readonly<{
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  }>;
}

export interface GatewayConnectionMaterial {
  schemaVersion: 1;
  portal: Readonly<{ port: number; url: string; visibility: "public-url" }>;
  allowedOrigins: readonly string[];
  auth: Readonly<{ mode: "token"; token: string }>;
}

export interface OpenClawGatewayClient {
  readonly schemaVersion: 1;
  readonly contract: Readonly<OpenClawGatewayContract>;
  readonly state: "idle" | "connecting" | "ready" | "failed" | "closed";
  connect(options?: { signal?: AbortSignal }): Promise<Readonly<OpenClawGatewayHello>>;
  close(): boolean;
}

export function resolveGatewayWebSocketConnection(
  connection: GatewayConnectionMaterial,
  browserOrigin: string
): Readonly<{ url: string; origin: string; token: string }>;

export function createOpenClawGatewayClient(options: {
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  getConnection: () => GatewayConnectionMaterial;
  identity: BrowserDeviceIdentity;
  browserOrigin?: string;
  createWebSocket?: (url: string) => WebSocket;
  requestIdFactory?: () => string;
  timeoutMs?: number;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<OpenClawGatewayClient>;
