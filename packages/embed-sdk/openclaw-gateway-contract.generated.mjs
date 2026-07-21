// Generated from the exact openclaw@2026.7.1-2 npm artifact. Do not edit by hand.
// Regenerate with: npm run protocol:generate

export const OPENCLAW_GATEWAY_CONTRACT = Object.freeze({
  schemaVersion: 1,
  artifact: Object.freeze({
    package: "openclaw",
    version: "2026.7.1-2",
    integrity: "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==",
    shasum: "4583b987ea7277230ce1c7b2b8535d3e219f57ac"
  }),
  protocol: Object.freeze({ min: 4, max: 4 }),
  profile: Object.freeze({
    clientId: "webchat-ui",
    clientMode: "webchat",
    clientVersion: "clawsembly-embed-v1",
    platform: "browser",
    deviceFamily: "clawsembly",
    role: "operator",
    scopes: Object.freeze(["operator.read", "operator.write"]),
    caps: Object.freeze([])
  }),
  rpc: Object.freeze({
    methods: Object.freeze(["chat.send", "chat.history", "chat.abort"]),
    event: "chat"
  }),
  limits: Object.freeze({
    preauthPayloadBytes: 64 * 1024,
    authenticatedPayloadBytes: 4 * 1024 * 1024,
    handshakeTimeoutMs: 15_000,
    requestTimeoutMs: 30_000,
    maxPendingRequests: 64
  }),
  sources: Object.freeze({
    "dist/gateway/protocol/index.d.ts": "sha256-266102afa078cbc36fb3d7bab8c3f470fef40c6c0ea8e8a62f1620d4ab46096e",
    "dist/schema-DtyqV_v0.d.ts": "sha256-dc92d0aaf10a12d78bf66c22bd694fa24eced5a8b3d01c81265c32357f5b5120",
    "dist/index-D5wkwzkn.d.ts": "sha256-37d4bf51cb3b80460a311e955d1b8807be8066aee09eef0f818109170ab4f324",
    "dist/gateway/protocol/index.js": "sha256-6a75026740ea62c4696994ac95ad1e77a7cdd4fa75df79d23294ed242455a928",
    "dist/version-CwNT1gaY.js": "sha256-fb5bf01f88b38b22bb05bb91538fed58db58038359e43017b68e4c989c971f76",
    "dist/message-handler-CzwI6JjW.js": "sha256-ce8653d5e612bb6b3ec28eb57b9762303de4ca3eeee8b41397d76e77604ef121"
  })
});
