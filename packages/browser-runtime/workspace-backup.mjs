import { assertAbsoluteGuestPath } from "./browser-runtime.mjs";

export const WORKSPACE_BACKUP_FORMAT = "clawsembly.browserpod-workspace";
export const WORKSPACE_BACKUP_VERSION = 2;

const SNAPSHOT_FORMAT = `${WORKSPACE_BACKUP_FORMAT}-snapshot`;
const EXCHANGE_FORMAT = "clawsembly.workspace-exchange";
const EXCHANGE_VERSION = 1;
const LEGACY_RUNTIME_MAGIC = new TextEncoder().encode("CLAWBKP1");
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RELATIVE_PATH_PATTERN = /^[^\\\u0000-\u001f\u007f]+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EXCHANGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const MAX_FILES = 512;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 8 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HELPER_MARKER = "[clawsembly-workspace]";
const DEFAULT_EXCHANGE_ROOT = "/workspace/.clawsembly/workspace-backup";

// BrowserPod 2.12.1 has no directory-listing or binary-file host API. This
// bounded guest helper traverses the user-selected root and exchanges one
// temporary JSON snapshot through the documented text-file boundary. It
// never prints paths or contents, rejects links and special files, and only
// restores into a root that does not exist yet. Shared protocol constants
// are interpolated from this module so the two sides cannot drift.
const WORKSPACE_HELPER_SOURCE = String.raw`import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const MARKER = ${JSON.stringify(HELPER_MARKER)};
const FORMAT = ${JSON.stringify(SNAPSHOT_FORMAT)};
const VERSION = ${WORKSPACE_BACKUP_VERSION};
const MAX_FILES = ${MAX_FILES};
const MAX_FILE_BYTES = ${MAX_FILE_BYTES};
const MAX_WORKSPACE_BYTES = ${MAX_WORKSPACE_BYTES};
const PATH_PATTERN = ${RELATIVE_PATH_PATTERN};
const EXCHANGE_FORMAT = ${JSON.stringify(EXCHANGE_FORMAT)};
const IV_BYTES = ${IV_BYTES};
const TAG_BYTES = ${TAG_BYTES};

function fail(message) {
  process.stderr.write(MARKER + " error " + message + "\n");
  process.exitCode = 1;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function absolutePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096
    || /[\\\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split("/").slice(1);
  return value !== "/" && segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function relativePath(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 || !PATH_PATTERN.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exchangeKey() {
  const encoded = process.env.CLAWSEMBLY_WORKSPACE_EXCHANGE_KEY;
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) throw new Error("exchange key is invalid");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) throw new Error("exchange key is invalid");
  return key;
}

function encryptExchange(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    format: EXCHANGE_FORMAT,
    version: ${EXCHANGE_VERSION},
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  });
}

function decryptExchange(text, key) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error("exchange document is invalid JSON"); }
  if (!exactKeys(value, ["format", "version", "algorithm", "iv", "tag", "data"])
    || value.format !== EXCHANGE_FORMAT || value.version !== ${EXCHANGE_VERSION} || value.algorithm !== "AES-256-GCM") {
    throw new Error("exchange document is invalid");
  }
  const iv = Buffer.from(value.iv, "base64");
  const tag = Buffer.from(value.tag, "base64");
  const data = Buffer.from(value.data, "base64");
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES
    || iv.toString("base64") !== value.iv || tag.toString("base64") !== value.tag
    || data.toString("base64") !== value.data) throw new Error("exchange document encoding is invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error("snapshot file encoding is invalid");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("snapshot file encoding is not canonical");
  return decoded;
}

function normalizeSnapshot(value) {
  if (!exactKeys(value, ["format", "version", "files"]) || value.format !== FORMAT || value.version !== VERSION || !Array.isArray(value.files) || value.files.length > MAX_FILES) {
    throw new Error("snapshot structure is invalid");
  }
  const seen = new Set();
  let bytes = 0;
  let previous = "";
  const files = value.files.map((entry) => {
    if (!exactKeys(entry, ["path", "bytes", "sha256", "content"]) || !relativePath(entry.path) || seen.has(entry.path) || entry.path <= previous
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_FILE_BYTES
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error("snapshot file metadata is invalid");
    }
    const content = decodeBase64(entry.content);
    if (content.byteLength !== entry.bytes || digest(content) !== entry.sha256) throw new Error("snapshot file integrity is invalid");
    seen.add(entry.path);
    previous = entry.path;
    bytes += content.byteLength;
    if (bytes > MAX_WORKSPACE_BYTES) throw new Error("snapshot exceeds the workspace limit");
    return { ...entry, content };
  });
  return { files, bytes };
}

async function collect(root) {
  const files = [];
  let totalBytes = 0;
  async function visit(directory, prefix) {
    // readdir order is filesystem-dependent; the final sort makes it canonical.
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childPath = prefix ? prefix + "/" + entry.name : entry.name;
      if (!relativePath(childPath)) throw new Error("workspace path is invalid");
      const target = resolve(directory, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("workspace links are not supported");
      if (info.isDirectory()) {
        await visit(target, childPath);
        continue;
      }
      if (!info.isFile()) throw new Error("workspace special files are not supported");
      if (info.size > MAX_FILE_BYTES) throw new Error("workspace file exceeds the limit");
      if (files.length >= MAX_FILES) throw new Error("workspace file count exceeds the limit");
      const content = await readFile(target);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_WORKSPACE_BYTES) throw new Error("workspace exceeds the size limit");
      files.push({
        path: childPath,
        bytes: content.byteLength,
        sha256: digest(content),
        content: content.toString("base64")
      });
    }
  }
  await visit(root, "");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { format: FORMAT, version: VERSION, files, totalBytes };
}

async function exportWorkspace(root, exchange, key) {
  const snapshot = await collect(root);
  await mkdir(dirname(exchange), { recursive: true });
  const plaintext = JSON.stringify({ format: snapshot.format, version: snapshot.version, files: snapshot.files });
  await writeFile(exchange, encryptExchange(plaintext, key), { encoding: "utf8", flag: "wx" });
  process.stdout.write(MARKER + JSON.stringify({ event: "exported", files: snapshot.files.length, bytes: snapshot.totalBytes }) + "\n");
}

async function restoreWorkspace(root, exchange, key) {
  try {
    await lstat(root);
    throw new Error("restore root already exists");
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
  const decrypted = decryptExchange(await readFile(exchange, "utf8"), key);
  let parsed;
  try { parsed = JSON.parse(decrypted); }
  catch { throw new Error("snapshot payload is invalid JSON"); }
  const snapshot = normalizeSnapshot(parsed);
  const temporary = root + ".clawsembly-restore-" + process.pid + "-" + Date.now();
  await rm(temporary, { recursive: true, force: true });
  try {
    await mkdir(temporary, { recursive: false });
    for (const file of snapshot.files) {
      const target = resolve(temporary, file.path);
      const contained = relative(temporary, target);
      if (!contained || contained.startsWith("..") || isAbsolute(contained)) {
        throw new Error("restore path escaped the workspace root");
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, { flag: "wx" });
    }
    await mkdir(dirname(root), { recursive: true });
    await rename(temporary, root);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(exchange, { force: true });
  }
  process.stdout.write(MARKER + JSON.stringify({ event: "restored", files: snapshot.files.length, bytes: snapshot.bytes }) + "\n");
}

async function main() {
  const [operation, root, exchange] = process.argv.slice(2);
  if (!["export", "restore", "cleanup"].includes(operation) || !absolutePath(root) || !absolutePath(exchange)) {
    throw new Error("helper arguments are invalid");
  }
  if (operation === "export") await exportWorkspace(root, exchange, exchangeKey());
  else if (operation === "restore") await restoreWorkspace(root, exchange, exchangeKey());
  else {
    await rm(exchange, { force: true });
    process.stdout.write(MARKER + JSON.stringify({ event: "cleaned", files: 0, bytes: 0 }) + "\n");
  }
}

// Node filesystem errors embed paths in their messages; reduce them to their
// classified code so the helper never prints paths.
main().catch((error) => fail(
  error && typeof error.code === "string" && error.code.length > 0
    ? "filesystem operation failed (" + error.code + ")"
    : error instanceof Error ? error.message : "operation failed"
));
`;

