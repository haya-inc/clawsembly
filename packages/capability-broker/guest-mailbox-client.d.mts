import type { BrokerSubject, CapabilityRequest } from "./capability-broker.mjs";
import type { MailboxManifest } from "./mailbox-protocol.mjs";

export class MailboxGuestError extends Error {
  readonly code: string;
}

export class FilesystemCapabilityMailboxClient {
  constructor(options: {
    root: string;
    channelId: string;
    pollIntervalMs?: number;
    startSequence?: number;
    clock?: () => number;
  });
  readonly manifest: Readonly<MailboxManifest> | undefined;
  readonly nextSequence: number;
  connect(): Promise<Readonly<MailboxManifest & { subject: Readonly<BrokerSubject> }>>;
  request<T = unknown, R = unknown>(request: CapabilityRequest<T>, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<R>;
}
