# Capability permission lifecycle

Verified embed manifests declare capability requests, not ambient grants.
`bootVerifiedEmbed` creates the broker with no active authority and exposes a
`CapabilityConsentController` as `session.permissions`.

## States

Each exact `(capability, scope)` request moves through one of five states:

```text
pending ── approve ──> granted ── revoke ──> revoked
   │                     │
   └──── deny ────────> denied
                         │
granted ── deadline ──> expired
```

Approval is bounded twice:

- `maxCalls` cannot exceed the manifest request;
- duration must be between one second and 24 hours, with 15 minutes as the
  default.

Unknown capability/scope pairs fail before reaching the broker. Deny, revoke,
and expiry contain fixed reason codes rather than free-form user text.

## Host integration

```js
const session = await bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey,
  capabilityHandlers
});

renderPermissionPrompt(session.permissions.manifest());

// Call only after the user approves this exact row.
session.permissions.approve(
  "storage.snapshot",
  "workspace:primary",
  { durationMs: 5 * 60_000, maxCalls: 1 }
);

const serving = session.mailbox.serve({ signal: shutdown.signal });

// User-visible revoke action.
session.permissions.revoke("storage.snapshot", "workspace:primary");
```

Before approval, a matching guest mailbox request receives `not_granted`. The
controller is the host integration surface; the untrusted guest never receives
the controller or broker grant method.

## Export formats

`session.permissions.manifest()` returns current requested and decided state.
`session.permissions.exportAudit()` combines bounded permission-decision events
with the broker's bounded request audit.

The stable schemas are:

- `packages/capability-broker/capability-manifest.schema.json`;
- `packages/capability-broker/capability-audit.schema.json`.

Exports include exact artifact/runtime/session identity, capability, scope,
timestamps, limits, status, outcomes, and fixed reason codes. They never accept
or serialize request payloads, handler results, credentials, exception bodies,
or free-form denial notes.

## Trust boundary

The application shell is trusted to show an honest prompt and invoke the
controller only after user action. A malicious same-origin host script already
owns browser authority and is outside the guest-sandbox threat boundary.
Content Security Policy, dependency review, and application integrity remain
necessary controls for that trusted zone.
