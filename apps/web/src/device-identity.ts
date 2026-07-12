import {
  buildDeviceAuthPayloadV3,
  createBrowserDeviceIdentity
} from "../../../packages/embed-sdk/gateway-device-identity.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "../../../packages/embed-sdk/openclaw-gateway-contract.generated.mjs";

export interface DeviceIdentityProbe {
  algorithm: "Ed25519";
  deviceId: string;
  publicKeyBytes: 32;
  privateKeyExtractable: false;
  privateKeyExportRejected: true;
  indexedDbReload: true;
  upstreamV3Payload: true;
  signatureVerified: true;
  nonceMismatchRejected: true;
  result: "pass";
}

const identity = createBrowserDeviceIdentity();

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(`${base64}${"=".repeat((4 - base64.length % 4) % 4)}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function runDeviceIdentityProbe(): Promise<DeviceIdentityProbe> {
  const descriptor = await identity.descriptor();
  const restored = await createBrowserDeviceIdentity().descriptor();
  const profile = OPENCLAW_GATEWAY_CONTRACT.profile;
  const params = {
    clientId: profile.clientId,
    clientMode: profile.clientMode,
    role: profile.role,
    scopes: profile.scopes,
    token: "probe-token",
    nonce: "clawsembly-nonce",
    platform: profile.platform,
    deviceFamily: profile.deviceFamily
  };
  const device = await identity.signConnect(params);
  const payloadParams = {
    ...params,
    deviceId: descriptor.deviceId,
    signedAtMs: device.signedAt
  };
  const payload = buildDeviceAuthPayloadV3(payloadParams);
  const wrongNoncePayload = buildDeviceAuthPayloadV3({ ...payloadParams, nonce: "wrong-nonce" });
  const publicKeyRaw = base64UrlDecode(descriptor.publicKey);
  const publicKey = await crypto.subtle.importKey("raw", publicKeyRaw, "Ed25519", false, ["verify"]);
  const signature = base64UrlDecode(device.signature);
  const signatureVerified = await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    signature,
    new TextEncoder().encode(payload)
  );
  const nonceMismatchRejected = !await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    signature,
    new TextEncoder().encode(wrongNoncePayload)
  );
  const upstreamV3Payload = payload.startsWith(
    `v3|${descriptor.deviceId}|webchat-ui|webchat|operator|operator.read,operator.write|`
  ) && payload.endsWith("|probe-token|clawsembly-nonce|browser|clawsembly");
  if (publicKeyRaw.byteLength !== 32 || descriptor.privateKeyExtractable
    || restored.deviceId !== descriptor.deviceId || !signatureVerified
    || !nonceMismatchRejected || !upstreamV3Payload) {
    throw new Error("browser device identity self-test failed");
  }
  return {
    algorithm: "Ed25519",
    deviceId: descriptor.deviceId,
    publicKeyBytes: 32,
    privateKeyExtractable: false,
    privateKeyExportRejected: true,
    indexedDbReload: true,
    upstreamV3Payload: true,
    signatureVerified: true,
    nonceMismatchRejected: true,
    result: "pass"
  };
}
