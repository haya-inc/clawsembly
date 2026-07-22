# Remote Gateway cockpit — "connect your OpenClaw"

The static demo of ADR 0006 wrap deliverable 2
([ADR 0006](../../docs/decisions/0006-openclaw-specialist-refocus.md),
decision 1.ii): this page opens the packed SDK's
`@haya-inc/clawsembly/remote-gateway` surface against an OpenClaw Gateway
**you** already operate — the generated, version-locked protocol client
with a persistent browser device identity, the encrypted device-token
vault, a pairing-requirement surface, one bounded chat session, and the
payload-free audit trail.

Honesty boundary: remote mode is interoperability. Nothing runs
browser-locally, no evidence class is produced, and a remote connection
can never satisfy the browser-local acceptance gates (ADR 0002) or stand
in for BrowserPod runtime evidence.

## Run the cockpit

```bash
npm run cockpit:dev
```

Then open the printed `http://127.0.0.1:5178` page.

## Connect your Gateway

1. **Start your Gateway** on a reachable endpoint. The client is
   version-locked to the generated contract's exact artifact
   (`openclaw@2026.7.1-2` today): a Gateway running any other version is
   refused with `server_version_mismatch` — that is the evidence-gated
   design, not a bug.
2. **Allow this page's origin.** The stable Gateway admits webchat
   connects only from origins in its Control-UI allowlist; its own connect
   error names the `gateway.controlUi.allowedOrigins` setting. Add the
   cockpit's exact origin (shown on the page, e.g.
   `http://127.0.0.1:5178`) to that allowlist in your Gateway
   configuration and restart it.
3. **Endpoint rules.** `https://` and `wss://` endpoints are always
   admissible; cleartext `http://`/`ws://` endpoints resolve only for the
   loopback host (`127.0.0.1`, `[::1]`, `localhost`). Credentials inside
   the URL are rejected.
4. **Token handling.** The Gateway token you paste stays in memory for the
   session and is dropped after the handshake. What persists — in
   IndexedDB, on this browser only — is the Ed25519 device identity and
   the Gateway-issued device token, encrypted under a non-extractable
   AES-GCM key. Reconnects authenticate with the vaulted device token
   (`authenticated with: device-token`), and "Clear stored device token"
   removes the local copy.
5. **Pairing.** If your Gateway holds the device for review instead of
   trusting the shared token, the cockpit shows the pending request's
   identifiers and reason; approve it on the Gateway (its own UI or CLI),
   then reconnect. A loopback shared-token connect on the stable Gateway
   is trusted without a pairing prompt.

## What the cockpit deliberately cannot do

The client's RPC surface is the generated contract's chat methods —
`chat.send`, `chat.history`, `chat.abort` — plus the connect handshake.
There is no generic Gateway RPC console here: configuration, plugins,
sessions, devices, and every other advertised method stay out of reach of
the embedding surface by construction.