export class WorkspaceBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceBackupError";
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function fail(code, message) {
  throw new WorkspaceBackupError(code, message);
}

function safeAudit(sink, event) {
  try { sink?.(Object.freeze(event)); }
  catch { /* Audit consumers cannot break backup or restore. */ }
}

function normalizeRoot(value, label = "workspace root") {
  let root;
  try { root = assertAbsoluteGuestPath(value, label); }
  catch { fail("invalid_workspace_root", `${label} is invalid`); }
  if (!root.startsWith("/workspace/") || /[\\\u0000-\u001f\u007f]/u.test(root)
    || root.split("/").includes(".clawsembly")) {
    fail("invalid_workspace_root", `${label} must select user workspace data`);
  }
  return root;
}

function normalizeExchangeRoot(value, workspaceRoot) {
  let root;
  try { root = assertAbsoluteGuestPath(value ?? DEFAULT_EXCHANGE_ROOT, "workspace backup exchange root"); }
  catch { fail("invalid_exchange_root", "workspace backup exchange root is invalid"); }
  if (/[\\\u0000-\u001f\u007f]/u.test(root)) {
    fail("invalid_exchange_root", "workspace backup exchange root is invalid");
  }
  if (root !== DEFAULT_EXCHANGE_ROOT && !root.startsWith(`${DEFAULT_EXCHANGE_ROOT}/`)) {
    fail("invalid_exchange_root", "workspace backup exchange root must stay under the reserved internal directory");
  }
  if (root === workspaceRoot || root.startsWith(`${workspaceRoot}/`)) {
    fail("invalid_exchange_root", "workspace backup exchange root must be outside the user workspace");
  }
  return root;
}

