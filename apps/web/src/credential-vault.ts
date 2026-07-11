const DATABASE_NAME = "clawsembly-host-broker";
const DATABASE_VERSION = 1;
const KEY_STORE = "keys";
const CREDENTIAL_STORE = "credentials";
const MASTER_KEY_ID = "credential-master-v1";
const MAX_SECRET_BYTES = 16 * 1024;
let masterKeyPromise: Promise<CryptoKey> | undefined;

export type CredentialProvider = "openai" | "openclaw-device" | "broker-probe";

interface StoredCredentialV1 {
  version: 1;
  provider: CredentialProvider;
  algorithm: "AES-GCM";
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialMetadata {
  provider: CredentialProvider;
  algorithm: "AES-GCM";
  createdAt: string;
  updatedAt: string;
}

export interface CredentialVaultProbe {
  algorithm: "AES-GCM-256";
  cryptoKeyStoredInIndexedDb: true;
  keyExtractable: false;
  keyExportRejected: true;
  plaintextAbsentFromCiphertext: true;
  roundTrip: true;
  aadMismatchRejected: true;
  result: "pass";
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed")), { once: true });
  });
}

async function openVault(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable in this browser");
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE);
    if (!database.objectStoreNames.contains(CREDENTIAL_STORE)) database.createObjectStore(CREDENTIAL_STORE, { keyPath: "provider" });
  });
  return requestResult(request);
}

async function readRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openVault();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const complete = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(storeName).get(key)) as T | undefined;
    await complete;
    return value;
  } finally {
    database.close();
  }
}

async function writeRecord(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const database = await openVault();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    if (key === undefined) store.put(value);
    else store.put(value, key);
    await complete;
  } finally {
    database.close();
  }
}

async function addRecord(storeName: string, value: unknown, key: IDBValidKey): Promise<void> {
  const database = await openVault();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore(storeName).add(value, key);
    await complete;
  } finally {
    database.close();
  }
}

async function deleteRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const database = await openVault();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore(storeName).delete(key);
    await complete;
  } finally {
    database.close();
  }
}

async function loadOrCreateMasterKey(): Promise<CryptoKey> {
  const stored = await readRecord<CryptoKey>(KEY_STORE, MASTER_KEY_ID);
  if (stored) {
    if (stored.type !== "secret" || stored.extractable || stored.algorithm.name !== "AES-GCM") {
      throw new Error("stored credential key does not match the vault policy");
    }
    return stored;
  }

  const generated = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  try {
    await addRecord(KEY_STORE, generated, MASTER_KEY_ID);
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== "ConstraintError") throw error;
  }
  const restored = await readRecord<CryptoKey>(KEY_STORE, MASTER_KEY_ID);
  if (!restored) throw new Error("credential key was not retained by IndexedDB");
  return restored;
}

async function getMasterKey(): Promise<CryptoKey> {
  masterKeyPromise ??= loadOrCreateMasterKey();
  try {
    return await masterKeyPromise;
  } catch (error: unknown) {
    masterKeyPromise = undefined;
    throw error;
  }
}

function additionalData(provider: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`clawsembly:credential:v1:${provider}`);
}

function cloneBuffer(value: Uint8Array<ArrayBuffer>): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function includesSequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function assertStoredCredential(value: StoredCredentialV1 | undefined, provider: CredentialProvider): StoredCredentialV1 | undefined {
  if (!value) return undefined;
  if (value.version !== 1 || value.provider !== provider || value.algorithm !== "AES-GCM"
    || !(value.iv instanceof ArrayBuffer) || value.iv.byteLength !== 12
    || !(value.ciphertext instanceof ArrayBuffer) || value.ciphertext.byteLength <= 16
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("stored credential record is invalid");
  }
  return value;
}

