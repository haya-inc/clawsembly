import type { RuntimeCommand } from "./browser-runtime.mjs";
import type { BrowserPodRuntime, BrowserPodTask } from "./browserpod-runtime.mjs";

export const COOPERATIVE_SUPERVISOR_PREFIX: string;
export const COOPERATIVE_SUPERVISOR_SOURCE: string;

export interface CooperativeProcess {
  readonly id: string;
  readonly mode: "guest-supervisor";
  readonly task: BrowserPodTask;
  readonly stopRequested: boolean;
  stop(options?: { timeoutMs?: number }): Promise<Readonly<{
    complete: boolean;
    mode: "guest-supervisor";
    reason: string;
    taskId: string;
  }>>;
}

export function startCooperativeProcess(options: {
  runtime: Pick<BrowserPodRuntime, "provider" | "start" | "createDirectory" | "writeTextFile">;
  root: string;
  id: string;
  command: RuntimeCommand & { cwd: string };
  graceMs?: number;
  readyTimeoutMs?: number;
  nonceFactory?: () => string;
}): Promise<Readonly<CooperativeProcess>>;