function normalizeSubject(value) {
  if (!exactKeys(value, ["artifact", "runtime", "workspaceId"])
    || !exactKeys(value.artifact, ["package", "version", "integrity"])
    || typeof value.artifact.package !== "string" || value.artifact.package.length > 214
    || !PACKAGE_NAME_PATTERN.test(value.artifact.package)
    || typeof value.artifact.version !== "string" || !VERSION_PATTERN.test(value.artifact.version)
    || typeof value.artifact.integrity !== "string" || !INTEGRITY_PATTERN.test(value.artifact.integrity)
    || !exactKeys(value.runtime, ["provider", "version"])
    || value.runtime.provider !== "browserpod" || typeof value.runtime.version !== "string"
    || !VERSION_PATTERN.test(value.runtime.version)
    || typeof value.workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(value.workspaceId)) {
    fail("invalid_subject", "workspace backup subject is invalid");
  }
  return Object.freeze({
    artifact: Object.freeze({ ...value.artifact }),
    runtime: Object.freeze({ provider: "browserpod", version: value.runtime.version }),
    workspaceId: value.workspaceId
  });
}

function subjectsEqual(left, right) {
  return left.artifact.package === right.artifact.package
    && left.artifact.version === right.artifact.version
    && left.artifact.integrity === right.artifact.integrity
    && left.runtime.provider === right.runtime.provider
    && left.runtime.version === right.runtime.version
    && left.workspaceId === right.workspaceId;
}

function normalizeRelativePath(value) {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024
    || !RELATIVE_PATH_PATTERN.test(value)
    || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("invalid_workspace_file", "workspace backup contains an invalid relative path");
  }
  return value;
}

function bytesToBase64(value) {
  let binary = "";
  for (let offset = 0; offset < value.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...value.subarray(offset, Math.min(value.byteLength, offset + 32_768)));
  }
  return btoa(binary);
}

function base64ToBytes(value, maxBytes, code = "invalid_backup") {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail(code, "workspace backup base64 is invalid");
  }
  let binary;
  try { binary = atob(value); }
  catch { fail(code, "workspace backup base64 is invalid"); }
  if (binary.length > maxBytes) fail(code, "workspace backup data exceeds its safety limit");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== value) fail(code, "workspace backup base64 is not canonical");
  return bytes;
}

function cryptoApi(value = globalThis.crypto) {
  if (!value?.subtle || typeof value.getRandomValues !== "function") {
    fail("crypto_unavailable", "Web Crypto is required for encrypted workspace backups");
  }
  return value;
}

function normalizePassphrase(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 1_024
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail("invalid_passphrase", "workspace backup passphrase must contain 12 to 1024 printable characters");
  }
  return value;
}

function toHex(value) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value, crypto) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return toHex(await crypto.subtle.digest("SHA-256", copy));
}

async function deriveKey(passphrase, salt, crypto, usage) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizePassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

async function importExchangeKey(key, crypto, usage) {
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [usage]);
}

function normalizeExchangeDocument(value) {
  if (!exactKeys(value, ["format", "version", "algorithm", "iv", "tag", "data"])
    || value.format !== EXCHANGE_FORMAT || value.version !== EXCHANGE_VERSION
    || value.algorithm !== "AES-256-GCM") {
    fail("invalid_exchange", "workspace exchange document is invalid");
  }
  const iv = base64ToBytes(value.iv, IV_BYTES, "invalid_exchange");
  const tag = base64ToBytes(value.tag, TAG_BYTES, "invalid_exchange");
  const data = base64ToBytes(value.data, MAX_ENVELOPE_BYTES, "invalid_exchange");
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
    fail("invalid_exchange", "workspace exchange encryption parameters are invalid");
  }
  return { iv, tag, data };
}

