import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";

const DATABASE_NAME = "clawsembly-gateway-auth";
const DATABASE_VERSION = 1;
const KEY_STORE = "keys";
const TOKEN_STORE = "tokens";
const MASTER_KEY_ID = "gateway-device-token-master-v1";
const DEVICE_ID = /^[a-f0-9]{64}$/u;
const ROLE = /^[a-z][a-z0-9._-]{0,63}$/u;
const MAX_TOKEN_BYTES = 2_048;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Gateway token IndexedDB request failed")), { once: true });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Gateway token transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Gateway token transaction failed")), { once: true });
  });
}

export function createIndexedDbGatewayDeviceTokenPersistence({ indexedDB = globalThis.indexedDB } = {}) {
  async function openDatabase() {
    if (!indexedDB || typeof indexedDB.open !== "function") {
      throw new TypeError("IndexedDB is required for Gateway device-token persistence");
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) request.result.createObjectStore(KEY_STORE);
      if (!request.result.objectStoreNames.contains(TOKEN_STORE)) request.result.createObjectStore(TOKEN_STORE);
    });
    return requestResult(request);
  }
  async function read(storeName, key) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readonly");
      const complete = transactionComplete(transaction);
      const value = await requestResult(transaction.objectStore(storeName).get(key));
      await complete;
      return value;
    } finally {
      database.close();
    }
  }
  async function write(storeName, key, value, add = false) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      const complete = transactionComplete(transaction);
      if (add) transaction.objectStore(storeName).add(value, key);
      else transaction.objectStore(storeName).put(value, key);
      await complete;
    } finally {
      database.close();
    }
  }
  async function remove(storeName, key) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      const complete = transactionComplete(transaction);
      transaction.objectStore(storeName).delete(key);
      await complete;
    } finally {
      database.close();
    }
  }
  return Object.freeze({
    readKey: () => read(KEY_STORE, MASTER_KEY_ID),
    addKey: (key) => write(KEY_STORE, MASTER_KEY_ID, key, true),
    readToken: (id) => read(TOKEN_STORE, id),
    writeToken: (id, record) => write(TOKEN_STORE, id, record),
    deleteToken: (id) => remove(TOKEN_STORE, id)
  });
}

function assertPersistence(value) {
  for (const method of ["readKey", "addKey", "readToken", "writeToken", "deleteToken"]) {
    if (!value || typeof value[method] !== "function") {
      throw new TypeError("Gateway device-token persistence is invalid");
    }
  }
  return value;
}

function assertCrypto(value) {
  if (!value?.subtle || typeof value.subtle.generateKey !== "function"
    || typeof value.subtle.encrypt !== "function" || typeof value.subtle.decrypt !== "function"
    || typeof value.getRandomValues !== "function") {
    throw new TypeError("Web Crypto AES-GCM support is required for Gateway device tokens");
  }
  return value;
}

function assertArtifact(value) {
  const expected = OPENCLAW_GATEWAY_CONTRACT.artifact;
  if (!value || value.package !== expected.package || value.version !== expected.version
    || value.integrity !== expected.integrity) {
    throw new TypeError("Gateway token vault artifact does not match the generated contract");
  }
  return value;
}

function assertSubject(value) {
  if (!value || !DEVICE_ID.test(value.deviceId ?? "") || !ROLE.test(value.role ?? "")) {
    throw new TypeError("Gateway device-token subject is invalid");
  }
  return Object.freeze({ deviceId: value.deviceId, role: value.role });
}

function normalizeScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64
    || value.some((scope) => typeof scope !== "string" || scope.length < 1 || scope.length > 512
      || /[\0\r\n]/u.test(scope))) {
    throw new TypeError("Gateway device-token scopes are invalid");
  }
  const scopes = [...new Set(value)];
  if (scopes.length !== value.length) throw new TypeError("Gateway device-token scopes contain duplicates");
  return Object.freeze(scopes);
}

function tokenId(artifact, subject) {
  return `${artifact.version}:${subject.deviceId}:${subject.role}`;
}

function additionalData(artifact, subject, scopes) {
  return new TextEncoder().encode(JSON.stringify({
    schema: "clawsembly:gateway-device-token:v1",
    package: artifact.package,
    version: artifact.version,
    integrity: artifact.integrity,
    deviceId: subject.deviceId,
    role: subject.role,
    scopes
  }));
}

function cloneBuffer(value) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function isAesKey(value) {
  return value && typeof value === "object" && value.type === "secret" && value.extractable === false
    && value.algorithm?.name === "AES-GCM" && Array.isArray(value.usages)
    && value.usages.includes("encrypt") && value.usages.includes("decrypt");
}

function assertRecord(value, artifact, subject) {
  if (value === undefined) return undefined;
  if (!value || value.version !== 1 || value.algorithm !== "AES-GCM"
    || value.package !== artifact.package || value.artifactVersion !== artifact.version
    || value.artifactIntegrity !== artifact.integrity || value.deviceId !== subject.deviceId
    || value.role !== subject.role || !(value.iv instanceof ArrayBuffer) || value.iv.byteLength !== 12
    || !(value.ciphertext instanceof ArrayBuffer) || value.ciphertext.byteLength <= 16
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("stored Gateway device-token record is invalid");
  }
  normalizeScopes(value.scopes);
  if (value.issuedAtMs !== undefined && (!Number.isSafeInteger(value.issuedAtMs) || value.issuedAtMs < 0)) {
    throw new Error("stored Gateway device-token issue time is invalid");
  }
  return value;
}

