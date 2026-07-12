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
  readonly limits: Readonly<{
    preauthPayloadBytes: number;
    handshakeTimeoutMs: number;
  }>;
  readonly sources: Readonly<Record<string, `sha256-${string}`>>;
}

export const OPENCLAW_GATEWAY_CONTRACT: Readonly<OpenClawGatewayContract>;