async function encryptExchangeSnapshot(plaintext, keyBytes, crypto) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importExchangeKey(keyBytes, crypto, "encrypt");
  const combined = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  ));
  const tag = combined.slice(combined.byteLength - TAG_BYTES);
  const data = combined.slice(0, combined.byteLength - TAG_BYTES);
  return JSON.stringify({
    format: EXCHANGE_FORMAT,
    version: EXCHANGE_VERSION,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    data: bytesToBase64(data)
  });
}

async function decryptExchangeSnapshot(text, keyBytes, crypto) {
  let value;
  try { value = JSON.parse(text); }
  catch { fail("invalid_exchange", "workspace exchange document is invalid JSON"); }
  const exchange = normalizeExchangeDocument(value);
  const combined = new Uint8Array(exchange.data.byteLength + exchange.tag.byteLength);
  combined.set(exchange.data, 0);
  combined.set(exchange.tag, exchange.data.byteLength);
  const key = await importExchangeKey(keyBytes, crypto, "decrypt");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: exchange.iv, tagLength: 128 },
      key,
      combined
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    fail("exchange_decryption_failed", "workspace exchange authentication failed");
  }
}

async function normalizeFiles(files, crypto) {
  if (!Array.isArray(files) || files.length > MAX_FILES) {
    fail("workspace_limit_exceeded", "workspace backup file count exceeds its safety limit");
  }
  const seen = new Set();
  let totalBytes = 0;
  const normalized = [];
  for (const file of files) {
    if (!plainObject(file) || !exactKeys(file, ["path", "content"]) || !(file.content instanceof Uint8Array)) {
      fail("invalid_workspace_file", "workspace backup file is invalid");
    }
    const path = normalizeRelativePath(file.path);
    if (seen.has(path)) fail("invalid_workspace_file", "workspace backup file paths must be unique");
    if (file.content.byteLength > MAX_FILE_BYTES) {
      fail("workspace_limit_exceeded", "workspace backup file exceeds its safety limit");
    }
    totalBytes += file.content.byteLength;
    if (totalBytes > MAX_WORKSPACE_BYTES) {
      fail("workspace_limit_exceeded", "workspace backup exceeds its safety limit");
    }
    const content = new Uint8Array(file.content.byteLength);
    content.set(file.content);
    normalized.push({
      path,
      bytes: content.byteLength,
      sha256: await sha256(content, crypto),
      content: bytesToBase64(content)
    });
    seen.add(path);
  }
  normalized.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { files: normalized, totalBytes };
}

function snapshotFileToPublic(file) {
  return Object.freeze({ path: file.path, content: base64ToBytes(file.content, MAX_FILE_BYTES) });
}

async function normalizeSnapshot(value, crypto) {
  if (!exactKeys(value, ["format", "version", "files"])
    || value.format !== SNAPSHOT_FORMAT
    || value.version !== WORKSPACE_BACKUP_VERSION || !Array.isArray(value.files)
    || value.files.length > MAX_FILES) {
    fail("invalid_snapshot", "workspace snapshot structure is invalid");
  }
  const seen = new Set();
  let previous = "";
  let totalBytes = 0;
  const files = [];
  for (const file of value.files) {
    if (!exactKeys(file, ["path", "bytes", "sha256", "content"])) {
      fail("invalid_snapshot", "workspace snapshot file metadata is invalid");
    }
    const path = normalizeRelativePath(file.path);
    if (seen.has(path) || path <= previous || !Number.isSafeInteger(file.bytes)
      || file.bytes < 0 || file.bytes > MAX_FILE_BYTES || typeof file.sha256 !== "string"
      || !SHA256_PATTERN.test(file.sha256)) {
      fail("invalid_snapshot", "workspace snapshot file metadata is invalid");
    }
    const content = base64ToBytes(file.content, MAX_FILE_BYTES, "invalid_snapshot");
    if (content.byteLength !== file.bytes || await sha256(content, crypto) !== file.sha256) {
      fail("snapshot_integrity_failed", "workspace snapshot file integrity check failed");
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_WORKSPACE_BYTES) fail("workspace_limit_exceeded", "workspace snapshot exceeds its safety limit");
    files.push({ path, bytes: file.bytes, sha256: file.sha256, content: file.content });
    previous = path;
    seen.add(path);
  }
  return { files, totalBytes };
}

function canonicalHeader({ createdAt, subject, workspace, salt, iv }) {
  return {
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    createdAt,
    subject,
    workspace,
    encryption: {
      algorithm: "AES-GCM-256",
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv)
    }
  };
}

