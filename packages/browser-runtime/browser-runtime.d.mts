export const BROWSER_RUNTIME_CONTRACT_VERSION: 1;

export class BrowserRuntimeError extends Error {
  readonly code: string;
}

export function assertAbsoluteGuestPath(value: unknown, label?: string): string;

export interface RuntimeCommand {
  executable: string;
  args: string[];
  cwd?: string;
  env?: string[];
  echo?: boolean;
  cols?: number;
  rows?: number;
  outputLimitBytes?: number;
}

export function normalizeCommand(command: RuntimeCommand): Readonly<Required<Omit<RuntimeCommand, "cwd">> & { cwd?: string }>;
