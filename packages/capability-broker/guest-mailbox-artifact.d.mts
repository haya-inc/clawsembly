import type { BrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";

export interface StagedGuestMailboxClient {
  schemaVersion: 1;
  root: string;
  entrypointPath: string;
  protocolPath: string;
  integrity: `sha256-${string}`;
  verified: true;
  files: readonly Readonly<{
    path: string;
    relativePath: "mailbox-protocol.mjs" | "guest-mailbox-client.mjs";
    bytes: number;
    integrity: `sha256-${string}`;
  }>[];
}

export function stageGuestMailboxClient(options: {
  runtime: Pick<BrowserPodRuntime, "provider" | "createDirectory" | "writeTextFile" | "readTextFile">;
  root: string;
}): Promise<Readonly<StagedGuestMailboxClient>>;
