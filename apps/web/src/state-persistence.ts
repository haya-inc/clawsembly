import type { WebContainer } from "@webcontainer/api";

const LEGACY_SNAPSHOT_FILE = "clawsembly-mock-state.bin";
const BACKUP_FILE = "clawsembly-mock-state.v1";
const BACKUP_MAGIC = new TextEncoder().encode("CLAWBKP1");
const HEADER_BYTES = BACKUP_MAGIC.byteLength + 4;
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;

export interface BackupManifestV1 {
  format: "clawsembly.mock-state";
  version: 1;
  createdAt: string;
  openclawVersion: string;
  scope: ".clawsembly-openclaw";
  snapshot: {
    encoding: "webcontainer-export-binary";
    bytes: number;
    sha256: string;
  };
}

export interface DecodedStateBackup {
  manifest: BackupManifestV1;
  snapshot: Uint8Array;
}

function assertSnapshot(value: Uint8Array): Uint8Array {
  if (value.byteLength === 0) throw new Error("state snapshot is empty");
  if (value.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("state snapshot exceeds the 20 MB safety limit");
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function snapshotDigest(snapshot: Uint8Array): Promise<string> {
  const copy = new Uint8Array(snapshot.byteLength);
  copy.set(snapshot);
  return toHex(await crypto.subtle.digest("SHA-256", copy.buffer));
}

function parseManifest(value: unknown): BackupManifestV1 {
  if (!value || typeof value !== "object") throw new Error("backup manifest is not an object");
  const manifest = value as Partial<BackupManifestV1>;
  if (manifest.format !== "clawsembly.mock-state" || manifest.version !== 1) {
    throw new Error("unsupported Clawsembly backup format");
  }
  if (manifest.scope !== ".clawsembly-openclaw") throw new Error("backup scope is not supported");
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error("backup timestamp is invalid");
  }
  if (typeof manifest.openclawVersion !== "string" || !manifest.openclawVersion) {
    throw new Error("backup OpenClaw version is missing");
  }
  if (manifest.snapshot?.encoding !== "webcontainer-export-binary"
    || !Number.isSafeInteger(manifest.snapshot.bytes)
    || typeof manifest.snapshot.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.snapshot.sha256)) {
    throw new Error("backup snapshot metadata is invalid");
  }
  return manifest as BackupManifestV1;
}

async function storageRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator.storage.getDirectory !== "function") throw new Error("OPFS is unavailable in this browser");
  return navigator.storage.getDirectory();
}

async function readStorageFile(name: string): Promise<Uint8Array | undefined> {
  try {
    const root = await storageRoot();
    const handle = await root.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
    throw error;
  }
}

async function writeStorageFile(name: string, value: Uint8Array): Promise<void> {
  const root = await storageRoot();
  const handle = await root.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  await writer.write(copy.buffer);
  await writer.close();
}

export async function createStateBackup(
  snapshot: Uint8Array,
  openclawVersion: string,
  createdAt = new Date()
): Promise<Uint8Array> {
  assertSnapshot(snapshot);
  const manifest: BackupManifestV1 = {
    format: "clawsembly.mock-state",
    version: 1,
    createdAt: createdAt.toISOString(),
    openclawVersion,
    scope: ".clawsembly-openclaw",
    snapshot: {
      encoding: "webcontainer-export-binary",
      bytes: snapshot.byteLength,
      sha256: await snapshotDigest(snapshot)
    }
  };
  const encodedManifest = new TextEncoder().encode(JSON.stringify(manifest));
  if (encodedManifest.byteLength > MAX_MANIFEST_BYTES) throw new Error("backup manifest exceeds the safety limit");
  const backup = new Uint8Array(HEADER_BYTES + encodedManifest.byteLength + snapshot.byteLength);
  backup.set(BACKUP_MAGIC, 0);
  new DataView(backup.buffer).setUint32(BACKUP_MAGIC.byteLength, encodedManifest.byteLength, false);
  backup.set(encodedManifest, HEADER_BYTES);
  backup.set(snapshot, HEADER_BYTES + encodedManifest.byteLength);
  return backup;
}

