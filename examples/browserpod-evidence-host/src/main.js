import { BrowserPod } from "@leaningtech/browserpod";
import { runBrowserPodOpenClawProbe } from "../../../packages/browser-runtime/browserpod-openclaw-probe.mjs";

const status = document.querySelector("[data-capture-status]");
const encoder = new TextEncoder();
globalThis.__CLAWSEMBLY_PHASE_COUNTS__ = Object.create(null);
globalThis.__CLAWSEMBLY_FAILURE_CODE__ = null;

globalThis.__RUN_CLAWSEMBLY_BROWSERPOD_EVIDENCE__ = async (options) => {
  const apiKey = options?.apiKey;
  const artifact = options?.artifact;
  const nodeEngine = options?.nodeEngine;
  const source = options?.source;
  if (typeof apiKey !== "string" || !apiKey || !artifact || typeof source !== "string"
    || typeof nodeEngine !== "string" || !nodeEngine) {
    throw new Error("Owner-authorized BrowserPod capture options are incomplete.");
  }
  options.apiKey = undefined;
  status.textContent = "Owner-authorized BrowserPod evidence capture is running.";
  let session;
  try {
    session = await runBrowserPodOpenClawProbe({
      BrowserPod,
      apiKey,
      artifact,
      nodeEngine,
      browser: navigator.userAgent,
      source,
      onOutput({ phase, chunk }) {
        const current = globalThis.__CLAWSEMBLY_PHASE_COUNTS__[phase] ?? { chunks: 0, bytes: 0 };
        globalThis.__CLAWSEMBLY_PHASE_COUNTS__[phase] = {
          chunks: current.chunks + 1,
          bytes: current.bytes + encoder.encode(chunk).byteLength
        };
      }
    });
    status.textContent = "Evidence captured and Gateway cooperatively stopped.";
    return session.evidence;
  } catch (error) {
    // Error objects lose custom properties across the driver's evaluate
    // boundary, so the sanitized machine code is exposed separately; the
    // driver reads it the same way it reads the phase counters.
    globalThis.__CLAWSEMBLY_FAILURE_CODE__ = typeof error?.code === "string"
      && /^[a-z0-9_-]{1,64}$/u.test(error.code)
      ? error.code
      : null;
    throw error;
  } finally {
    session?.dispose();
  }
};
