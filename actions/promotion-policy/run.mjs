#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
  DEFAULT_POLICY_URL,
  formatPromotionPolicy,
  loadPromotionPolicy
} from "../../examples/release-policy/check.mjs";

function appendEnvironmentFile(path, source) {
  if (typeof path === "string" && path.length > 0) appendFileSync(path, source, { encoding: "utf8" });
}

async function main() {
  const mode = (process.env.INPUT_MODE ?? "observe").trim().toLowerCase();
  if (!new Set(["observe", "gate"]).has(mode)) {
    throw new Error('Action input "mode" must be "observe" or "gate".');
  }
  const policy = await loadPromotionPolicy({
    url: process.env.INPUT_POLICY_URL?.trim() || DEFAULT_POLICY_URL
  });
  const reasons = policy.candidate.reasons.join(",");
  process.stdout.write(`${formatPromotionPolicy(policy)}\n`);
  appendEnvironmentFile(process.env.GITHUB_OUTPUT,
    `decision=${policy.decision}\ncandidate_version=${policy.candidate.version}\nreasons=${reasons}\n`);
  appendEnvironmentFile(process.env.GITHUB_STEP_SUMMARY,
    `## Clawsembly OpenClaw promotion policy\n\n- Candidate: \`${policy.candidate.version}\`\n- Decision: **${policy.decision.toUpperCase()}**\n- Blockers: ${reasons || "none"}\n`);
  if (mode === "gate" && policy.decision !== "promote") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Clawsembly policy action failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