export async function decodeStateBackup(backup: Uint8Array): Promise<DecodedStateBackup> {
  if (backup.byteLength < HEADER_BYTES || !bytesEqual(backup.subarray(0, BACKUP_MAGIC.byteLength), BACKUP_MAGIC)) {
    throw new Error("not a Clawsembly backup");
  }
  const manifestBytes = new DataView(backup.buffer, backup.byteOffset, backup.byteLength)
    .getUint32(BACKUP_MAGIC.byteLength, false);
  if (manifestBytes === 0 || manifestBytes > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestBytes >= backup.byteLength) {
    throw new Error("backup manifest length is invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(backup.subarray(HEADER_BYTES, HEADER_BYTES + manifestBytes)));
  } catch {
    throw new Error("backup manifest is invalid JSON");
  }
  const manifest = parseManifest(decoded);
  const snapshot = assertSnapshot(backup.slice(HEADER_BYTES + manifestBytes));
  if (manifest.snapshot.bytes !== snapshot.byteLength) throw new Error("backup snapshot length does not match its manifest");
  if (await snapshotDigest(snapshot) !== manifest.snapshot.sha256) throw new Error("backup snapshot checksum does not match its manifest");
  return { manifest, snapshot };
}

export async function verifyStateBackupGuards(backup: Uint8Array): Promise<{
  checksumMismatchRejected: true;
  unknownVersionRejected: true;
}> {
  await decodeStateBackup(backup);

  const tamperedPayload = backup.slice();
  const lastPayloadByte = tamperedPayload.byteLength - 1;
  tamperedPayload[lastPayloadByte] = (tamperedPayload[lastPayloadByte] ?? 0) ^ 1;
  let checksumMismatchRejected = false;
  try {
    await decodeStateBackup(tamperedPayload);
  } catch (error: unknown) {
    checksumMismatchRejected = error instanceof Error && error.message.includes("checksum");
  }

  const unsupportedVersion = backup.slice();
  const manifestBytes = new DataView(unsupportedVersion.buffer).getUint32(BACKUP_MAGIC.byteLength, false);
  const manifest = new TextDecoder().decode(unsupportedVersion.subarray(HEADER_BYTES, HEADER_BYTES + manifestBytes));
  const marker = '"version":1';
  const markerIndex = manifest.indexOf(marker);
  if (markerIndex < 0) throw new Error("backup version marker is missing");
  unsupportedVersion[HEADER_BYTES + markerIndex + marker.length - 1] = "2".charCodeAt(0);
  let unknownVersionRejected = false;
  try {
    await decodeStateBackup(unsupportedVersion);
  } catch (error: unknown) {
    unknownVersionRejected = error instanceof Error && error.message.includes("unsupported");
  }

  if (!checksumMismatchRejected || !unknownVersionRejected) throw new Error("backup negative validation probe failed");
  return { checksumMismatchRejected: true, unknownVersionRejected: true };
}

export async function exportStateSnapshot(instance: WebContainer): Promise<Uint8Array> {
  const exported = await instance.export(".clawsembly-openclaw", { format: "binary" });
  if (!(exported instanceof Uint8Array)) throw new Error("WebContainer returned a non-binary state snapshot");
  return assertSnapshot(exported);
}

export async function persistStateSnapshot(snapshot: Uint8Array, openclawVersion: string): Promise<void> {
  await writeStorageFile(BACKUP_FILE, await createStateBackup(snapshot, openclawVersion));
}

export async function loadStateSnapshot(): Promise<Uint8Array | undefined> {
  const backup = await readStorageFile(BACKUP_FILE);
  if (backup) return (await decodeStateBackup(backup)).snapshot;

  const legacy = await readStorageFile(LEGACY_SNAPSHOT_FILE);
  if (!legacy) return undefined;
  const snapshot = assertSnapshot(legacy);
  await persistStateSnapshot(snapshot, document.documentElement.dataset.openclawVersion ?? "unknown");
  const root = await storageRoot();
  await root.removeEntry(LEGACY_SNAPSHOT_FILE).catch(() => undefined);
  return snapshot;
}

export async function createStoredStateBackup(openclawVersion: string): Promise<Uint8Array | undefined> {
  const backup = await readStorageFile(BACKUP_FILE);
  if (backup) {
    await decodeStateBackup(backup);
    return backup;
  }
  const snapshot = await loadStateSnapshot();
  if (!snapshot) return undefined;
  const migrated = await createStateBackup(snapshot, openclawVersion);
  await writeStorageFile(BACKUP_FILE, migrated);
  return migrated;
}

export async function importStateBackup(backup: Uint8Array): Promise<DecodedStateBackup> {
  const decoded = await decodeStateBackup(backup);
  await writeStorageFile(BACKUP_FILE, backup);
  return decoded;
}

export async function removeStateSnapshot(): Promise<void> {
  const root = await storageRoot();
  for (const name of [BACKUP_FILE, LEGACY_SNAPSHOT_FILE]) {
    await root.removeEntry(name).catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    });
  }
}

export function formatSnapshotSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