function parseEnvelopeBytes(backup) {
  if (!(backup instanceof Uint8Array) || backup.byteLength < 1 || backup.byteLength > MAX_ENVELOPE_BYTES) {
    fail("invalid_backup", "workspace backup bytes are invalid");
  }
  if (backup.byteLength >= LEGACY_RUNTIME_MAGIC.byteLength
    && LEGACY_RUNTIME_MAGIC.every((byte, index) => backup[index] === byte)) {
    fail("legacy_runtime_backup_unsupported", "the removed WebContainer mock-state backup cannot be restored into BrowserPod");
  }
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(backup)); }
  catch { fail("invalid_backup", "workspace backup is not valid UTF-8 JSON"); }
  return value;
}

function normalizeEnvelope(value) {
  if (!exactKeys(value, ["format", "version", "createdAt", "subject", "workspace", "encryption", "ciphertext"])
    || value.format !== WORKSPACE_BACKUP_FORMAT || value.version !== WORKSPACE_BACKUP_VERSION
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    fail("invalid_backup", "workspace backup manifest is invalid");
  }
  const subject = normalizeSubject(value.subject);
  if (!exactKeys(value.workspace, ["root", "files", "bytes"])
    || !Number.isSafeInteger(value.workspace.files) || value.workspace.files < 0 || value.workspace.files > MAX_FILES
    || !Number.isSafeInteger(value.workspace.bytes) || value.workspace.bytes < 0 || value.workspace.bytes > MAX_WORKSPACE_BYTES) {
    fail("invalid_backup", "workspace backup metadata is invalid");
  }
  const workspace = Object.freeze({
    root: normalizeRoot(value.workspace.root),
    files: value.workspace.files,
    bytes: value.workspace.bytes
  });
  if (!exactKeys(value.encryption, ["algorithm", "kdf", "iterations", "salt", "iv"])
    || value.encryption.algorithm !== "AES-GCM-256" || value.encryption.kdf !== "PBKDF2-SHA-256"
    || value.encryption.iterations !== PBKDF2_ITERATIONS) {
    fail("invalid_backup", "workspace backup encryption metadata is invalid");
  }
  const salt = base64ToBytes(value.encryption.salt, SALT_BYTES, "invalid_backup");
  const iv = base64ToBytes(value.encryption.iv, IV_BYTES, "invalid_backup");
  if (salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
    fail("invalid_backup", "workspace backup encryption parameters are invalid");
  }
  if (!exactKeys(value.ciphertext, ["encoding", "bytes", "sha256", "data"])
    || value.ciphertext.encoding !== "base64" || !Number.isSafeInteger(value.ciphertext.bytes)
    || value.ciphertext.bytes < TAG_BYTES || value.ciphertext.bytes > MAX_ENVELOPE_BYTES
    || typeof value.ciphertext.sha256 !== "string" || !SHA256_PATTERN.test(value.ciphertext.sha256)) {
    fail("invalid_backup", "workspace backup ciphertext metadata is invalid");
  }
  const ciphertext = base64ToBytes(value.ciphertext.data, MAX_ENVELOPE_BYTES, "invalid_backup");
  if (ciphertext.byteLength !== value.ciphertext.bytes) fail("invalid_backup", "workspace backup ciphertext length is invalid");
  return { createdAt: value.createdAt, subject, workspace, salt, iv, ciphertext, ciphertextSha256: value.ciphertext.sha256 };
}

// Seals an already-validated snapshot for an already-normalized subject and
// root. Both producers (public file lists, the helper export) funnel here so
// validated snapshot entries are encrypted without a second hash-and-encode
// pass.
async function sealWorkspaceBackup({ snapshot, subject, root, passphrase, createdAt, crypto }) {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) fail("invalid_timestamp", "workspace backup timestamp is invalid");
  const workspace = Object.freeze({ root, files: snapshot.files.length, bytes: snapshot.totalBytes });
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = canonicalHeader({
    createdAt: createdAt.toISOString(),
    subject,
    workspace,
    salt,
    iv
  });
  const payload = new TextEncoder().encode(JSON.stringify({
    format: SNAPSHOT_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    files: snapshot.files
  }));
  if (payload.byteLength > MAX_ENVELOPE_BYTES) fail("workspace_limit_exceeded", "workspace backup payload exceeds its safety limit");
  const additionalData = new TextEncoder().encode(JSON.stringify(header));
  const key = await deriveKey(passphrase, salt, crypto, "encrypt");
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 },
    key,
    payload
  ));
  const envelope = {
    ...header,
    ciphertext: {
      encoding: "base64",
      bytes: ciphertext.byteLength,
      sha256: await sha256(ciphertext, crypto),
      data: bytesToBase64(ciphertext)
    }
  };
  const encoded = new TextEncoder().encode(JSON.stringify(envelope));
  if (encoded.byteLength > MAX_ENVELOPE_BYTES) fail("workspace_limit_exceeded", "workspace backup exceeds its safety limit");
  return encoded;
}

