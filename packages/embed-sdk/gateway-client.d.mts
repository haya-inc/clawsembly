import type { BrowserDeviceIdentity } from "./gateway-device-identity.mjs";
import type { GatewayDeviceTokenMetadata, GatewayDeviceTokenVault } from "./gateway-device-token-vault.mjs";
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
  readonly retryable?: true;
  readonly retryAfterMs?: number;
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
    deviceTokenStored: boolean;
    authenticatedWith: "shared-token" | "device-token";
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
  readonly state: "idle" | "connecting" | "ready" | "disconnected" | "failed" | "closed";
  connect(options?: { signal?: AbortSignal }): Promise<Readonly<OpenClawGatewayHello>>;
  readonly chat: Readonly<OpenClawGatewayChatClient>;
  readonly deviceAuth: Readonly<{
    metadata(): Promise<Readonly<GatewayDeviceTokenMetadata> | undefined>;
    clear(): Promise<boolean>;
  }>;
  close(): boolean;
}

export interface GatewayRpcOptions {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export interface OpenClawChatEvent {
  readonly runId: string;
  readonly sessionKey: string;
  readonly agentId?: string;
  readonly spawnedBy?: string;
  readonly seq: number;
  readonly state: "delta" | "final" | "aborted" | "error";
  readonly deltaText?: string;
  readonly replace?: boolean;
  readonly message?: unknown;
  readonly usage?: unknown;
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly errorKind?: "refusal" | "timeout" | "rate_limit" | "context_length" | "unknown";
}

export interface OpenClawGatewayChatClient {
  send(params: {
    sessionKey: string;
    agentId?: string;
    message: string;
    thinking?: string;
    timeoutMs?: number;
    runId?: string;
  }, options?: GatewayRpcOptions): Promise<Readonly<{ runId: string; status: string }>>;
  history(params: {
    sessionKey: string;
    agentId?: string;
    limit?: number;
    maxChars?: number;
  }, options?: GatewayRpcOptions): Promise<Readonly<Record<string, unknown> & { messages: readonly unknown[] }>>;
  abort(params: {
    sessionKey: string;
    agentId?: string;
    runId?: string;
  }, options?: GatewayRpcOptions): Promise<Readonly<{
    ok: true;
    aborted: boolean;
    runIds: readonly string[];
  }>>;
  onEvent(listener: (event: Readonly<OpenClawChatEvent>) => void): () => boolean;
}

export function resolveGatewayWebSocketConnection(
  connection: GatewayConnectionMaterial,
  browserOrigin: string
): Readonly<{ url: string; origin: string; token: string }>;

export function createOpenClawGatewayClient(options: {
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  getConnection: () => GatewayConnectionMaterial;
  identity: BrowserDeviceIdentity;
  deviceTokenVault?: GatewayDeviceTokenVault;
  browserOrigin?: string;
  createWebSocket?: (url: string) => WebSocket;
  requestIdFactory?: () => string;
  timeoutMs?: number;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onGap?: (gap: Readonly<{ expected: number; received: number }>) => void;
  now?: () => number;
}): Readonly<OpenClawGatewayClient>;
