import type { CapabilityConsentController, PermissionRecord } from "../capability-broker/capability-consent.mjs";

export interface PermissionPromptModelRecord extends PermissionRecord {
  statusLabel: string;
  remainingMs: number | null;
}

export interface CapabilityAuditExport {
  schemaVersion: 1;
  generatedAt: string;
  subject: object;
  permissionAudit: { truncated: boolean; events: readonly object[] };
  brokerAudit: { schemaVersion: 1; subject: object; truncated: boolean; events: readonly object[] };
}

export function buildPermissionPromptModel(manifest: ReturnType<CapabilityConsentController["manifest"]>, options?: {
  now?: number;
}): Readonly<{
  generatedAt: string;
  subject: object;
  summary: string;
  permissions: readonly Readonly<PermissionPromptModelRecord>[];
}>;

export function mountCapabilityPermissionPrompt(options: {
  container: Element;
  permissions: CapabilityConsentController;
  durationOptions?: readonly { value: number; label: string }[];
  onChange?: (manifest: ReturnType<CapabilityConsentController["manifest"]>) => void;
  onAuditExport?: (audit: CapabilityAuditExport) => void;
  clock?: () => number;
}): Readonly<{
  refresh(): void;
  exportAudit(): CapabilityAuditExport;
  destroy(): void;
}>;

export function downloadCapabilityAudit(audit: CapabilityAuditExport, options?: {
  document?: Document;
  filename?: string;
}): void;

export function serializeCapabilityAudit(audit: CapabilityAuditExport): string;