/** Creates a passphrase-encrypted, exact-subject workspace backup envelope. */
export async function createWorkspaceBackup({
  files,
  subject,
  workspaceRoot,
  passphrase,
  createdAt = new Date(),
  crypto: cryptoValue
}) {
  const crypto = cryptoApi(cryptoValue);
  const normalizedSubject = normalizeSubject(subject);
  const root = normalizeRoot(workspaceRoot);
  const snapshot = await normalizeFiles(files, crypto);
  return sealWorkspaceBackup({ snapshot, subject: normalizedSubject, root, passphrase, createdAt, crypto });
}

// Verifies and decrypts an envelope, returning the manifest plus the
// validated snapshot entries so restore can reuse them without re-hashing.
async function openWorkspaceBackup({ backup, passphrase, expectedSubject, crypto }) {
  const envelope = normalizeEnvelope(parseEnvelopeBytes(backup));
  const expected = normalizeSubject(expectedSubject);
  if (!subjectsEqual(envelope.subject, expected)) {
    fail("subject_mismatch", "workspace backup does not match the expected artifact, runtime, and workspace");
  }
  if (await sha256(envelope.ciphertext, crypto) !== envelope.ciphertextSha256) {
    fail("ciphertext_integrity_failed", "workspace backup ciphertext checksum does not match");
  }
  const header = canonicalHeader(envelope);
  const additionalData = new TextEncoder().encode(JSON.stringify(header));
  const key = await deriveKey(passphrase, envelope.salt, crypto, "decrypt");
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.iv, additionalData, tagLength: 128 },
      key,
      envelope.ciphertext
    ));
  } catch {
    fail("decryption_failed", "workspace backup passphrase or authenticated metadata is invalid");
  }
  let untrustedSnapshot;
  try { untrustedSnapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)); }
  catch { fail("invalid_snapshot", "workspace backup payload is invalid"); }
  const snapshot = await normalizeSnapshot(untrustedSnapshot, crypto);
  if (snapshot.files.length !== envelope.workspace.files || snapshot.totalBytes !== envelope.workspace.bytes) {
    fail("snapshot_integrity_failed", "workspace backup payload does not match its manifest");
  }
  return {
    manifest: Object.freeze({
      format: WORKSPACE_BACKUP_FORMAT,
      version: WORKSPACE_BACKUP_VERSION,
      createdAt: envelope.createdAt,
      subject: envelope.subject,
      workspace: envelope.workspace,
      encrypted: true
    }),
    snapshot
  };
}

/** Decrypts and verifies a workspace backup for one exact artifact/runtime/workspace subject. */
export async function decodeWorkspaceBackup({ backup, passphrase, expectedSubject, crypto: cryptoValue }) {
  const crypto = cryptoApi(cryptoValue);
  const opened = await openWorkspaceBackup({ backup, passphrase, expectedSubject, crypto });
  return Object.freeze({
    manifest: opened.manifest,
    files: Object.freeze(opened.snapshot.files.map(snapshotFileToPublic))
  });
}

function parseLegacySnapshot(value) {
  let parsed = value;
  if (value instanceof Uint8Array || typeof value === "string") {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_ENVELOPE_BYTES) fail("invalid_legacy_snapshot", "legacy workspace snapshot is invalid");
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { fail("invalid_legacy_snapshot", "legacy workspace snapshot is invalid JSON"); }
  }
  if (!exactKeys(parsed, ["format", "version", "createdAt", "subject", "workspaceRoot", "files"])
    || parsed.format !== WORKSPACE_BACKUP_FORMAT || parsed.version !== 1
    || typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
    || !Array.isArray(parsed.files) || parsed.files.length > MAX_FILES) {
    fail("invalid_legacy_snapshot", "legacy workspace snapshot structure is invalid");
  }
  const subject = normalizeSubject(parsed.subject);
  const workspaceRoot = normalizeRoot(parsed.workspaceRoot);
  const seen = new Set();
  let totalBytes = 0;
  const files = parsed.files.map((file) => {
    if (!exactKeys(file, ["path", "encoding", "content"]) || file.encoding !== "base64") {
      fail("invalid_legacy_snapshot", "legacy workspace snapshot file is invalid");
    }
    const path = normalizeRelativePath(file.path);
    if (seen.has(path)) fail("invalid_legacy_snapshot", "legacy workspace paths must be unique");
    const content = base64ToBytes(file.content, MAX_FILE_BYTES, "invalid_legacy_snapshot");
    totalBytes += content.byteLength;
    if (totalBytes > MAX_WORKSPACE_BYTES) fail("workspace_limit_exceeded", "legacy workspace snapshot exceeds its safety limit");
    seen.add(path);
    return { path, content };
  });
  return { subject, workspaceRoot, files };
}

