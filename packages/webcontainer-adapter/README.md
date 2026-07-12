# Archived WebContainer evidence fixtures

This directory is historical evidence from the pre-BrowserPod prototype. It is
not imported by the application, included in the production dependency graph,
or run by the normal CI/release gate. Maintainers may run
`npm run test:archive:webcontainer` when auditing the old evidence.

These files are mounted into the browser probe without modifying the upstream
OpenClaw package in the archived reproduction only. The bootstrap installs
compatibility behavior before loading the official `openclaw.mjs` entrypoint.

`node-sqlite-polyfill.mjs` is an initial, deliberately narrow experiment backed
by `sql.js`. It implements the synchronous API surface currently exercised by
OpenClaw's Kysely state store. Tests cover integer/BigInt behavior, transaction
rollback and commit, and close/reopen persistence. It is not yet a production
persistence layer: the versioned, SHA-256-verified mock-state OPFS snapshot and
runtime-restart path pass, but concurrent writers, real workspace scale,
encrypted secrets, and complete error semantics remain unverified.

`mock-openai-server.mjs` is a deterministic local OpenAI-compatible streaming
endpoint used only by the browser probe. It proves that the real OpenClaw agent
runner can traverse `chat.send`, provider transport, SSE parsing, and the final
Gateway `chat` event without sending credentials or content to an external
service. Its first response requests the only allowed tool, `agents_list`; its
second response is emitted only after the real tool result appears in the
follow-up provider request.

`gateway-lifecycle-probe.mjs` is the matching protocol client fixture. It checks
the initial authenticated `hello-ok`, a final streamed turn, `chat.history`, a
fresh WebSocket reconnect with history recovery, and `chat.abort` plus the
matching `aborted` event.

The bootstrap also installs a narrow `fs.readSync` adapter for WebContainer.
Node accepts a `bigint` file position, which OpenClaw uses when appending JSONL
session records, while the current WebContainer builtin mixes that value with
numbers internally. Positions are converted only when they fit safely in a
JavaScript integer; larger offsets fail explicitly.
