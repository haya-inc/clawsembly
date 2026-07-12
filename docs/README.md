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
| [BrowserPod evidence](browserpod-evidence.md) | Exact-artifact readiness capture, schema, and report attachment workflow |
| [Capability mailbox](capability-mailbox.md) | Typed file transport, cancellation, replay defense, and cooperative Gateway stop |
| [OSS strategy](oss-strategy.md) | Competitive position, distribution loop, and 90-day success gates |
| [Consuming reports](consuming-reports.md) | Badge, JSON endpoints, validation policy, and trust boundary |
| [Releasing](releasing.md) | Maintainer gates for publishing, Pages setup, and prerelease evidence |
| [Risk register](risk-register.md) | Technical, platform, legal, and adoption risks with decision gates |
| [Security model](security-model.md) | Trust boundaries, assets, threats, and release requirements |
| [Deployment](deployment.md) | Required isolation headers and supported static hosts |
| [ADR 0001](decisions/0001-compatibility-lab-first.md) | Why compatibility evidence ships before a broad product UI |
| [ADR 0002](decisions/0002-commercial-browser-runtime.md) | Commercial browser-local runtime decision and acceptance gates |
| [ADR 0003](decisions/0003-verified-openclaw-embedding.md) | BrowserPod selection and verified capability-safe embedding position |

## Current position

Clawsembly is the verified, capability-safe embedding layer around upstream
OpenClaw, not a new implementation of OpenClaw and not a generic BrowserPod
wrapper. Compatibility evidence, the host capability broker, and the embed
manifest are the durable product surfaces.
