export interface BrokerSubject {
  artifact: { package: "openclaw"; version: string; integrity: string };
  runtime: string;
  sessionId: string;
}

export interface CapabilityGrant {
  capability: string;
  scope: string;
  maxCalls?: number;
  expiresAt?: string;
}

export interface CapabilityRequest<T = unknown> {
  id: string;
  capability: string;
  scope: string;
  input: T;
}

export interface CapabilityHandlerContext {
  subject: Readonly<BrokerSubject>;
  capability: string;
  scope: string;
  requestId: string;
  signal?: AbortSignal;
}

export interface CapabilityAuditEvent {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  durationMs: number;
  action: "grant" | "revoke" | "request";
  capability: string;
  scope: string;
  requestId?: string;
  outcome: string;
  reason: string;
}

export class CapabilityBrokerError extends Error {
  readonly code: string;
}

export class CapabilityBroker {
  constructor(options: {
    subject: BrokerSubject;
    grants?: CapabilityGrant[];
    handlers?: Record<string, (input: unknown, context: CapabilityHandlerContext) => unknown | Promise<unknown>>;
    clock?: () => number;
    auditSink?: (event: CapabilityAuditEvent) => void;
    maxAuditEntries?: number;
  });
  readonly subject: Readonly<BrokerSubject>;
  grant(grant: CapabilityGrant): void;
  revoke(capability: string, scope: string): boolean;
  auditSnapshot(): Readonly<{
    schemaVersion: 1;
    subject: Readonly<BrokerSubject>;
    truncated: boolean;
    events: readonly Readonly<CapabilityAuditEvent>[];
  }>;
  request<T = unknown, R = unknown>(request: CapabilityRequest<T>, options?: { signal?: AbortSignal }): Promise<R>;
}

export function runCapabilityBrokerPolicyProbe(): Promise<Readonly<{
  result: "pass";
  runtime: "browserpod";
  defaultDeny: true;
  exactScope: true;
  callLimit: true;
  payloadRedacted: true;
  auditEvents: number;
}>>;
