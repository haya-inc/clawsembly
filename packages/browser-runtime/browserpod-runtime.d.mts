import type { RuntimeCommand } from "./browser-runtime.mjs";

export const BROWSERPOD_ADAPTER_VERSION: "2.12.1";

export interface BrowserPodTextFile {
  write(data: string): Promise<number | void>;
  read(length: number): Promise<string>;
  getSize(): Promise<number>;
  close(): Promise<void>;
}

export interface BrowserPodPod {
  run(executable: string, args: string[], options: {
    terminal: unknown;
    env?: string[];
    cwd?: string;
    echo?: boolean;
  }): Promise<unknown>;
  onPortal(handler: (portal: { url: string; port: number }) => void): void;
  createCustomTerminal(options: {
    cols?: number;
    rows?: number;
    onOutput(buffer: ArrayBuffer, vt?: unknown): void;
  }): Promise<unknown>;
  createDirectory(path: string, options?: { recursive?: boolean }): Promise<void>;
  createFile(path: string, mode: "utf-8"): Promise<BrowserPodTextFile>;
  openFile(path: string, mode: "utf-8"): Promise<BrowserPodTextFile>;
}

export interface BrowserPodApi {
  boot(options: {
    apiKey: string;
    nodeVersion: "22";
    storageKey?: string;
  }): Promise<BrowserPodPod>;
}

export interface BrowserPodPortal {
  port: number;
  url: string;
  visibility: "public-url";
}

export interface BrowserPodTask {
  readonly id: string;
  readonly status: "starting" | "running" | "completed" | "failed";
  readonly transcript: string;
  readonly outputTruncated: boolean;
  onOutput(listener: (chunk: string) => void, options?: { replay?: boolean }): () => boolean;
  wait(): Promise<Readonly<{ status: "completed" | "failed"; outputBytes: number; outputTruncated: boolean }>>;
  waitForOutput(needle: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<string>;
  terminate(): never;
}

export interface BrowserPodRuntime {
  readonly contractVersion: 1;
  readonly provider: "browserpod";
  readonly version: "2.12.1";
  readonly features: Readonly<{
    browserLocal: true;
    nodeMajor: 22;
    persistentFilesystem: boolean;
    portals: true;
    portalVisibility: "public-url";
    fileApi: true;
    interactiveInput: false;
    processTermination: false;
    hardDispose: false;
  }>;
  start(command: RuntimeCommand): Promise<BrowserPodTask>;
  waitForPortal(port: number, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<BrowserPodPortal>;
  createDirectory(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeTextFile(path: string, text: string): Promise<void>;
  readTextFile(path: string, options?: { maxBytes?: number }): Promise<string>;
  dispose(): Readonly<{ complete: false; reason: string; activeTaskIds: readonly string[] }>;
}

export function createBrowserPodRuntime(options: {
  BrowserPod: BrowserPodApi;
  apiKey: string;
  storageKey?: string;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Promise<Readonly<BrowserPodRuntime>>;
