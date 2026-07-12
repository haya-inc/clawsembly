import { GUEST_MAILBOX_ARTIFACT } from "./generated-guest-mailbox-artifact.mjs";

function assertNormalizedGuestRoot(root) {
  const segments = typeof root === "string" ? root.split("/") : [];
  if (typeof root !== "string" || !root.startsWith("/") || root === "/" || root.endsWith("/")
    || root.length > 4_096 || root.includes("\0")
    || segments.slice(1).some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TypeError("guest mailbox artifact root is invalid");
  }
  return root;
}

function assertRuntime(runtime) {
  if (!runtime || runtime.provider !== "browserpod" || typeof runtime.createDirectory !== "function"
    || typeof runtime.writeTextFile !== "function" || typeof runtime.readTextFile !== "function") {
    throw new TypeError("a BrowserPod filesystem runtime is required for guest mailbox staging");
  }
  return runtime;
}

async function sha256(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Stages the generated, exact guest-side mailbox modules into a fresh
 * BrowserPod channel and reads them back before exposing their entrypoint.
 */
export async function stageGuestMailboxClient({ runtime, root }) {
  const targetRuntime = assertRuntime(runtime);
  const targetRoot = assertNormalizedGuestRoot(root);
  await targetRuntime.createDirectory(targetRoot, { recursive: true });

  const stagedFiles = [];
  for (const file of GUEST_MAILBOX_ARTIFACT.files) {
    if (new TextEncoder().encode(file.contents).byteLength !== file.bytes
      || await sha256(file.contents) !== file.integrity) {
      throw new Error(`generated guest mailbox artifact is corrupt: ${file.relativePath}`);
    }
    const path = `${targetRoot}/${file.relativePath}`;
    await targetRuntime.writeTextFile(path, file.contents);
    const observed = await targetRuntime.readTextFile(path, { maxBytes: file.bytes + 1 });
    if (observed !== file.contents) {
      throw new Error(`guest mailbox artifact verification failed for ${file.relativePath}`);
    }
    stagedFiles.push(Object.freeze({
      path,
      relativePath: file.relativePath,
      bytes: file.bytes,
      integrity: file.integrity
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    root: targetRoot,
    entrypointPath: `${targetRoot}/${GUEST_MAILBOX_ARTIFACT.entrypoint}`,
    protocolPath: `${targetRoot}/${GUEST_MAILBOX_ARTIFACT.protocol}`,
    integrity: GUEST_MAILBOX_ARTIFACT.integrity,
    verified: true,
    files: Object.freeze(stagedFiles)
  });
}