export async function storeProviderCredential(provider: CredentialProvider, secret: string): Promise<CredentialMetadata> {
  const plaintext = new TextEncoder().encode(secret);
  if (secret.trim().length === 0) throw new Error("credential is empty");
  if (plaintext.byteLength > MAX_SECRET_BYTES) throw new Error("credential exceeds the 16 KB safety limit");

  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(provider), tagLength: 128 },
    key,
    plaintext
  );
  const existing = assertStoredCredential(await readRecord<StoredCredentialV1>(CREDENTIAL_STORE, provider), provider);
  const now = new Date().toISOString();
  const record: StoredCredentialV1 = {
    version: 1,
    provider,
    algorithm: "AES-GCM",
    iv: cloneBuffer(iv),
    ciphertext,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  await writeRecord(CREDENTIAL_STORE, record);
  const persisted = assertStoredCredential(await readRecord<StoredCredentialV1>(CREDENTIAL_STORE, provider), provider);
  if (!persisted || includesSequence(new Uint8Array(persisted.ciphertext), plaintext)) {
    await deleteRecord(CREDENTIAL_STORE, provider);
    throw new Error("credential ciphertext verification failed");
  }
  const verifiedPlaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(persisted.iv),
      additionalData: additionalData(provider),
      tagLength: 128
    },
    key,
    persisted.ciphertext
  );
  if (new TextDecoder("utf-8", { fatal: true }).decode(verifiedPlaintext) !== secret) {
    await deleteRecord(CREDENTIAL_STORE, provider);
    throw new Error("credential round-trip verification failed");
  }
  return { provider, algorithm: record.algorithm, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

export async function getCredentialMetadata(provider: CredentialProvider): Promise<CredentialMetadata | undefined> {
  const record = assertStoredCredential(await readRecord<StoredCredentialV1>(CREDENTIAL_STORE, provider), provider);
  return record
    ? { provider, algorithm: record.algorithm, createdAt: record.createdAt, updatedAt: record.updatedAt }
    : undefined;
}

export async function withProviderCredential<T>(
  provider: CredentialProvider,
  consume: (secret: string) => Promise<T>
): Promise<T> {
  const record = assertStoredCredential(await readRecord<StoredCredentialV1>(CREDENTIAL_STORE, provider), provider);
  if (!record) throw new Error(`${provider} credential is not stored`);
  const key = await getMasterKey();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(record.iv),
      additionalData: additionalData(provider),
      tagLength: 128
    },
    key,
    record.ciphertext
  );
  return consume(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
}

export async function removeProviderCredential(provider: CredentialProvider): Promise<void> {
  await deleteRecord(CREDENTIAL_STORE, provider);
}

export async function runCredentialVaultProbe(): Promise<CredentialVaultProbe> {
  const key = await getMasterKey();
  const cryptoKeyStoredInIndexedDb = (await readRecord<CryptoKey>(KEY_STORE, MASTER_KEY_ID)) instanceof CryptoKey;
  let keyExportRejected = false;
  try {
    await crypto.subtle.exportKey("raw", key);
  } catch {
    keyExportRejected = true;
  }

  const marker = `clawsembly-vault-probe-${crypto.randomUUID()}`;
  const plaintext = new TextEncoder().encode(marker);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData("__probe__"), tagLength: 128 },
    key,
    plaintext
  );
  const plaintextAbsentFromCiphertext = !includesSequence(new Uint8Array(ciphertext), plaintext);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: additionalData("__probe__"), tagLength: 128 },
    key,
    ciphertext
  );
  const roundTrip = new TextDecoder().decode(decrypted) === marker;
  let aadMismatchRejected = false;
  try {
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData("__wrong_scope__"), tagLength: 128 },
      key,
      ciphertext
    );
  } catch {
    aadMismatchRejected = true;
  }

  if (!cryptoKeyStoredInIndexedDb || key.extractable || !keyExportRejected
    || !plaintextAbsentFromCiphertext || !roundTrip || !aadMismatchRejected) {
    throw new Error("credential vault self-test failed");
  }
  return {
    algorithm: "AES-GCM-256",
    cryptoKeyStoredInIndexedDb: true,
    keyExtractable: false,
    keyExportRejected: true,
    plaintextAbsentFromCiphertext: true,
    roundTrip: true,
    aadMismatchRejected: true,
    result: "pass"
  };
}
