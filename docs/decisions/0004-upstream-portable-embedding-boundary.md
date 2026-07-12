# ADR 0004: Upstream-portable embedding boundary

- Status: accepted
- Date: 2026-07-12

## Context

A 2026-07-12 external review of the launched project found:

- **Zero external traction at launch.** The repository has no stars, the
  project page has no recorded views, and there is a single maintainer. The
  positioning must therefore assume no distribution advantage today.
- **The release-tracking and evidence pipeline is replicable.** The OpenClaw
  Foundation is OpenAI-backed; it, or any well-capitalized competitor, could
  reproduce artifact inspection, release tracking, and compatibility reporting
  quickly. A pipeline-specialist identity would be commoditized and cannot be
  the moat.
- **The browser-native competitor field is weak but distribution-bottlenecked.**
  Nearby projects (ADR 0003) have not converted their surfaces into adopted
  embedding layers, which leaves room, but reaching embedders is the shared
  unsolved problem.
- **BrowserPod is proprietary and metered.** Every downstream deployment needs
  its own API key, the free tier is non-commercial, and an OSS grant program is
  available. The commercial dependency identified in ADR 0002 remains.

ADR 0003 made verified OpenClaw embedding the product. The review shows that
the durable part of that product is not the OpenClaw-specific pipeline but the
host boundary the repository already implements: the default-deny capability
broker, the evidence-bound embed manifest, the permission-prompt surface, and
payload-free audit. None of those components depend on OpenClaw specifics; the
generated Gateway client, adapters, and report pipeline do.

## Decision

Clawsembly is an evidence-gated embedding layer that runs upstream coding
agents browser-locally, behind a host boundary the embedding application
controls. OpenClaw is the first supported upstream.

1. **The evidence pipeline is not the defensible value.** Release tracking and
   compatibility reporting are retained, but they are supporting trust
   infrastructure, not the product. The evidence-gate machinery is generic; the
   OpenClaw reports are one instance of it.
2. **The durable value is the boundary plus browser-local execution.**
   Specifically: (a) browser-local execution of upstream agents on BrowserPod
   (ADR 0002's invariant), and (b) an embedder-controlled, easily adjustable
   host boundary — the default-deny capability broker, the evidence-bound embed
   manifest, the permission-prompt UI, and payload-free audit. This boundary is
   upstream-portable by design.
3. **BrowserPod remains the committed runtime.** Mitigations: apply to the
   BrowserPod OSS grant program; disclose plainly that every downstream
   deployment needs its own metered BrowserPod API key and that the free tier
   is non-commercial; maintain the vendor relationship. The ADR 0002 acceptance
   gates and exit-path requirement are unchanged.
4. **OpenClaw is repositioned from project identity to first bound upstream.**
   Deep OpenClaw support continues, but architecture and messaging must avoid a
   pure-OpenClaw-only identity.

The codebase will progressively separate an upstream-agnostic embedding core —
capability broker, embed manifest, evidence-gate loader, permission UI, and
capability mailbox — from the OpenClaw binding — the generated Gateway client,
adapters, and report pipeline. The next concrete artifact is a documented
upstream-binding contract describing what any binding must supply: exact
artifact identity, boot recipe, protocol client, capability requirements, and
evidence gates.

Honesty constraints on all resulting claims: today only OpenClaw is bound; no
owner-authorized runtime evidence exists yet and all published reports are
status probing; multi-upstream is a design commitment whose next concrete step
is the documented upstream-binding contract, not a shipped capability. No
surface may state or imply that other agents already run.

## Consequences

- README, strategy, and product documentation change to the new framing; the
  OpenClaw pipeline is described as the first instance of a generic evidence
  gate rather than as the product.
- The roadmap gains a binding-contract milestone (the documented
  upstream-binding contract) and an embedder-DX milestone (making the boundary
  easy for a host application to adopt and adjust).
- Accepted risks: the claw-family project name now under-describes the scope
  (a fallback name is to be reserved by the owner); BrowserPod's commercial
  terms remain a per-deployment cost and disclosure burden; no second binding
  exists today, so upstream portability is a stated design property, not a
  demonstrated one.

## Alternatives considered

1. **Pivot to OpenClaw-evidence-pipeline specialist.** Rejected: the pipeline
   is straightforwardly replicable by a well-capitalized upstream or by
   competitors, so a pipeline identity would be commoditized quickly.
2. **Keep the pure OpenClaw-embedding identity.** Rejected: it couples the
   project lifetime to a single upstream that could ship an official browser
   story at any time.

## Related decisions

- ADR 0002 keeps execution browser-local and defines the runtime acceptance
  gates that still govern BrowserPod.
- ADR 0003 selected BrowserPod and built the boundary components this ADR
  promotes to the upstream-agnostic core.
