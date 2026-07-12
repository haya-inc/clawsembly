import type {
  BrokerSubject,
  CapabilityAuditEvent,
  CapabilityBroker,
  CapabilityGrant
} from "./capability-broker.mjs";

export type PermissionStatus = "pending" | "granted" | "denied" | "revoked" | "expired";

export interface PermissionRecord {
  capability: string;
  scope: string;
  requestedMaxCalls: number;
  grantedMaxCalls: number | null;
  status: PermissionStatus;
  expiresAt: string | null;
}

export interface PermissionAuditEvent {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  action: "approve" | "deny" | "revoke" | "expire";
  capability: string;
  scope: string;
  outcome: string;
  reason: string;
}

export class CapabilityConsentController {
  constructor(options: {
    broker: CapabilityBroker;
    requests?: CapabilityGrant[];
    clock?: () => number;
    auditSink?: (event: PermissionAuditEvent) => void;
    maxAuditEntries?: number;
  });
  approve(capability: string, scope: string, options?: {
    durationMs?: number;
    maxCalls?: number;
  }): Readonly<PermissionRecord>;
  deny(capability: string, scope: string): void;
  revoke(capability: string, scope: string): boolean;
  manifest(): Readonly<{
    schemaVersion: 1;
    generatedAt: string;
    subject: Readonly<BrokerSubject>;
    permissions: readonly Readonly<PermissionRecord>[];
  }>;
  exportAudit(): Readonly<{
    schemaVersion: 1;
    generatedAt: string;
    subject: Readonly<BrokerSubject>;
    permissionAudit: Readonly<{
      truncated: boolean;
      events: readonly Readonly<PermissionAuditEvent>[];
    }>;
    brokerAudit: Readonly<{
      schemaVersion: 1;
      subject: Readonly<BrokerSubject>;
      truncated: boolean;
      events: readonly Readonly<CapabilityAuditEvent>[];
    }>;
  }>;
}
