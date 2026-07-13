import type { BrowserPodApi, BrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import type {
  CapabilityBroker,
  CapabilityAuditEvent,
  CapabilityHandlerContext
} from "../capability-broker/capability-broker.mjs";
import type {
  CapabilityConsentController,
  PermissionAuditEvent
} from "../capability-broker/capability-consent.mjs";
import type { FilesystemCapabilityMailboxHost } from "../capability-broker/filesystem-mailbox-host.mjs";
import type { StagedGuestMailboxClient } from "../capability-broker/guest-mailbox-artifact.mjs";
import type { EmbedManifest } from "../embed-sdk/embed-manifest.mjs";

export const HELLO_AGENT_INSTALL_ROOT: "/workspace/.clawsembly/hello-agent";
export const HELLO_AGENT_READY_LINE: "[hello-agent] ready";
export const HELLO_AGENT_CAPABILITY_REQUIREMENTS: readonly Readonly<{
  capability: string;
  scope: string;
  maxCalls: number;
}>[];

export type HelloAgentArtifactIdentity = Readonly<{
  package: "clawsembly-hello-agent";
  version: string;
  integrity: string;
}>;

export type HelloAgentCapabilityTransport = "filesystem-mailbox" | "none";

export class HelloAgentBindingError extends Error {
  constructor(code: string, message: string);
  code: string;
}

export function assertExactHelloAgentArtifact(artifact: unknown): HelloAgentArtifactIdentity;

export interface VerifiedHelloAgentInstall {
  schemaVersion: 1;
  artifact: HelloAgentArtifactIdentity;
  root: string;
  stateRoot: string;
  packageRoot: string;
  executablePath: string;
  protocolPath: string;
  installRecordPath: string;
  fileCount: number;
  files: readonly Readonly<{ path: string; relativePath: string; bytes: number; sha256: string }>[];
  durationMs: number;
  integrityMatched: true;
}

export interface VerifiedHelloAgentInstaller {
  schemaVersion: 1;
  artifact: HelloAgentArtifactIdentity;
  root: string;
  stateRoot: string;
  executablePath: string;
  protocolPath: string;
  readonly state: "idle" | "installing" | "installed" | "failed";
  install(): Promise<Readonly<VerifiedHelloAgentInstall>>;
}

export function createVerifiedHelloAgentInstaller(options: {
  runtime: Pick<BrowserPodRuntime, "createDirectory" | "writeTextFile" | "readTextFile">;
  artifact: { package: string; version: string; integrity: string };
  root?: string;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<VerifiedHelloAgentInstaller>;

export interface HelloAgentReadiness {
  output: true;
  readyFile: true;
  protocol: "clawsembly-hello/2";
  capabilityTransport: HelloAgentCapabilityTransport;
}

export interface HelloAgentSession {
  root: string;
  requestsRoot: string;
  responsesRoot: string;
  eventsRoot: string;
  protocolPath: string;
  protocol: "clawsembly-hello/2";
  capabilityTransport: HelloAgentCapabilityTransport;
  startedAt: string;
}

export interface HelloAgentStopResult {
  complete: boolean;
  mode: "guest-supervisor";
  reason: string;
  taskId: string | null;
}

export interface VerifiedHelloAgentProcess {
  schemaVersion: 1;
  artifact: HelloAgentArtifactIdentity;
  readonly state: "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";
  readonly task: Readonly<{ id: string; status: string }> | undefined;
  readonly readiness: Readonly<HelloAgentReadiness> | undefined;
  readonly session: Readonly<HelloAgentSession> | undefined;
  credentials(): Readonly<{ sessionToken: string }>;
  start(): Promise<Readonly<HelloAgentReadiness>>;
  stop(options?: { timeoutMs?: number }): Promise<Readonly<HelloAgentStopResult>>;
}

export function createVerifiedHelloAgentProcess(options: {
  runtime: Pick<BrowserPodRuntime, "start" | "createDirectory" | "writeTextFile" | "readTextFile">;
  installer: Readonly<VerifiedHelloAgentInstaller>;
  graceMs?: number;
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
  environment?: readonly string[];
  nonceFactory?: () => string;
  onOutput?: (event: Readonly<{ phase: "hello-agent"; chunk: string }>) => void;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<VerifiedHelloAgentProcess>;

export interface HelloAgentChatTurn {
  id: string;
  reply: string | null;
  reason: "completed" | "aborted";
  events: number;
}

export interface HelloAgentChatHistoryTurn {
  id: string;
  at: string;
  message: string;
  reply: string | null;
  reason: string;
}

export interface HelloAgentClient {
  artifact: HelloAgentArtifactIdentity;
  readonly requestCount: number;
  readonly closed: boolean;
  say(params: { name: string }): Promise<Readonly<{ greeting: string }>>;
  startChat(params: { message: string }): Promise<Readonly<{
    id: string;
    completion: Promise<Readonly<HelloAgentChatTurn>>;
  }>>;
  abortChat(params: { target: string }): Promise<Readonly<{ aborted: boolean }>>;
  chatHistory(): Promise<Readonly<{
    turns: readonly Readonly<HelloAgentChatHistoryTurn>[];
    total: number;
  }>>;
  close(): void;
}

export function createHelloAgentClient(options: {
  runtime: Pick<BrowserPodRuntime, "writeTextFile" | "readTextFile">;
  process: Readonly<VerifiedHelloAgentProcess>;
  requestIdFactory?: () => string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<HelloAgentClient>;

export interface HelloAgentRuntimeEvidence {
  schemaVersion: 1;
  capturedAt: string;
  target: { runtime: "browserpod"; browserLocal: true; runtimeVersion: string; browser: string };
  artifact: { package: string; version: string; integrity: string };
  install: { result: "pass"; integrityMatched: true; fileCount: number; durationMs: number };
  process: {
    result: "pass";
    readiness: {
      output: true;
      readyFile: true;
      protocol: string;
      capabilityTransport: "filesystem-mailbox";
    };
    termination: { mode: "guest-supervisor"; result: "pass" };
  };
  protocol: { methods: readonly string[]; helloRoundTrips: number; chatRoundTrips: number };
  capability: { capability: string; scope: string; denied: number; allowed: number };
}

export function assertHelloAgentRuntimeEvidence(evidence: unknown): HelloAgentRuntimeEvidence;

export function helloAgentEvidenceRecord(evidence: HelloAgentRuntimeEvidence): Promise<Readonly<{
  id: "hello-agent-runtime";
  kind: "browser-runtime";
  capturedAt: string;
  path: string;
  sha256: string;
  summary: string;
}>>;

export function deriveHelloAgentCheckStatuses(evidence?: unknown): Readonly<{
  "hello-agent-install": "pass" | "pending";
  "hello-agent-boot": "pass" | "pending";
  "hello-agent-protocol": "pass" | "pending";
  "hello-agent-capability": "pass" | "pending";
}>;

export interface HelloAgentGuestTransport {
  schemaVersion: 1;
  kind: "filesystem-mailbox";
  channelId: string;
  mailboxRoot: string;
  client: Readonly<StagedGuestMailboxClient>;
  environment: readonly string[];
}

export function bootHelloAgentEmbed(options: {
  manifest: EmbedManifest;
  BrowserPod: BrowserPodApi;
  browserPodApiKey: string;
  workspaceId?: string;
  installRoot?: string;
  capabilityHandlers?: Record<string, (input: unknown, context: CapabilityHandlerContext) => unknown | Promise<unknown>>;
  sessionId?: string;
  mailboxChannelId?: string;
  mailboxRoot?: string;
  mailboxOptions?: {
    pollIntervalMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxRequests?: number;
    clock?: () => number;
  };
  onRuntimeAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onInstallAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onProcessOutput?: (event: Readonly<{ phase: "hello-agent"; chunk: string }>) => void;
  onProcessAudit?: (event: Readonly<Record<string, unknown>>) => void;
  onCapabilityAudit?: (event: CapabilityAuditEvent) => void;
  onPermissionAudit?: (event: PermissionAuditEvent) => void;
  processOptions?: {
    graceMs?: number;
    readyTimeoutMs?: number;
    pollIntervalMs?: number;
    nonceFactory?: () => string;
  };
}): Promise<Readonly<{
  schemaVersion: 1;
  manifest: Readonly<EmbedManifest>;
  runtime: Readonly<BrowserPodRuntime>;
  installer: Readonly<VerifiedHelloAgentInstaller>;
  process: Readonly<VerifiedHelloAgentProcess>;
  capabilities: CapabilityBroker;
  permissions: CapabilityConsentController;
  mailbox: FilesystemCapabilityMailboxHost;
  guestTransport: Readonly<HelloAgentGuestTransport>;
  createClient(options?: {
    requestIdFactory?: () => string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    onAudit?: (event: Readonly<Record<string, unknown>>) => void;
    now?: () => number;
  }): Readonly<HelloAgentClient>;
  readonly closed: boolean;
  dispose(): Readonly<{ complete: false; reason: string; activeTaskIds: readonly string[] }>;
  close(): Promise<Readonly<{
    logicalSessionClosed: boolean;
    reason: string;
    gatewayStop: Readonly<HelloAgentStopResult> | null;
    runtimeDisposition: ReturnType<BrowserPodRuntime["dispose"]> | null;
  }>>;
}>>;
