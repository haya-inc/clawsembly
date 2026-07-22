import type { BrowserPodRuntime } from "./browserpod-runtime.mjs";

export const WORKSPACE_BACKUP_FORMAT: "clawsembly.browserpod-workspace";
export const WORKSPACE_BACKUP_VERSION: 2;

export class WorkspaceBackupError extends Error {
  readonly code: string;
}

export interface WorkspaceBackupSubject {
  artifact: {
    package: string;
    version: string;
    integrity: string;
  };
  runtime: {
    provider: "browserpod";
    version: string;
  };
  workspaceId: string;
}

export interface WorkspaceBackupFile {
  path: string;
  content: Uint8Array;
}

export interface DecodedWorkspaceBackup {
  manifest: Readonly<{
    format: "clawsembly.browserpod-workspace";
    version: 2;
    createdAt: string;
    subject: Readonly<WorkspaceBackupSubject>;
    workspace: Readonly<{ root: string; files: number; bytes: number }>;
    encrypted: true;
  }>;
  files: readonly Readonly<WorkspaceBackupFile>[];
}

export interface WorkspaceBackupCryptoOptions {
  crypto?: Crypto;
}

export function createWorkspaceBackup(options: WorkspaceBackupCryptoOptions & {
  files: readonly WorkspaceBackupFile[];
  subject: WorkspaceBackupSubject;
  workspaceRoot: string;
  passphrase: string;
  createdAt?: Date;
}): Promise<Uint8Array>;

export function decodeWorkspaceBackup(options: WorkspaceBackupCryptoOptions & {
  backup: Uint8Array;
  passphrase: string;
  expectedSubject: WorkspaceBackupSubject;
}): Promise<Readonly<DecodedWorkspaceBackup>>;

export function migrateLegacyWorkspaceSnapshot(options: WorkspaceBackupCryptoOptions & {
  snapshot: Uint8Array | string | Record<string, unknown>;
  expectedSubject: WorkspaceBackupSubject;
  targetSubject?: WorkspaceBackupSubject;
  targetWorkspaceRoot?: string;
  passphrase: string;
  createdAt?: Date;
}): Promise<Uint8Array>;

export interface BrowserPodWorkspaceOperationOptions extends WorkspaceBackupCryptoOptions {
  runtime: BrowserPodRuntime;
  workspaceRoot: string;
  passphrase: string;
  exchangeRoot?: string;
  idFactory?: () => string;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
}

export function exportBrowserPodWorkspace(options: BrowserPodWorkspaceOperationOptions & {
  subject: WorkspaceBackupSubject;
  now?: () => Date;
}): Promise<Uint8Array>;

export function restoreBrowserPodWorkspace(options: BrowserPodWorkspaceOperationOptions & {
  backup: Uint8Array;
  expectedSubject: WorkspaceBackupSubject;
}): Promise<Readonly<{ files: number; bytes: number; root: string; complete: true }>>;

