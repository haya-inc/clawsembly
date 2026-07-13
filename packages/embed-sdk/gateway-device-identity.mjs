const DATABASE_NAME = "clawsembly-device-identity";
const DATABASE_VERSION = 1;
const IDENTITY_STORE = "identity";
const PRIMARY_IDENTITY = "primary";

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("device public key bytes are invalid");
}

function base64UrlEncode(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/gu, "");
}

function bytesToHex(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertCrypto(cryptoApi) {
  if (!cryptoApi?.subtle || typeof cryptoApi.subtle.generateKey !== "function"
    || typeof cryptoApi.subtle.sign !== "function" || typeof cryptoApi.subtle.verify !== "function") {
    throw new TypeError("Web Crypto with Ed25519 support is required");
  }
  return cryptoApi;
}

function assertStore(store) {
  if (!store || typeof store.read !== "function" || typeof store.add !== "function") {
    throw new TypeError("a device identity store is required");
  }
  return store;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("device identity request failed")), { once: true });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("device identity transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("device identity transaction failed")), { once: true });
  });
}

export function createIndexedDbDeviceIdentityStore({ indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB || typeof indexedDB.open !== "function") {
    throw new TypeError("IndexedDB is required for persistent device identity");
  }
  async function openDatabase() {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(IDENTITY_STORE)) {
        request.result.createObjectStore(IDENTITY_STORE);
      }
    });
    return requestResult(request);
  }
  return Object.freeze({
    async read() {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(IDENTITY_STORE, "readonly");
        const complete = transactionComplete(transaction);
        const value = await requestResult(transaction.objectStore(IDENTITY_STORE).get(PRIMARY_IDENTITY));
        await complete;
        return value;
      } finally {
        database.close();
      }
    },
    async add(record) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(IDENTITY_STORE, "readwrite");
        const complete = transactionComplete(transaction);
        transaction.objectStore(IDENTITY_STORE).add(record, PRIMARY_IDENTITY);
        try {
          await complete;
          return true;
        } catch (error) {
          if (error?.name === "ConstraintError") return false;
          throw error;
        }
      } finally {
        database.close();
      }
    }
  });
}

export function normalizeDeviceMetadataForAuth(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[A-Z]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

export function buildDeviceAuthPayloadV3(params) {
  if (!params || typeof params !== "object" || !Array.isArray(params.scopes)) {
    throw new TypeError("device auth payload parameters are invalid");
  }
  // "|" delimits this payload; a nonce or token containing it could move
  // attacker-chosen bytes across field boundaries of the signed string.
  if (typeof params.nonce !== "string" || params.nonce.length === 0 || /[|\0\r\n]/u.test(params.nonce)) {
    throw new TypeError("device auth nonce is invalid");
  }
  if (typeof params.token === "string" && /[|\0\r\n]/u.test(params.token)) {
    throw new TypeError("device auth token is invalid");
  }
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
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily)
  ].join("|");
}

async function deriveDeviceId(cryptoApi, publicKeyRaw) {
  return bytesToHex(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", publicKeyRaw)));
}

function isCryptoKey(value, type) {
  return value && typeof value === "object" && value.type === type
    && value.algorithm?.name === "Ed25519" && Array.isArray(value.usages);
}

async function validateRecord(cryptoApi, record) {
  if (record === undefined) return undefined;
  if (!record || record.version !== 1 || !/^[a-f0-9]{64}$/u.test(record.deviceId)
    || !isCryptoKey(record.publicKey, "public") || !isCryptoKey(record.privateKey, "private")
    || record.privateKey.extractable || !record.privateKey.usages.includes("sign")
    || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new Error("stored browser device identity is invalid");
  }
  const publicKeyRaw = bytes(record.publicKeyRaw);
  if (publicKeyRaw.byteLength !== 32 || await deriveDeviceId(cryptoApi, publicKeyRaw) !== record.deviceId) {
    throw new Error("stored browser device id does not match its public key");
  }
  const challenge = new TextEncoder().encode("clawsembly-device-identity-self-check");
  const signature = await cryptoApi.subtle.sign("Ed25519", record.privateKey, challenge);
  if (!await cryptoApi.subtle.verify("Ed25519", record.publicKey, signature, challenge)) {
    throw new Error("stored browser device key pair does not match");
  }
  return Object.freeze({
    deviceId: record.deviceId,
    publicKey: base64UrlEncode(publicKeyRaw),
    privateKey: record.privateKey,
    createdAt: record.createdAt
  });
}

export function createBrowserDeviceIdentity({
  crypto: cryptoApi = globalThis.crypto,
  store = createIndexedDbDeviceIdentityStore(),
  now = Date.now
} = {}) {
  const verifiedCrypto = assertCrypto(cryptoApi);
  const verifiedStore = assertStore(store);
  if (typeof now !== "function") throw new TypeError("device identity clock is invalid");
  let identityPromise;

  async function loadOrCreate() {
    const stored = await validateRecord(verifiedCrypto, await verifiedStore.read());
    if (stored) return stored;
    const keyPair = await verifiedCrypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
    const publicKeyRaw = new Uint8Array(await verifiedCrypto.subtle.exportKey("raw", keyPair.publicKey));
    if (publicKeyRaw.byteLength !== 32 || keyPair.privateKey.extractable) {
      throw new Error("browser returned an invalid Ed25519 key pair");
    }
    const record = {
      version: 1,
      deviceId: await deriveDeviceId(verifiedCrypto, publicKeyRaw),
      publicKeyRaw: publicKeyRaw.buffer,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      createdAt: new Date(now()).toISOString()
    };
    await verifiedStore.add(record);
    const restored = await validateRecord(verifiedCrypto, await verifiedStore.read());
    if (!restored) throw new Error("browser device identity was not retained");
    return restored;
  }

  async function identity() {
    identityPromise ??= loadOrCreate();
    try { return await identityPromise; }
    catch (error) { identityPromise = undefined; throw error; }
  }

  return Object.freeze({
    schemaVersion: 1,
    async descriptor() {
      const loaded = await identity();
      return Object.freeze({
        deviceId: loaded.deviceId,
        publicKey: loaded.publicKey,
        algorithm: "Ed25519",
        createdAt: loaded.createdAt,
        privateKeyExtractable: false
      });
    },
    async signConnect(params) {
      const loaded = await identity();
      const signedAt = now();
      const payload = buildDeviceAuthPayloadV3({
        ...params,
        deviceId: loaded.deviceId,
        signedAtMs: signedAt
      });
      const signature = new Uint8Array(await verifiedCrypto.subtle.sign(
        "Ed25519",
        loaded.privateKey,
        new TextEncoder().encode(payload)
      ));
      return Object.freeze({
        id: loaded.deviceId,
        publicKey: loaded.publicKey,
        signature: base64UrlEncode(signature),
        signedAt,
        nonce: params.nonce
      });
    }
  });
}
