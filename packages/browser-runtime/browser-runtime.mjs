export const BROWSER_RUNTIME_CONTRACT_VERSION = 1;

export class BrowserRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrowserRuntimeError";
    this.code = code;
  }
}

export function assertAbsoluteGuestPath(value, label = "guest path") {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4_096
    || value.includes("\0") || (value !== "/"
      && segments.slice(1).some((segment) => !segment || segment === "." || segment === ".."))) {
    throw new BrowserRuntimeError("invalid_path", `${label} must be an absolute normalized guest path`);
  }
  return value;
}

export function normalizeCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new BrowserRuntimeError("invalid_command", "runtime command is invalid");
  }
  if (typeof command.executable !== "string" || command.executable.length === 0
    || command.executable.length > 1_024 || command.executable.includes("\0")) {
    throw new BrowserRuntimeError("invalid_command", "runtime executable is invalid");
  }
  if (!Array.isArray(command.args) || command.args.length > 1_024
    || command.args.some((arg) => typeof arg !== "string" || arg.length > 32_768 || arg.includes("\0"))) {
    throw new BrowserRuntimeError("invalid_command", "runtime arguments are invalid");
  }
  if (command.cwd !== undefined) assertAbsoluteGuestPath(command.cwd, "runtime cwd");
  const env = command.env ?? [];
  if (!Array.isArray(env) || env.length > 256 || env.some((entry) => typeof entry !== "string"
    || !/^[A-Za-z_][A-Za-z0-9_]*=[^\u0000]*$/u.test(entry) || entry.length > 32_768)) {
    throw new BrowserRuntimeError("invalid_command", "runtime environment is invalid");
  }
  const cols = command.cols ?? 120;
  const rows = command.rows ?? 30;
  if (!Number.isSafeInteger(cols) || cols < 20 || cols > 500
    || !Number.isSafeInteger(rows) || rows < 5 || rows > 200) {
    throw new BrowserRuntimeError("invalid_terminal", "runtime terminal dimensions are invalid");
  }
  const outputLimitBytes = command.outputLimitBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1_024 || outputLimitBytes > 16 * 1024 * 1024) {
    throw new BrowserRuntimeError("invalid_terminal", "runtime output limit is invalid");
  }
  return Object.freeze({
    executable: command.executable,
    args: Object.freeze([...command.args]),
    ...(command.cwd ? { cwd: command.cwd } : {}),
    env: Object.freeze([...env]),
    echo: command.echo === true,
    cols,
    rows,
    outputLimitBytes
  });
}

export function waitForCondition({ current, subscribe, matches, timeoutMs = 30_000, signal, timeoutMessage }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new BrowserRuntimeError("invalid_timeout", "runtime wait timeout is invalid");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new BrowserRuntimeError("invalid_signal", "runtime wait signal is invalid");
  }
  const initial = current();
  if (matches(initial)) return Promise.resolve(initial);
  if (signal?.aborted) return Promise.reject(new BrowserRuntimeError("cancelled", "runtime wait was cancelled"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    let unsubscribe = () => {};
    let abort = () => {};
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const listener = () => {
      const value = current();
      if (matches(value)) finish(undefined, value);
    };
    const subscribed = subscribe(listener);
    if (typeof subscribed !== "function") {
      finish(new BrowserRuntimeError("invalid_listener", "runtime subscription is invalid"));
      return;
    }
    if (settled) {
      subscribed();
      return;
    }
    unsubscribe = subscribed;
    abort = () => finish(new BrowserRuntimeError("cancelled", "runtime wait was cancelled"));
    timeout = setTimeout(
      () => finish(new BrowserRuntimeError("timeout", timeoutMessage)),
      timeoutMs
    );
    signal?.addEventListener("abort", abort, { once: true });
    listener();
  });
}
