import type { BrokerSubject, CapabilityRequest } from "./capability-broker.mjs";

export const CAPABILITY_MAILBOX_SCHEMA_VERSION: 1;
export const DEFAULT_MAILBOX_MAX_BYTES: number;

export class MailboxProtocolError extends Error {
  readonly code: string;
}

export interface MailboxManifest {
  schemaVersion: 1;
  channelId: string;
  subject: Readonly<BrokerSubject>;
  limits: Readonly<{ maxRequestBytes: number; maxResponseBytes: number }>;
}

export interface MailboxRequest<T = unknown> extends CapabilityRequest<T> {
  schemaVersion: 1;
  channelId: string;
  sequence: number;
}

export type MailboxResponse<R = unknown> = Readonly<{
  schemaVersion: 1;
  channelId: string;
  sequence: number;
  id: string | null;
  ok: true;
  result: R;
} | {
  schemaVersion: 1;
  channelId: string;
  sequence: number;
  id: string | null;
  ok: false;
  error: Readonly<{ code: string; message: string }>;
}>;

export function mailboxPaths(root: string, sequence: number): Readonly<{
  request: string;
  requestReady: string;
  cancelReady: string;
  response: string;
  responseReady: string;
}>;
export function serializeMailboxValue(value: unknown, maxBytes?: number, label?: string): string;
export function parseMailboxValue(text: string, maxBytes?: number, label?: string): unknown;
export function createMailboxManifest(options: {
  channelId: string;
  subject: BrokerSubject;
  maxRequestBytes: number;
  maxResponseBytes: number;
}): MailboxManifest;
export function parseMailboxManifest(text: string, options: { channelId: string; maxBytes?: number }): MailboxManifest;
export function createMailboxRequest<T>(request: MailboxRequest<T>): Readonly<MailboxRequest<T>>;
export function parseMailboxRequest<T = unknown>(text: string, options: {
  channelId: string;
  sequence: number;
  maxBytes?: number;
}): Readonly<MailboxRequest<T>>;
export function createMailboxResponse<R>(response: MailboxResponse<R>): MailboxResponse<R>;
export function parseMailboxResponse<R = unknown>(text: string, options: {
  channelId: string;
  sequence: number;
  id: string;
  maxBytes?: number;
}): MailboxResponse<R>;
