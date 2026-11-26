// Generated from the exact openclaw@2026.11.10 npm artifact. Do not edit by hand.
// Regenerate with: npm run protocol:generate

export const OPENCLAW_GATEWAY_CONTRACT = Object.freeze({
  schemaVersion: 1,
  artifact: Object.freeze({
    package: "openclaw",
    version: "2026.11.10",
    integrity: "sha512-/FKDjxY1ZdUSXHx1a9b4EUpPRZywM3uv4181g22XImJfp/5+h+fFUZ7B7HthNrdYzq//05zH0Yf7mefzIlWFaQ==",
    shasum: "de2d2f67c1bd1256b81d373bbd0af433cf9191f6"
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
  pairing: Object.freeze({
    scope: "operator.pairing",
    methods: Object.freeze([
      "device.pair.list",
      "device.pair.approve",
      "device.pair.reject",
      "device.pair.remove",
      "device.token.rotate",
      "device.token.revoke"
    ])
  }),
  limits: Object.freeze({
    preauthPayloadBytes: 64 * 1024,
    authenticatedPayloadBytes: 4 * 1024 * 1024,
    handshakeTimeoutMs: 15_000,
    requestTimeoutMs: 30_000,
    maxPendingRequests: 64
  }),
  sources: Object.freeze({
    "dist/gateway/protocol/index.js": "sha256-346ea35ef1397e6c805a88fae761ea989ed9d7f3c772a5ee3ce71996c781ce32",
    "dist/src-4ukgpRDU.mjs": "sha256-e89a1919cf823bb6ef9251ab78f6bd5dc259ce20cee1ee5fefc2d66185df90ff",
    "dist/logs-chat-CUeTJ2fB.mjs": "sha256-b4cb1cc032280ba0002cc516e7a2738ea7b97ae98e348799523061aef2c3fd7e",
    "dist/primitives-CYTMtVCE.mjs": "sha256-75e8b00222ca2be7f6e23290530bc8da80b816190c3dec6a49a3388d0f131ec8",
    "dist/client-info-Dr3-kuD1.mjs": "sha256-8c09e105039b95c3d2ac08abd4c70748e7d930d512f0b18dafeb2e744ec93d73",
    "dist/version-CNIg0CD7.mjs": "sha256-6772779c020b3e98ca2280627b5eae1b08966246e127e9c9bded6062bee5df4d",
    "dist/device-auth-DG7mDK4P.mjs": "sha256-18e977264d7f640aea6a54c61a1f2fe3c84a2af9da6693f1e0af6773a775816e"
  })
});
