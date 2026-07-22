# hello-agent reference binding

This package is the proof for the
[upstream binding contract](../../docs/upstream-binding-contract.md) and the
demonstration vehicle for the two growth paths of
[ADR 0005](../../docs/decisions/0005-reference-agent-growth-paths.md): a
second upstream binding that composes the unmodified core, whose only way to
do chat work is through the embedder-controlled capability boundary.

## What it is

- `fixture/` - the reference upstream: `clawsembly-hello-agent`, a
  dependency-free guest program serving a bounded file-mailbox protocol
  (`clawsembly-hello/2`) whose shape mirrors the OpenClaw embedding surface:
  `hello.say` plus `chat.send`, `chat.history`, and `chat.abort` with a
  streamed delta/done event shape. Every `chat.send` completion is delegated
  to the host capability `chat.complete` through the staged, digest-pinned
  mailbox client supplied by the boundary; the agent holds no provider access
  of its own. The fixture pins Node `>=22.12.0`, below the OpenClaw baseline,
  so the full verified chain stays capturable on the Node that BrowserPod
  provisions today.
- `hello-agent-artifact.generated.mjs` - the exact npm-shaped identity of that
  fixture: name, version, SHA-512 integrity of a byte-reproducible `npm pack`
  tarball, per-file SHA-256 digests, the pinned protocol descriptor hash, its
  method list, and its declared capability requirements. Regenerate with
  `npm run hello-agent:generate`; `npm run hello-agent:check` fails the build
  when the fixture drifts from the generated pin. Growing the agent is a
  version bump plus regenerated pins - the internal growth path.
- `hello-agent-binding.mjs` - the binding: a staging installer that verifies
  every file digest before anything executes, a boot recipe with two
  deterministic readiness signals (the ready log line and a parseable session
  record naming its capability transport) supervised by the generic
  cooperative-stop machinery, a bounded protocol client pinned to the
  artifact's descriptor with a validated chat event stream and in-flight
  abort, the non-empty `HELLO_AGENT_CAPABILITY_REQUIREMENTS` declaration
  derived from the artifact itself, a digest-bound evidence gate that demands
  both denied and allowed capability outcomes, and `bootHelloAgentEmbed`,
  which assembles the session from the same core parts as the OpenClaw
  binding: `assertVerifiedLaunch`, `createBrowserPodRuntime`,
  `CapabilityBroker`, `CapabilityConsentController`,
  `FilesystemCapabilityMailboxHost`, `stageGuestMailboxClient`, and
  `createEmbedSessionLifecycle`.

## What it proves

The tests boot the staged fixture as a real Node child process behind a local
provider double that implements the documented BrowserPod 2.x surface - no
metered runtime tokens are spent. They drive the verified-report loader, the
embed manifest, the fail-closed launch assertion, and the session lifecycle
end-to-end for a package that is not OpenClaw, and they exercise the external
extension path in both directions: chat fails closed with an actionable code
while the capability is unwired or ungranted, completes through an
embedder-supplied handler after explicit approval, cancels mid-turn across
the typed mailbox, fails closed again after revocation, and never leaks chat
payloads into any audit surface.

## Runtime evidence

One owner-authorized record of the full chain on the real provider is checked
in under [`evidence/`](evidence/hello-agent-0.2.0.json): the exact fixture
staged with verified per-file digests into `browserpod@2.12.1` in a real
browser, both readiness signals with a live capability mailbox, one `hello.say`
round trip, four capability-mediated chat turns across the default-deny
boundary (denied before approval, completed after approval, aborted in flight,
denied after revocation), and a completed guest-supervisor shutdown. The
digest-bound reference next to it recomputes from the evidence bytes and both
are validated by `hello-agent-evidence.test.mjs` in the normal test run.

Recapture (owner-authorized and metered; requires a local `BROWSERPOD_API_KEY`
and Playwright Chromium — GitHub-hosted runners are rejected by the provider):

```bash
npm install --prefix examples/hello-agent-evidence-host --ignore-scripts
node examples/hello-agent-evidence-host/capture.mjs
```

The capture host feeds the verified-launch assertion a self-served bootstrap
report pinned by its own SHA-256 — the same shape the provider-free test uses —
because the first real capture is what produces hello-agent evidence at all.
The captured record never inherits that report's status; it must pass the
digest-bound evidence gate on its own.

## Performance baseline

`hello-agent-perf.mjs` defines the performance-baseline schema for
[issue #8](https://github.com/haya-inc/clawsembly/issues/8) on this chain:
three pass kinds (`cold` — fresh browser context and workspace, `warm` —
reloaded page with hot caches and a fresh workspace, `persistentReuse` — the
same workspace storage key as a previous boot), six phase timings per sample
(embed boot, provider boot from the runtime boot audit, digest-verified
staging, readiness, first `hello.say` round trip, cooperative close), storage
estimates, and a digest-bound record. The schema is deliberately payload-free:
the only strings a sample can carry are the pattern-bounded pass kind and
workspace id. Aggregation reports the median next to every raw sample, and
`meetsSampleFloor` marks whether a pass reaches the three samples issue #8
requires for a publishable baseline.

Capture (owner-authorized and metered; each planned boot is printed with the
total cost before the first spend):

```bash
npm install --prefix examples/hello-agent-evidence-host --ignore-scripts
node examples/hello-agent-evidence-host/perf-capture.mjs --samples 3
```

One owner-authorized baseline is checked in under
[`evidence/`](evidence/hello-agent-perf-0.2.0.json) (2026-07-21,
`browserpod@2.12.1`, HeadlessChrome 149 on Windows 11, three samples per
pass, 10 metered boots including the persistence seed). Medians for
cold / warm / persistentReuse: provider boot 844 / 690 / 792 ms, staging
12 / 7 / 8 ms, readiness 5.1 / 5.4 / 3.7 s, first `hello.say` round trip
≈160 ms, cooperative close 123 / 109 / 62 ms — ≈6.2 s cold and ≈4.7 s with
persistent workspace reuse to the first protocol round trip, with ≈1.75 MB
of reported storage growth per fresh workspace. The digest-bound gate in
`hello-agent-perf.test.mjs` revalidates both files on every test run.

These are boundary-chain numbers on the reference binding, bound to the exact
fixture identity and provider version. They claim nothing about any real
upstream agent: OpenClaw npm-install and Gateway-start timings stay open until
the vendor gaps in issues
[#6](https://github.com/haya-inc/clawsembly/issues/6) and
[#47](https://github.com/haya-inc/clawsembly/issues/47) close, and workspace
persistence keys already isolate by artifact version, so a version or
integrity change never reuses another artifact's storage.

## What it deliberately is not

- Not a real agent, and not evidence that any second agent runs. OpenClaw
  remains the only bound real upstream, and reference-agent growth stays
  bounded to what demonstrating the boundary requires.
- Not published to any registry: the fixture is `private: true`, the generated
  descriptor records `registryPublished: false`, and its identity exists only
  in this repository.
- Not OpenClaw runtime support, and never surfaced through the published
  reports or Pages. The checked-in record proves the embedding boundary chain
  on the real provider for this reference fixture; every OpenClaw report stays
  `probing` on its own evidence.