/** Explicitly migrates the checked v1 BrowserPod workspace fixture into encrypted v2. */
export async function migrateLegacyWorkspaceSnapshot({
  snapshot,
  expectedSubject,
  targetSubject = expectedSubject,
  targetWorkspaceRoot,
  passphrase,
  createdAt = new Date(),
  crypto
}) {
  const legacy = parseLegacySnapshot(snapshot);
  const expected = normalizeSubject(expectedSubject);
  if (!subjectsEqual(legacy.subject, expected)) fail("subject_mismatch", "legacy workspace snapshot subject does not match");
  return createWorkspaceBackup({
    files: legacy.files,
    subject: normalizeSubject(targetSubject),
    workspaceRoot: targetWorkspaceRoot ?? legacy.workspaceRoot,
    passphrase,
    createdAt,
    crypto
  });
}

function assertRuntime(runtime) {
  if (!runtime || runtime.provider !== "browserpod" || typeof runtime.createDirectory !== "function"
    || typeof runtime.writeTextFile !== "function" || typeof runtime.readTextFile !== "function"
    || typeof runtime.start !== "function") {
    fail("invalid_runtime", "a booted BrowserPod runtime with bounded file access is required");
  }
  return runtime;
}

async function stageHelper(runtime, exchangeRoot, crypto) {
  const helperRoot = `${exchangeRoot}/helper-v1`;
  const helperPath = `${helperRoot}/workspace-backup-helper.mjs`;
  await runtime.createDirectory(helperRoot, { recursive: true });
  await runtime.writeTextFile(helperPath, WORKSPACE_HELPER_SOURCE);
  const readback = await runtime.readTextFile(helperPath, { maxBytes: 128 * 1024 });
  const expected = await sha256(new TextEncoder().encode(WORKSPACE_HELPER_SOURCE), crypto);
  const actual = await sha256(new TextEncoder().encode(readback), crypto);
  if (actual !== expected) fail("helper_staging_failed", "workspace backup helper failed staging verification");
  return helperPath;
}

function parseHelperRecord(transcript, expectedEvent) {
  const line = String(transcript).split(/\r?\n/u).find((entry) => entry.startsWith(HELPER_MARKER));
  if (!line) fail("helper_output_missing", "workspace backup helper did not emit a result");
  let value;
  try { value = JSON.parse(line.slice(HELPER_MARKER.length)); }
  catch { fail("helper_output_invalid", "workspace backup helper emitted invalid output"); }
  if (!exactKeys(value, ["event", "files", "bytes"]) || value.event !== expectedEvent
    || !Number.isSafeInteger(value.files) || value.files < 0 || value.files > MAX_FILES
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_WORKSPACE_BYTES) {
    fail("helper_output_invalid", "workspace backup helper emitted invalid metadata");
  }
  return value;
}

async function runHelper(runtime, helperPath, operation, workspaceRoot, exchangePath, exchangeKeyBytes) {
  const task = await runtime.start({
    executable: "node",
    args: [helperPath, operation, workspaceRoot, exchangePath],
    cwd: workspaceRoot.split("/").slice(0, -1).join("/") || "/",
    env: exchangeKeyBytes ? [`CLAWSEMBLY_WORKSPACE_EXCHANGE_KEY=${bytesToBase64(exchangeKeyBytes)}`] : [],
    outputLimitBytes: 4_096,
    echo: false
  });
  const completion = await task.wait();
  if (completion.status !== "completed" || task.outputTruncated) {
    fail("helper_failed", `workspace backup ${operation} helper failed`);
  }
  const expectedEvent = operation === "cleanup" ? "cleaned" : operation === "restore" ? "restored" : "exported";
  return parseHelperRecord(task.transcript, expectedEvent);
}

function exchangeId(factory) {
  const value = factory();
  if (typeof value !== "string" || !EXCHANGE_ID_PATTERN.test(value)) {
    fail("invalid_exchange_id", "workspace backup exchange identifier is invalid");
  }
  return value;
}

