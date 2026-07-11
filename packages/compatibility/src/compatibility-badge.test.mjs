import assert from "node:assert/strict";
import test from "node:test";
import { renderCompatibilityBadge } from "./compatibility-badge.mjs";

test("renderCompatibilityBadge emits an accessible status badge", () => {
  const badge = renderCompatibilityBadge({ version: "2026.6.11", status: "partial" });
  assert.match(badge, /aria-label="OpenClaw 2026\.6\.11 compatibility: partial"/);
  assert.match(badge, /fill="#f6c85f"/);
  assert.match(badge, />OpenClaw 2026\.6\.11</);
});

test("renderCompatibilityBadge escapes dynamic labels and rejects unknown states", () => {
  assert.match(
    renderCompatibilityBadge({ version: "<preview>", status: "probing" }),
    /&lt;preview&gt;/
  );
  assert.throws(
    () => renderCompatibilityBadge({ version: "1.0.0", status: "green" }),
    /Unsupported badge status/
  );
});
