import type { BrowserPodApi, BrowserPodRuntime } from "./browserpod-runtime.mjs";

export interface BrowserPodPreflightEvidence {
  schemaVersion: 1;
  runtime: "browserpod";
  runtimeVersion: "2.12.1";
  browserLocal: true;
  node: string;
  platform: string;
  arch: string;
  checks: {
    nodeBaseline: true;
    cryptoVerify: boolean;
    sqlite: boolean;
  };
  lifecycle: BrowserPodRuntime["features"];
  diagnostics: { sqliteError?: string };
}

export function runBrowserPodPreflight(options: {
  BrowserPod: BrowserPodApi;
  apiKey: string;
  storageKey?: string;
  onOutput?: (chunk: string) => void;
}): Promise<BrowserPodPreflightEvidence>;

export function runBrowserRuntimePreflight(options: {
  runtime: BrowserPodRuntime;
  onOutput?: (chunk: string) => void;
}): Promise<BrowserPodPreflightEvidence>;

export const EVIDENCE_PREFIX: string;
export const PROBE_SOURCE: string;
export function assertNodeBaseline(version: string): void;
export function parseEvidence(output: string): Record<string, unknown>;
