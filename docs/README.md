# Clawsembly documentation

These documents capture the initial direction of Clawsembly. Architectural
claims are separated from dated ecosystem observations so that the durable
design does not become stale when OpenClaw changes.

## Documents

| Document | Purpose |
| --- | --- |
| [Vision](vision.md) | Product goal, principles, scope, and success criteria |
| [Prior art](prior-art.md) | Existing browser and Wasm-based Claw projects |
| [Architecture](architecture.md) | Proposed components, runtime modes, and security boundaries |
| [Upstream compatibility](upstream-compatibility.md) | How Clawsembly will follow OpenClaw releases with low maintenance cost |
| [Roadmap](roadmap.md) | Milestones and acceptance criteria for the first implementation |
| [Product](product.md) | Initial user, adoption loop, public artifacts, and success metrics |
| [Verified embedding](embedding.md) | Artifact, evidence, capability, and BrowserPod launch contract |
| [Upstream binding contract](upstream-binding-contract.md) | What any bound upstream must supply: identity, boot recipe, protocol client, capabilities, evidence gates |
| [BrowserPod evidence](browserpod-evidence.md) | Exact-artifact readiness capture, schema, and report attachment workflow |
| [Capability mailbox](capability-mailbox.md) | Typed file transport, cancellation, replay defense, and cooperative Gateway stop |
| [Capability permissions](capability-permissions.md) | Pending requests, bounded approval, deny, revoke, expiry, and audit export |
| [OSS strategy](oss-strategy.md) | Competitive position, distribution loop, and 90-day success gates |
| [Consuming reports](consuming-reports.md) | Badge, JSON endpoints, validation policy, and trust boundary |
| [Releasing](releasing.md) | Maintainer gates for publishing, Pages setup, and prerelease evidence |
| [Risk register](risk-register.md) | Technical, platform, legal, and adoption risks with decision gates |
| [Security model](security-model.md) | Trust boundaries, assets, threats, and release requirements |
| [Deployment](deployment.md) | Required isolation headers and supported static hosts |
| [ADR 0001](decisions/0001-compatibility-lab-first.md) | Why compatibility evidence ships before a broad product UI |
| [ADR 0002](decisions/0002-commercial-browser-runtime.md) | Commercial browser-local runtime decision and acceptance gates |
| [ADR 0003](decisions/0003-verified-openclaw-embedding.md) | BrowserPod selection and verified capability-safe embedding position |
| [ADR 0004](decisions/0004-upstream-portable-embedding-boundary.md) | Upstream-portable embedding boundary; OpenClaw repositioned as the first bound upstream (amended by ADR 0006) |
| [ADR 0005](decisions/0005-reference-agent-growth-paths.md) | The reference agent demonstrates both growth paths: internal exact-identity growth and external capability extension |
| [ADR 0006](decisions/0006-openclaw-specialist-refocus.md) | OpenClaw-specialist refocus: wrap upstream OpenClaw with operator conveniences; other upstreams out of scope for this repository |

## Current position

Clawsembly is an evidence-gated embedding layer specialized in OpenClaw: it
runs the upstream package browser-locally, behind a host boundary the
embedding application controls, and wraps it with the conveniences its
operators and embedders need
([ADR 0006](decisions/0006-openclaw-specialist-refocus.md)). Clawsembly is
neither a new implementation of OpenClaw nor a generic BrowserPod wrapper.
The embedder-controlled host boundary — capability broker, embed manifest,
permission prompts, and payload-free audit — plus browser-local execution are
the durable product surfaces; the boundary stays upstream-portable as an
engineering property ([ADR 0004](decisions/0004-upstream-portable-embedding-boundary.md)),
and the compatibility-evidence pipeline is supporting trust infrastructure.
Today all published reports are status `probing`.
