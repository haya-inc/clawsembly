import type { BrowserPodApi, BrowserPodRuntime, BrowserPodTask } from "./browserpod-runtime.mjs";

export interface BrowserPodOpenClawEvidence {
  schemaVersion: 1;
  capturedAt: string;
  source: string;
  target: Readonly<{
    runtime: "browserpod";
    runtimeVersion: "2.12.1";
    browser: string;
    browserLocal: true;
  }>;
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  preflight: Readonly<{
    node: string;
    platform: string;
    arch: string;
    checks: Readonly<{ nodeBaseline: true; cryptoVerify: boolean; sqlite: boolean }>;
    lifecycle: BrowserPodRuntime["features"];
  }>;
  install: Readonly<{
    result: "pass";
    command: "npm install --save-exact openclaw@<version>";
    durationMs: number;
    installedVersion: string;
    lockIntegrity: string;
    integrityMatched: true;
    outputTruncated: boolean;
  }>;
  gateway: Readonly<{
    result: "pass";
    port: number;
    bind: "loopback";
    auth: "token";
    taskId: string;
    durationMs: number;
    readiness: Readonly<{ output: true; portal: true; healthz: true; readyz: true }>;
    portal: Awaited<ReturnType<BrowserPodRuntime["waitForPortal"]>>;
    healthz: Readonly<{ status: 200; body: string }>;
    readyz: Readonly<{ status: 200; body: string }>;
    outputTruncated: boolean;
  }>;
  limitations: readonly string[];
}

export interface BrowserPodOpenClawProbeSession {
  readonly evidence: BrowserPodOpenClawEvidence;
  readonly runtime: Readonly<BrowserPodRuntime>;
  readonly gatewayTask: BrowserPodTask;
  dispose(): ReturnType<BrowserPodRuntime["dispose"]>;
}

export function runBrowserPodOpenClawProbe(options: {
  BrowserPod: BrowserPodApi;
  apiKey: string;
  artifact: { package: "openclaw"; version: string; integrity: string };
  browser: string;
  source?: string;
  storageKey?: string;
  port?: number;
  gatewayToken?: string;
  onOutput?: (event: Readonly<{ phase: "preflight" | "install" | "gateway" | "health"; chunk: string }>) => void;
  now?: () => number;
}): Promise<BrowserPodOpenClawProbeSession>;

export const BROWSERPOD_HEALTH_PREFIX: string;
export const BROWSERPOD_HEALTH_SOURCE: string;
export function parseBrowserPodHealthEvidence(output: string): {
  healthz: { status: 200; body: string };
  readyz: { status: 200; body: string };
};
