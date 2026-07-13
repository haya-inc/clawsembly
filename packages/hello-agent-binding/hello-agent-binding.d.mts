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
import type { EmbedManifest } from "../embed-sdk/embed-manifest.mjs";

export const HELLO_AGENT_INSTALL_ROOT: "/workspace/.clawsembly/hello-agent";
export const HELLO_AGENT_READY_LINE: "[hello-agent] ready";
export const HELLO_AGENT_CAPABILITY_REQUIREMENTS: readonly never[];

export type HelloAgentArtifactIdentity = Readonly<{
  package: "clawsembly-hello-agent";
  version: string;
  integrity: string;
}>;

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
  protocol: "clawsembly-hello/1";
}

export interface HelloAgentSession {
  root: string;
  requestsRoot: string;
  responsesRoot: string;
  protocolPath: string;
  protocol: "clawsembly-hello/1";
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
  nonceFactory?: () => string;
  onOutput?: (event: Readonly<{ phase: "hello-agent"; chunk: string }>) => void;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<VerifiedHelloAgentProcess>;

export interface HelloAgentClient {
  artifact: HelloAgentArtifactIdentity;
  readonly requestCount: number;
  readonly closed: boolean;
  say(params: { name: string }): Promise<Readonly<{ greeting: string }>>;
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
    readiness: { output: true; readyFile: true; protocol: string };
    termination: { mode: "guest-supervisor"; result: "pass" };
  };
  protocol: { method: "hello.say"; roundTrips: number };
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
}>;

export function bootHelloAgentEmbed(options: {
  manifest: EmbedManifest;
  BrowserPod: BrowserPodApi;
  browserPodApiKey: string;
  workspaceId?: string;
  installRoot?: string;
  capabilityHandlers?: Record<string, (input: unknown, context: CapabilityHandlerContext) => unknown | Promise<unknown>>;
  sessionId?: string;
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
