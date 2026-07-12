import type { BrowserPodPortal, BrowserPodRuntime, BrowserPodTask } from "./browserpod-runtime.mjs";
import type { VerifiedOpenClawInstaller } from "./openclaw-installer.mjs";

export const OPENCLAW_GATEWAY_PORT: 18789;
export const BROWSERPOD_HEALTH_PREFIX: string;
export const BROWSERPOD_HEALTH_SOURCE: string;

export interface VerifiedOpenClawGatewayReady {
  schemaVersion: 1;
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  port: number;
  bind: "loopback";
  auth: "token";
  allowedOrigins: readonly string[];
  portal: Readonly<BrowserPodPortal>;
  healthz: Readonly<{ status: 200; body: string }>;
  readyz: Readonly<{ status: 200; body: string }>;
  taskId: string;
  durationMs: number;
  outputTruncated: boolean;
}

export interface VerifiedOpenClawGateway {
  schemaVersion: 1;
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  port: number;
  readonly allowedOrigins: readonly string[];
  readonly state: "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";
  readonly task: BrowserPodTask | undefined;
  start(): Promise<Readonly<VerifiedOpenClawGatewayReady>>;
  connection(): Readonly<{
    schemaVersion: 1;
    portal: Readonly<BrowserPodPortal>;
    allowedOrigins: readonly string[];
    auth: Readonly<{ mode: "token"; token: string }>;
  }>;
  stop(options?: { timeoutMs?: number }): Promise<Readonly<{
    complete: boolean;
    mode: "guest-supervisor";
    reason: string;
    taskId: string | null;
    durationMs: number;
  }>>;
}

export function createVerifiedOpenClawGateway(options: {
  runtime: BrowserPodRuntime;
  installer: VerifiedOpenClawInstaller;
  port?: number;
  allowedOrigins?: readonly string[];
  tokenFactory?: () => string;
  supervisorNonceFactory?: () => string;
  onOutput?: (event: Readonly<{ phase: "configure" | "gateway" | "health"; chunk: string }>) => void;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<VerifiedOpenClawGateway>;

export function assertOpenClawGatewayPort(port: unknown): number;
export function assertOpenClawGatewayToken(token: unknown): string;
export function assertOpenClawBrowserOrigins(origins: unknown): readonly string[];
export function parseBrowserPodHealthEvidence(output: string): {
  healthz: { status: 200; body: string };
  readyz: { status: 200; body: string };
};
