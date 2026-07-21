import { createEmbedManifest } from "../../../packages/embed-sdk/embed-manifest.mjs";
import { loadVerifiedCompatibilityReport } from "../../../packages/embed-sdk/report-loader.mjs";
import { HELLO_AGENT_ARTIFACT } from "../../../packages/hello-agent-binding/hello-agent-artifact.generated.mjs";
import { HELLO_AGENT_CAPABILITY_REQUIREMENTS } from "../../../packages/hello-agent-binding/hello-agent-binding.mjs";

export const HELLO_AGENT_IDENTITY = Object.freeze({
  package: HELLO_AGENT_ARTIFACT.name,
  version: HELLO_AGENT_ARTIFACT.version,
  integrity: HELLO_AGENT_ARTIFACT.integrity
});

const encoder = new TextEncoder();

/**
 * Launch bootstrap: the verified-launch assertion requires a supported,
 * evidence-bearing report, but the very first real capture is what produces
 * hello-agent evidence in the first place. The capture hosts therefore feed
 * the loader a self-served bootstrap report pinned by its own SHA-256 —
 * exactly the shape the provider-free end-to-end test uses. The captured
 * evidence never inherits this report's status: it must pass the digest-bound
 * hello-agent evidence gate on its own, and it claims nothing about any real
 * upstream.
 */
export async function bootstrapManifest() {
  const value = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "supported",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Desktop Chromium" },
    artifact: { ...HELLO_AGENT_IDENTITY },
    evidence: [{
      id: "hello-agent-runtime",
      kind: "browser-runtime",
      path: `evidence/hello-agent-${HELLO_AGENT_IDENTITY.version}.json`,
      sha256: "a".repeat(64)
    }],
    checks: [
      { id: "hello-agent-install", status: "pass" },
      { id: "hello-agent-boot", status: "pass" },
      { id: "hello-agent-protocol", status: "pass" },
      { id: "hello-agent-capability", status: "pass" }
    ]
  };
  const body = `${JSON.stringify(value)}\n`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(body));
  const report = await loadVerifiedCompatibilityReport({
    url: "https://example.invalid/hello-agent-bootstrap.json",
    sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    maxAgeMs: 24 * 60 * 60 * 1_000,
    artifact: value.artifact,
    target: { runtime: "browserpod", runtimeVersion: "2.12.1" }
  }, {
    fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } })
  });
  return createEmbedManifest({
    report,
    capabilities: [...HELLO_AGENT_CAPABILITY_REQUIREMENTS]
  });
}
