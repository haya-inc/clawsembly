import type {
  CapabilityAuditEvent,
  CapabilityBroker,
  CapabilityHandlerContext
} from "../capability-broker/capability-broker.mjs";
import type { BrowserPodApi, BrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import type { FilesystemCapabilityMailboxHost } from "../capability-broker/filesystem-mailbox-host.mjs";
import type { EmbedManifest } from "./embed-manifest.mjs";

export function bootVerifiedEmbed(options: {
  manifest: EmbedManifest;
  BrowserPod: BrowserPodApi;
  browserPodApiKey: string;
  workspaceId?: string;
  capabilityHandlers?: Record<string, (input: unknown, context: CapabilityHandlerContext) => unknown | Promise<unknown>>;
  sessionId?: string;
  mailboxChannelId?: string;
  onRuntimeAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onCapabilityAudit?: (event: CapabilityAuditEvent) => void;
  mailboxOptions?: {
    pollIntervalMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxRequests?: number;
    clock?: () => number;
  };
}): Promise<Readonly<{
  schemaVersion: 1;
  manifest: Readonly<EmbedManifest>;
  runtime: Readonly<BrowserPodRuntime>;
  capabilities: CapabilityBroker;
  mailbox: FilesystemCapabilityMailboxHost;
  readonly closed: boolean;
  dispose(): Readonly<{ complete: false; reason: string; activeTaskIds: readonly string[] }>;
}>>;

export function createArtifactStorageKey(manifest: EmbedManifest, workspaceId: string): string;