export function createGatewayDeviceTokenVault({
  artifact = OPENCLAW_GATEWAY_CONTRACT.artifact,
  crypto: cryptoApi = globalThis.crypto,
  persistence = createIndexedDbGatewayDeviceTokenPersistence(),
  now = Date.now
} = {}) {
  const verifiedArtifact = assertArtifact(artifact);
  const verifiedCrypto = assertCrypto(cryptoApi);
  const verifiedPersistence = assertPersistence(persistence);
  if (typeof now !== "function") throw new TypeError("Gateway device-token vault clock is invalid");
  let keyPromise;

  async function loadOrCreateKey() {
    const stored = await verifiedPersistence.readKey();
    if (stored !== undefined) {
      if (!isAesKey(stored)) throw new Error("stored Gateway device-token key violates vault policy");
      return stored;
    }
    const generated = await verifiedCrypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    try { await verifiedPersistence.addKey(generated); }
    catch (error) {
      if (error?.name !== "ConstraintError") throw error;
    }
    const restored = await verifiedPersistence.readKey();
    if (!isAesKey(restored)) throw new Error("Gateway device-token key was not retained securely");
    return restored;
  }

  async function key() {
    keyPromise ??= loadOrCreateKey();
    try { return await keyPromise; }
    catch (error) { keyPromise = undefined; throw error; }
  }

  async function loadRecord(subject) {
    return assertRecord(
      await verifiedPersistence.readToken(tokenId(verifiedArtifact, subject)),
      verifiedArtifact,
      subject
    );
  }

  async function load(untrustedSubject) {
    const subject = assertSubject(untrustedSubject);
    const record = await loadRecord(subject);
    if (!record) return undefined;
    let plaintext;
    try {
      plaintext = await verifiedCrypto.subtle.decrypt({
        name: "AES-GCM",
        iv: new Uint8Array(record.iv),
        additionalData: additionalData(verifiedArtifact, subject, record.scopes),
        tagLength: 128
      }, await key(), record.ciphertext);
    } catch {
      throw new Error("stored Gateway device token failed authenticated decryption");
    }
    const token = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    if (token.length < 1 || new TextEncoder().encode(token).byteLength > MAX_TOKEN_BYTES
      || /[\0\r\n]/u.test(token)) {
      throw new Error("decrypted Gateway device token is invalid");
    }
    return Object.freeze({
      token,
      scopes: Object.freeze([...record.scopes]),
      ...(record.issuedAtMs === undefined ? {} : { issuedAtMs: record.issuedAtMs })
    });
  }

  async function store(untrustedRecord) {
      const subject = assertSubject(untrustedRecord);
      const scopes = normalizeScopes(untrustedRecord.scopes);
      const plaintext = new TextEncoder().encode(untrustedRecord.token ?? "");
      if (typeof untrustedRecord.token !== "string" || plaintext.byteLength < 1
        || plaintext.byteLength > MAX_TOKEN_BYTES || /[\0\r\n]/u.test(untrustedRecord.token)) {
        throw new TypeError("Gateway device token is invalid");
      }
      if (untrustedRecord.issuedAtMs !== undefined && (!Number.isSafeInteger(untrustedRecord.issuedAtMs)
        || untrustedRecord.issuedAtMs < 0)) {
        throw new TypeError("Gateway device-token issue time is invalid");
      }
      const existing = await loadRecord(subject);
      const iv = verifiedCrypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await verifiedCrypto.subtle.encrypt({
        name: "AES-GCM",
        iv,
        additionalData: additionalData(verifiedArtifact, subject, scopes),
        tagLength: 128
      }, await key(), plaintext);
      const timestamp = new Date(now()).toISOString();
      if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError("Gateway device-token vault clock is invalid");
      const record = {
        version: 1,
        algorithm: "AES-GCM",
        package: verifiedArtifact.package,
        artifactVersion: verifiedArtifact.version,
        artifactIntegrity: verifiedArtifact.integrity,
        deviceId: subject.deviceId,
        role: subject.role,
        scopes: [...scopes],
        ...(untrustedRecord.issuedAtMs === undefined ? {} : { issuedAtMs: untrustedRecord.issuedAtMs }),
        iv: cloneBuffer(iv),
        ciphertext,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      await verifiedPersistence.writeToken(tokenId(verifiedArtifact, subject), record);
      const restored = await load(subject);
      if (!restored || restored.token !== untrustedRecord.token) {
        await verifiedPersistence.deleteToken(tokenId(verifiedArtifact, subject));
        throw new Error("Gateway device token failed encrypted persistence verification");
      }
      return Object.freeze({
        deviceId: subject.deviceId,
        role: subject.role,
        scopes: Object.freeze([...scopes]),
        ...(record.issuedAtMs === undefined ? {} : { issuedAtMs: record.issuedAtMs }),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        keyExtractable: false,
        algorithm: "AES-GCM-256"
      });
  }

  async function metadata(untrustedSubject) {
      const subject = assertSubject(untrustedSubject);
      const record = await loadRecord(subject);
      if (!record) return undefined;
      return Object.freeze({
        deviceId: subject.deviceId,
        role: subject.role,
        scopes: Object.freeze([...record.scopes]),
        ...(record.issuedAtMs === undefined ? {} : { issuedAtMs: record.issuedAtMs }),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        keyExtractable: false,
        algorithm: "AES-GCM-256"
      });
  }

  async function clear(untrustedSubject) {
      const subject = assertSubject(untrustedSubject);
      const existed = Boolean(await loadRecord(subject));
      await verifiedPersistence.deleteToken(tokenId(verifiedArtifact, subject));
      return existed;
  }

  return Object.freeze({
    schemaVersion: 1,
    load,
    store,
    metadata,
    clear
  });
}