/** Captures a real BrowserPod user workspace and returns only an encrypted envelope. */
export async function exportBrowserPodWorkspace({
  runtime: runtimeValue,
  subject,
  workspaceRoot,
  passphrase,
  exchangeRoot: exchangeRootValue,
  idFactory,
  now = () => new Date(),
  onAudit,
  crypto: cryptoValue
}) {
  const runtime = assertRuntime(runtimeValue);
  const crypto = cryptoApi(cryptoValue);
  const normalizedSubject = normalizeSubject(subject);
  const root = normalizeRoot(workspaceRoot);
  const exchangeRoot = normalizeExchangeRoot(exchangeRootValue, root);
  if ((idFactory !== undefined && typeof idFactory !== "function") || typeof now !== "function") {
    fail("invalid_options", "workspace backup options are invalid");
  }
  const id = exchangeId(idFactory ?? (() => crypto.randomUUID()));
  const exchangePath = `${exchangeRoot}/exchange-${id}.json`;
  const helperPath = await stageHelper(runtime, exchangeRoot, crypto);
  const exchangeKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  safeAudit(onAudit, { action: "workspace.export", outcome: "started", package: normalizedSubject.artifact.package, version: normalizedSubject.artifact.version });
  try {
    const result = await runHelper(runtime, helperPath, "export", root, exchangePath, exchangeKeyBytes);
    const exchangeText = await runtime.readTextFile(exchangePath, { maxBytes: MAX_ENVELOPE_BYTES });
    const snapshotText = await decryptExchangeSnapshot(exchangeText, exchangeKeyBytes, crypto);
    let snapshot;
    try { snapshot = JSON.parse(snapshotText); }
    catch { fail("invalid_snapshot", "workspace helper snapshot is invalid JSON"); }
    const normalized = await normalizeSnapshot(snapshot, crypto);
    if (normalized.files.length !== result.files || normalized.totalBytes !== result.bytes) {
      fail("snapshot_integrity_failed", "workspace helper result does not match its snapshot");
    }
    const backup = await sealWorkspaceBackup({
      snapshot: normalized,
      subject: normalizedSubject,
      root,
      passphrase,
      createdAt: now(),
      crypto
    });
    safeAudit(onAudit, { action: "workspace.export", outcome: "completed", files: result.files, bytes: result.bytes });
    return backup;
  } catch (error) {
    safeAudit(onAudit, { action: "workspace.export", outcome: "failed", code: error instanceof WorkspaceBackupError ? error.code : "unexpected" });
    throw error;
  } finally {
    await runHelper(runtime, helperPath, "cleanup", root, exchangePath).catch(() => undefined);
  }
}

/** Restores an authenticated backup into a fresh, non-existent BrowserPod root. */
export async function restoreBrowserPodWorkspace({
  runtime: runtimeValue,
  backup,
  expectedSubject,
  workspaceRoot,
  passphrase,
  exchangeRoot: exchangeRootValue,
  idFactory,
  onAudit,
  crypto: cryptoValue
}) {
  const runtime = assertRuntime(runtimeValue);
  const crypto = cryptoApi(cryptoValue);
  const expected = normalizeSubject(expectedSubject);
  const root = normalizeRoot(workspaceRoot);
  const exchangeRoot = normalizeExchangeRoot(exchangeRootValue, root);
  if (idFactory !== undefined && typeof idFactory !== "function") fail("invalid_options", "workspace restore options are invalid");
  const { manifest, snapshot } = await openWorkspaceBackup({ backup, passphrase, expectedSubject: expected, crypto });
  if (manifest.workspace.root !== root) {
    fail("workspace_root_mismatch", "workspace backup root does not match the restore root; migrate it explicitly first");
  }
  const id = exchangeId(idFactory ?? (() => crypto.randomUUID()));
  const exchangePath = `${exchangeRoot}/exchange-${id}.json`;
  const helperPath = await stageHelper(runtime, exchangeRoot, crypto);
  const exchangeKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const snapshotText = JSON.stringify({
    format: SNAPSHOT_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    files: snapshot.files
  });
  safeAudit(onAudit, { action: "workspace.restore", outcome: "started", package: expected.artifact.package, version: expected.artifact.version });
  try {
    await runtime.writeTextFile(exchangePath, await encryptExchangeSnapshot(snapshotText, exchangeKeyBytes, crypto));
    const result = await runHelper(runtime, helperPath, "restore", root, exchangePath, exchangeKeyBytes);
    if (result.files !== manifest.workspace.files || result.bytes !== manifest.workspace.bytes) {
      fail("restore_integrity_failed", "workspace restore result does not match the backup manifest");
    }
    const restored = Object.freeze({ files: result.files, bytes: result.bytes, root, complete: true });
    safeAudit(onAudit, { action: "workspace.restore", outcome: "completed", files: result.files, bytes: result.bytes });
    return restored;
  } catch (error) {
    safeAudit(onAudit, { action: "workspace.restore", outcome: "failed", code: error instanceof WorkspaceBackupError ? error.code : "unexpected" });
    throw error;
  } finally {
    await runHelper(runtime, helperPath, "cleanup", root, exchangePath).catch(() => undefined);
  }
}
