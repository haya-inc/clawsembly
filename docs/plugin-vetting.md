# Plugin-vetting exploration

First slice of the ADR 0006 extension-vetting exploration
([decision 1.iv](decisions/0006-openclaw-specialist-refocus.md)), recorded
2026-07-22 while upstream's skills-to-plugins migration is in flight. The
question: does the repository's no-execution dependency scanner
(`packages/compatibility/src/dependency-risk.mjs`) produce useful vetting
signals when pointed at the real OpenClaw plugin ecosystem — and what would
a vetting product need beyond it?

## The ecosystem is real

A 2026-07-22 npm registry survey found an active plugin ecosystem around
the stable artifact: roughly twenty first-party `@openclaw/*` plugins
(channels, model providers, web-search integrations) plus genuinely
third-party publishers, including `@tencent-weixin/openclaw-weixin`,
`@larksuite/openclaw-lark`, `@ollama/openclaw-web-search`, and
`@paperclipai/adapter-openclaw-gateway`. Upstream also ships its own
offline checker, `@openclaw/plugin-inspector`. Third-party code that
operators install next to their Gateway exists today; extension vetting is
not premature.

## Method

Seven packages were scanned with the existing scanner — exact versions
pinned by registry integrity, tarballs identity-checked before reading,
sources never executed. The scanner reports lifecycle scripts, native and
Wasm artifacts, Node builtin usage, network APIs, and derived capability
labels under a bounded budget (2,048 source files / 16 MiB).

| Package | Version | Notable signals |
| --- | --- | --- |
| `@tencent-weixin/openclaw-weixin` | 2.4.6 | `fs`, `crypto`, `fetch`, `process.env` — filesystem plus network in a channel bridge |
| `@larksuite/openclaw-lark` | 2026.7.16 | adds `dns/promises`, `net`, `async_hooks` — raw socket reach |
| `@ollama/openclaw-web-search` | 0.2.2 | 4 files, **zero scannable sources** (coverage gap, see below) |
| `@paperclipai/adapter-openclaw-gateway` | 2026.720.0 | `WebSocket`/`ws` client, `crypto`, env — narrow surface |
| `@openclaw/discord` | 2026.7.1 | `child_process`, `sqlite`, `tls`, `worker_threads`, `wasi`, `WebAssembly` — and the scan **truncated** at the budget |
| `@openclaw/brave-plugin` | 2026.7.1 | no builtins, no network — pure configuration shim |
| `@openclaw/plugin-inspector` | 0.3.18 | `child_process`, `readline`, `fetch` — a CLI, as expected |

Exact pinned identities for the scanned set live in the table's versions
plus the registry integrity values recorded in the session that produced
this document; re-running the scan re-verifies them (`inspectDependencyRisk`
fails closed on any identity drift).

## Findings

1. **No install-time execution anywhere.** None of the seven packages
   declares `preinstall`/`install`/`postinstall` scripts. The classic npm
   supply-chain vector is absent from this sample — runtime capability is
   where the risk concentrates.
2. **Capability spread is wide and legible.** The scanner cleanly
   separates a configuration shim (no capabilities) from a channel bridge
   (`filesystem` + `network` + `environment`) from a kitchen-sink plugin
   (`subprocess` + `database` + `native-code` + `workers`). That gradient
   is exactly the raw material a vetting verdict needs.
3. **Big first-party plugins overflow the budget.** `@openclaw/discord`
   ships 41 MB unpacked and 1,262 source files; the bounded scan truncated.
   A vetting product needs per-plugin budgets (or a tiered deep-scan) and
   must report truncation as its own finding, never as a pass.
4. **Some plugins are invisible to the current source patterns.**
   `@ollama/openclaw-web-search` packs four files with no `.js`-family
   sources the scanner reads, so it produced an empty signal set. A verdict
   over an empty scan would be dishonest; "unscannable with current
   patterns" must stay a distinct fail-closed outcome.
5. **Third-party channel plugins are the vetting sweet spot.** They are
   published by parties other than upstream, run beside the operator's
   Gateway with real credentials, and legitimately need network — which is
   precisely why their filesystem and raw-socket reach deserves a
   per-capability verdict rather than a binary trust decision.

## What a vetting product would add

The scanner supplies signals, not verdicts. The next slice, if pursued,
would need: a pinned plugin registry (name, exact version, integrity) with
re-scan-on-drift; per-capability policy verdicts in the spirit of the
promotion policy (fail-closed, reasons enumerated); truncation and
unscannable-source outcomes as first-class results; and a comparison
surface against upstream's own `@openclaw/plugin-inspector` so the two
checkers can disagree visibly. No commitment to build this is made here —
ADR 0006 scopes deliverable 4 as an exploration, and this document is its
recorded result.
