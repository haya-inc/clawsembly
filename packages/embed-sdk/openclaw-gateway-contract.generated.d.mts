export interface OpenClawGatewayContract {
  readonly schemaVersion: 1;
  readonly artifact: Readonly<{
    package: "openclaw";
    version: string;
    integrity: string;
    shasum: string;
  }>;
  readonly protocol: Readonly<{ min: number; max: number }>;
  readonly profile: Readonly<{
    clientId: "webchat-ui";
    clientMode: "webchat";
    clientVersion: string;
    platform: "browser";
    deviceFamily: "clawsembly";
    role: "operator";
    scopes: readonly ["operator.read", "operator.write"];
    caps: readonly [];
  }>;
  readonly rpc: Readonly<{
    methods: readonly ["chat.send", "chat.history", "chat.abort"];
    event: "chat";
  }>;
  readonly pairing: Readonly<{
    scope: "operator.pairing";
    methods: readonly [
      "device.pair.list",
      "device.pair.approve",
      "device.pair.reject",
      "device.pair.remove",
      "device.token.rotate",
      "device.token.revoke"
    ];
  }>;
  readonly limits: Readonly<{
    preauthPayloadBytes: number;
    authenticatedPayloadBytes: number;
    handshakeTimeoutMs: number;
    requestTimeoutMs: number;
    maxPendingRequests: number;
  }>;
  readonly sources: Readonly<Record<string, `sha256-${string}`>>;
}

export const OPENCLAW_GATEWAY_CONTRACT: Readonly<OpenClawGatewayContract>;
