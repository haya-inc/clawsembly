// Generated from the exact openclaw@2026.6.11 npm artifact. Do not edit by hand.
// Regenerate with: npm run protocol:generate

export const OPENCLAW_GATEWAY_CONTRACT = Object.freeze({
  schemaVersion: 1,
  artifact: Object.freeze({
    package: "openclaw",
    version: "2026.6.11",
    integrity: "sha512-T+P/g19IheeT1ckXMoPN61dYuE8vBF4MderI+kWkvpuFYxPkJxn8AXLpu9IXCnN9g36Acpm9+mMD/V+lsvOkyA==",
    shasum: "ac29d16f0c684d46cef0009885f4e0b5877685af"
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
    "gateway-protocol/src/version.d.ts": "sha256-723dc785b6e2db39b9a658ee6d184f895ffd2e262de7729635463815f53075e8",
    "gateway-protocol/src/schema/frames.d.ts": "sha256-6eb639ae01170c7b818c623b2e18b4f668515d66de424e61cf8ff4b411b47793",
    "gateway-protocol/src/schema/primitives.d.ts": "sha256-85663b6625ebd41b218e3924e8aab54cbcc7950d03576f1699261ebd5077e877",
    "gateway-client/src/device-auth.d.ts": "sha256-2b2bf3fc1c4c6090cd19b340ecbaa19e1be24beb225292b3258ffd7286c8c788",
    "gateway-protocol/src/schema/logs-chat.d.ts": "sha256-9eac89a245bc8bc572fc692edefb872c3c16297fa38f64117592bd61448135db"
  })
});
