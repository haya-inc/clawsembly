import {
  BrowserRuntimeError,
  assertAbsoluteGuestPath
} from "./browser-runtime.mjs";

export const OPENCLAW_INSTALL_ROOT = "/workspace/.clawsembly/openclaw";
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

export function assertExactOpenClawArtifact(artifact) {
  if (!artifact || artifact.package !== "openclaw" || typeof artifact.version !== "string"
    || !VERSION_PATTERN.test(artifact.version) || typeof artifact.integrity !== "string"
    || !INTEGRITY_PATTERN.test(artifact.integrity)) {
    throw new TypeError("an exact OpenClaw version and sha512 integrity are required");
  }
  return Object.freeze({ package: "openclaw", version: artifact.version, integrity: artifact.integrity });
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw new BrowserRuntimeError("invalid_install", `${label} is not valid JSON`); }
}

function safeSink(sink, value) {
  try { sink?.(Object.freeze(value)); }
  catch { /* Diagnostics cannot break artifact installation. */ }
}

/**
 * Installs one exact OpenClaw npm artifact into a BrowserRuntime filesystem and
 * verifies both the installed manifest and package-lock integrity before
 * exposing its executable path.
 */
export function createVerifiedOpenClawInstaller({
  runtime,
  artifact: untrustedArtifact,
  root = OPENCLAW_INSTALL_ROOT,
  onOutput,
  onAudit,
  now = Date.now
}) {
  if (!runtime || typeof runtime.createDirectory !== "function"
    || typeof runtime.writeTextFile !== "function" || typeof runtime.readTextFile !== "function"
    || typeof runtime.start !== "function") {
    throw new TypeError("a browser runtime is required for OpenClaw installation");
  }
  const artifact = assertExactOpenClawArtifact(untrustedArtifact);
  const installRoot = assertAbsoluteGuestPath(root, "OpenClaw install root");
  if (typeof onOutput !== "undefined" && typeof onOutput !== "function") {
    throw new TypeError("OpenClaw install output sink is invalid");
  }
  if (typeof onAudit !== "undefined" && typeof onAudit !== "function") {
    throw new TypeError("OpenClaw install audit sink is invalid");
  }
  if (typeof now !== "function") throw new TypeError("OpenClaw install clock is invalid");

  const stateRoot = `${installRoot}/state`;
  const packageManifestPath = `${installRoot}/package.json`;
  const packageLockPath = `${installRoot}/package-lock.json`;
  const installedManifestPath = `${installRoot}/node_modules/openclaw/package.json`;
  const executablePath = `${installRoot}/node_modules/openclaw/openclaw.mjs`;
  let state = "idle";
  let result;
  let inFlight;

  async function performInstall() {
    const startedAt = now();
    safeSink(onAudit, {
      action: "install",
      outcome: "started",
      package: "openclaw",
      version: artifact.version
    });
    await runtime.createDirectory(installRoot, { recursive: true });
    await runtime.createDirectory(stateRoot, { recursive: true });
    await runtime.writeTextFile(packageManifestPath, `${JSON.stringify({
      name: "clawsembly-verified-openclaw",
      private: true,
      dependencies: { openclaw: artifact.version }
    }, null, 2)}\n`);

    const task = await runtime.start({
      executable: "npm",
      args: [
        "install",
        "--save-exact",
        `openclaw@${artifact.version}`,
        "--no-audit",
        "--no-fund",
        "--no-progress",
        "--loglevel",
        "warn"
      ],
      cwd: installRoot,
      env: ["CI=1", "NO_COLOR=1"],
      outputLimitBytes: 4 * 1024 * 1024
    });
    task.onOutput((chunk) => safeSink(onOutput, { phase: "install", chunk }));
    const completion = await task.wait();
    if (completion.status !== "completed") {
      throw new BrowserRuntimeError("install_failed", "the exact OpenClaw artifact did not install");
    }

    const installedManifest = parseJson(
      await runtime.readTextFile(installedManifestPath),
      "installed OpenClaw manifest"
    );
    const packageLock = parseJson(
      await runtime.readTextFile(packageLockPath, { maxBytes: 8 * 1024 * 1024 }),
      "OpenClaw package lock"
    );
    const installedLock = packageLock?.packages?.["node_modules/openclaw"];
    if (installedManifest.version !== artifact.version || installedLock?.version !== artifact.version
      || installedLock?.integrity !== artifact.integrity) {
      throw new BrowserRuntimeError(
        "artifact_mismatch",
        "the installed artifact does not match the verified OpenClaw version and integrity"
      );
    }

    const installed = Object.freeze({
      schemaVersion: 1,
      artifact,
      root: installRoot,
      stateRoot,
      executablePath,
      packageManifestPath,
      packageLockPath,
      installedManifestPath,
      taskId: task.id,
      durationMs: Math.max(0, now() - startedAt),
      outputTruncated: task.outputTruncated,
      integrityMatched: true
    });
    safeSink(onAudit, {
      action: "install",
      outcome: "verified",
      package: "openclaw",
      version: artifact.version,
      taskId: task.id,
      durationMs: installed.durationMs,
      outputTruncated: installed.outputTruncated
    });
    return installed;
  }

  const installer = {
    schemaVersion: 1,
    artifact,
    root: installRoot,
    stateRoot,
    executablePath,
    get state() { return state; },
    install() {
      if (state === "installed") return Promise.resolve(result);
      if (state === "installing") return inFlight;
      state = "installing";
      inFlight = performInstall().then(
        (installed) => {
          result = installed;
          state = "installed";
          return installed;
        },
        (error) => {
          state = "failed";
          safeSink(onAudit, {
            action: "install",
            outcome: "failed",
            package: "openclaw",
            version: artifact.version,
            reason: error instanceof BrowserRuntimeError ? error.code : "install_failed"
          });
          throw error;
        }
      );
      return inFlight;
    }
  };
  return Object.freeze(installer);
}
