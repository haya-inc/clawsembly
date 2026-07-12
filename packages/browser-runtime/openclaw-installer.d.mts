import type { BrowserPodRuntime } from "./browserpod-runtime.mjs";

export const OPENCLAW_INSTALL_ROOT: "/workspace/.clawsembly/openclaw";

export function assertExactOpenClawArtifact(artifact: unknown): Readonly<{
  package: "openclaw";
  version: string;
  integrity: string;
}>;

export interface VerifiedOpenClawInstall {
  schemaVersion: 1;
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  root: string;
  stateRoot: string;
  executablePath: string;
  packageManifestPath: string;
  packageLockPath: string;
  installedManifestPath: string;
  taskId: string;
  durationMs: number;
  outputTruncated: boolean;
  integrityMatched: true;
}

export interface VerifiedOpenClawInstaller {
  schemaVersion: 1;
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  root: string;
  stateRoot: string;
  executablePath: string;
  readonly state: "idle" | "installing" | "installed" | "failed";
  install(): Promise<Readonly<VerifiedOpenClawInstall>>;
}

export function createVerifiedOpenClawInstaller(options: {
  runtime: BrowserPodRuntime;
  artifact: { package: "openclaw"; version: string; integrity: string };
  root?: string;
  onOutput?: (event: Readonly<{ phase: "install"; chunk: string }>) => void;
  onAudit?: (event: Readonly<Record<string, unknown>>) => void;
  now?: () => number;
}): Readonly<VerifiedOpenClawInstaller>;
