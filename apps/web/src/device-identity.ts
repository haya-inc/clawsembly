const DATABASE_NAME = "clawsembly-device-identity";
const DATABASE_VERSION = 1;
const IDENTITY_STORE = "identity";
const PRIMARY_IDENTITY = "primary";
let identityPromise: Promise<BrowserDeviceIdentity> | undefined;

interface StoredDeviceIdentityV1 {
  version: 1;
  deviceId: string;
  publicKeyRaw: ArrayBuffer;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  createdAt: string;
}

export interface BrowserDeviceIdentity {
  deviceId: string;
  publicKeyRawBase64Url: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  createdAt: string;
}

export interface DeviceAuthPayloadV3 {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}

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

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("device identity request failed")), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("device identity transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("device identity transaction failed")), { once: true });
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable for device identity");
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(IDENTITY_STORE)) request.result.createObjectStore(IDENTITY_STORE);
  });
  return requestResult(request);
}

async function readStoredIdentity(): Promise<StoredDeviceIdentityV1 | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(IDENTITY_STORE, "readonly");
    const complete = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(IDENTITY_STORE).get(PRIMARY_IDENTITY)) as StoredDeviceIdentityV1 | undefined;
    await complete;
    return value;
  } finally {
    database.close();
  }
}

async function addStoredIdentity(value: StoredDeviceIdentityV1): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(IDENTITY_STORE, "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore(IDENTITY_STORE).add(value, PRIMARY_IDENTITY);
    await complete;
  } finally {
    database.close();
  }
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveDeviceId(publicKeyRaw: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeyRaw)));
}

function normalizeDeviceMetadata(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

export function buildDeviceAuthPayloadV3(params: DeviceAuthPayloadV3): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeDeviceMetadata(params.platform),
    normalizeDeviceMetadata(params.deviceFamily)
  ].join("|");
}

export function buildDeviceAuthPayloadV2(params: DeviceAuthPayloadV3): string {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce
  ].join("|");
}

async function validateStoredIdentity(record: StoredDeviceIdentityV1 | undefined): Promise<BrowserDeviceIdentity | undefined> {
  if (!record) return undefined;
  if (record.version !== 1 || !/^[a-f0-9]{64}$/.test(record.deviceId)
    || !(record.publicKeyRaw instanceof ArrayBuffer) || record.publicKeyRaw.byteLength !== 32
    || !(record.publicKey instanceof CryptoKey) || record.publicKey.type !== "public" || record.publicKey.algorithm.name !== "Ed25519"
    || !(record.privateKey instanceof CryptoKey) || record.privateKey.type !== "private" || record.privateKey.algorithm.name !== "Ed25519"
    || record.privateKey.extractable || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new Error("stored browser device identity is invalid");
  }
  const publicKeyRaw = new Uint8Array(record.publicKeyRaw);
  if (await deriveDeviceId(publicKeyRaw) !== record.deviceId) throw new Error("stored browser device id does not match its public key");
  const challenge = new TextEncoder().encode("openclaw-device-identity-self-check");
  const signature = await crypto.subtle.sign("Ed25519", record.privateKey, challenge);
  if (!await crypto.subtle.verify("Ed25519", record.publicKey, signature, challenge)) {
    throw new Error("stored browser device key pair does not match");
  }
  return {
    deviceId: record.deviceId,
    publicKeyRawBase64Url: base64UrlEncode(publicKeyRaw),
    publicKey: record.publicKey,
    privateKey: record.privateKey,
    createdAt: record.createdAt
  };
}

async function loadOrCreateIdentity(): Promise<BrowserDeviceIdentity> {
  const stored = await validateStoredIdentity(await readStoredIdentity());
  if (stored) return stored;

  const keyPair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  if (publicKeyRaw.byteLength !== 32) throw new Error("browser returned an invalid Ed25519 public key");
  const record: StoredDeviceIdentityV1 = {
    version: 1,
    deviceId: await deriveDeviceId(publicKeyRaw),
    publicKeyRaw: publicKeyRaw.buffer,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    createdAt: new Date().toISOString()
  };
  try {
    await addStoredIdentity(record);
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== "ConstraintError") throw error;
  }
  const restored = await validateStoredIdentity(await readStoredIdentity());
  if (!restored) throw new Error("browser device identity was not retained by IndexedDB");
  return restored;
}

export async function getBrowserDeviceIdentity(): Promise<BrowserDeviceIdentity> {
  identityPromise ??= loadOrCreateIdentity();
  try {
    return await identityPromise;
  } catch (error: unknown) {
    identityPromise = undefined;
    throw error;
  }
}

export async function createDeviceConnectParams(
  params: Omit<DeviceAuthPayloadV3, "deviceId">,
  payloadVersion: "v2" | "v3" = "v3"
): Promise<{
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}> {
  const identity = await getBrowserDeviceIdentity();
  const payloadParams = { ...params, deviceId: identity.deviceId };
  const payload = payloadVersion === "v3" ? buildDeviceAuthPayloadV3(payloadParams) : buildDeviceAuthPayloadV2(payloadParams);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", identity.privateKey, new TextEncoder().encode(payload)));
  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyRawBase64Url,
    signature: base64UrlEncode(signature),
    signedAt: params.signedAtMs,
    nonce: params.nonce
  };
}

export async function runDeviceIdentityProbe(): Promise<DeviceIdentityProbe> {
  const identity = await getBrowserDeviceIdentity();
  const reloaded = await validateStoredIdentity(await readStoredIdentity());
  if (!reloaded || reloaded.deviceId !== identity.deviceId) throw new Error("browser device identity reload failed");
  let privateKeyExportRejected = false;
  try {
    await crypto.subtle.exportKey("pkcs8", identity.privateKey);
  } catch {
    privateKeyExportRejected = true;
  }

  const params: Omit<DeviceAuthPayloadV3, "deviceId"> = {
    clientId: "gateway-client",
    clientMode: "backend",
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    signedAtMs: 1_783_795_200_000,
    token: "probe-token",
    nonce: "clawsembly-nonce",
    platform: "Browser",
    deviceFamily: "Clawsembly"
  };
  const payload = buildDeviceAuthPayloadV3({ ...params, deviceId: identity.deviceId });
  const signature = await crypto.subtle.sign("Ed25519", identity.privateKey, new TextEncoder().encode(payload));
  const signatureVerified = await crypto.subtle.verify("Ed25519", identity.publicKey, signature, new TextEncoder().encode(payload));
  const wrongNoncePayload = buildDeviceAuthPayloadV3({ ...params, deviceId: identity.deviceId, nonce: "wrong-nonce" });
  const nonceMismatchRejected = !await crypto.subtle.verify(
    "Ed25519",
    identity.publicKey,
    signature,
    new TextEncoder().encode(wrongNoncePayload)
  );
  const upstreamV3Payload = payload.startsWith(`v3|${identity.deviceId}|gateway-client|backend|operator|operator.read,operator.write|`)
    && payload.endsWith("|probe-token|clawsembly-nonce|browser|clawsembly");
  if (identity.privateKey.extractable || !privateKeyExportRejected || !signatureVerified || !nonceMismatchRejected || !upstreamV3Payload) {
    throw new Error("browser device identity self-test failed");
  }
  return {
    algorithm: "Ed25519",
    deviceId: identity.deviceId,
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
