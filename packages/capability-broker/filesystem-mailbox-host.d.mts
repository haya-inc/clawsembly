import type { BrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import type { CapabilityBroker } from "./capability-broker.mjs";
import type { MailboxManifest, MailboxResponse } from "./mailbox-protocol.mjs";

export class MailboxHostError extends Error {
  readonly code: string;
}

export interface MailboxHostEvent {
  schemaVersion: 1;
  sequence: number;
  id?: string;
  capability?: string;
  scope?: string;
  outcome: "allowed" | "denied" | "cancelled";
  code?: string;
  durationMs: number;
}

export class FilesystemCapabilityMailboxHost {
  constructor(options: {
    runtime: Pick<BrowserPodRuntime, "provider" | "createDirectory" | "writeTextFile" | "readTextFile">;
    broker: CapabilityBroker;
    root: string;
    channelId: string;
    pollIntervalMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxRequests?: number;
    clock?: () => number;
  });
  readonly nextSequence: number;
  initialize(): Promise<MailboxManifest>;
  snapshot(): Readonly<{
    schemaVersion: 1;
    channelId: string;
    subject: CapabilityBroker["subject"];
    nextSequence: number;
    processed: number;
    events: readonly Readonly<MailboxHostEvent>[];
  }>;
  processNext(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<Readonly<{
    response: MailboxResponse;
    event: Readonly<MailboxHostEvent>;
  }>>;
  serve(options: { signal: AbortSignal; maxRequests?: number }): Promise<readonly Readonly<{
    response: MailboxResponse;
    event: Readonly<MailboxHostEvent>;
  }>[]>;
}
