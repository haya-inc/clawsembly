#!/usr/bin/env node
// The deployment security headers are declared in five places: the Cloudflare
// Pages `_headers` file, netlify.toml, vercel.json, the index.html CSP meta, and
// the Vite dev/preview server. Release readiness exercises only `_headers`,
// so this check pins the other four to it and fails on silent drift.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const HEADER_NAMES = [
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Embedder-Policy",
  "Content-Security-Policy",
  "Referrer-Policy",
  "X-Content-Type-Options",
  "Permissions-Policy"
];

function parseHeadersFile(source) {
  const headers = {};
  for (const line of source.split("\n")) {
    const match = line.match(/^ {2}([A-Za-z-]+): (.+)$/u);
    if (match) headers[match[1]] = match[2];
  }
  return headers;
}

const canonical = parseHeadersFile(readFileSync(resolve(root, "apps/web/public/_headers"), "utf8"));
for (const name of HEADER_NAMES) {
  assert.ok(canonical[name], `_headers must declare ${name}`);
}

const netlify = readFileSync(resolve(root, "netlify.toml"), "utf8");
for (const name of HEADER_NAMES) {
  const match = netlify.match(new RegExp(`^\\s*${name} = "(.+)"$`, "mu"));
  assert.ok(match, `netlify.toml must declare ${name}`);
  assert.equal(match[1], canonical[name], `netlify.toml ${name} drifted from _headers`);
}

const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
const vercelHeaders = Object.fromEntries(
  (vercel.headers?.[0]?.headers ?? []).map((entry) => [entry.key, entry.value])
);
for (const name of HEADER_NAMES) {
  assert.equal(vercelHeaders[name], canonical[name], `vercel.json ${name} drifted from _headers`);
}

// The CSP meta must match exactly, minus frame-ancestors, which the meta
// delivery channel cannot express and browsers ignore there.
const indexHtml = readFileSync(resolve(root, "apps/web/index.html"), "utf8");
const metaMatch = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u);
assert.ok(metaMatch, "index.html must declare the CSP meta tag");
const metaExpectation = canonical["Content-Security-Policy"]
  .split("; ")
  .filter((directive) => !directive.startsWith("frame-ancestors"))
  .join("; ");
assert.equal(metaMatch[1], metaExpectation, "index.html CSP meta drifted from _headers");

// The Vite dev/preview server serves pre-substitution JSON-LD, so only its
// script-src hash may differ from the deployed policy.
const vite = readFileSync(resolve(root, "apps/web/vite.config.js"), "utf8");
for (const name of HEADER_NAMES.filter((header) => header !== "Content-Security-Policy")) {
  const match = vite.match(new RegExp(`"${name}": "(.+)"`, "u"));
  assert.ok(match, `vite.config.js must declare ${name}`);
  assert.equal(match[1], canonical[name], `vite.config.js ${name} drifted from _headers`);
}
const viteCsp = vite.match(/"Content-Security-Policy": "(.+)"/u);
assert.ok(viteCsp, "vite.config.js must declare the Content-Security-Policy header");
const withPinnedHashes = (value) => value.replace(/'sha256-[A-Za-z0-9+/=]+'/gu, "'sha256-<pinned>'");
assert.equal(
  withPinnedHashes(viteCsp[1]),
  withPinnedHashes(canonical["Content-Security-Policy"]),
  "vite.config.js CSP drifted from _headers beyond the dev JSON-LD hash"
);

process.stdout.write("Validated 5 security-header declarations against apps/web/public/_headers.\n");
