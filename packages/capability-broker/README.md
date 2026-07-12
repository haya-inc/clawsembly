# Browser capability broker

This package is the runtime-independent trust boundary between an untrusted
OpenClaw guest and browser-host authority.

Implemented guarantees:

- broker sessions bind to exact `openclaw` version and SHA-512 integrity;
- authority is denied unless capability and scope match exactly;
- grants support call limits, expiry, explicit revocation, and cancellation;
- call limits are consumed before asynchronous dispatch;
- handler failures expose no provider or secret-bearing exception message;
- bounded audit records include metadata only, never inputs or results.

The broker does not make a handler safe automatically. Each handler still owns
input validation, output validation, destination policy, secret injection, and
user permission UX for its capability. Existing credential, provider,
identity, and persistence modules are the first host-handler implementations.

See [the embedding contract](../../docs/embedding.md) and
[ADR 0003](../../docs/decisions/0003-verified-openclaw-embedding.md).
