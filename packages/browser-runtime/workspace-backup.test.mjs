import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  TEST_OPENCLAW_ARTIFACT,
  createFakeRuntime,
  createFakeTask
} from "../test-support/fake-browserpod.mjs";
import { createLocalNodeBrowserPodRuntime } from "../test-support/local-node-browserpod.mjs";
import {
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
  WorkspaceBackupError,
  createWorkspaceBackup,
  decodeWorkspaceBackup,
  exportBrowserPodWorkspace,
  migrateLegacyWorkspaceSnapshot,
  restoreBrowserPodWorkspace
} from "./workspace-backup.mjs";

const PASSPHRASE = "correct horse browser battery staple";
const SUBJECT = Object.freeze({
  artifact: TEST_OPENCLAW_ARTIFACT,
  runtime: Object.freeze({ provider: "browserpod", version: "2.12.1" }),
  workspaceId: "primary"
});

function bytes(value) {
  return new TextEncoder().encode(value);
}

test("encrypts a deterministic workspace snapshot under an exact subject", async () => {
  const backup = await createWorkspaceBackup({
    files: [
      { path: "src/index.mjs", content: bytes("export const ok = true;\n") },
      { path: "README.md", content: bytes("# private project\n") }
    ],
    subject: SUBJECT,
    workspaceRoot: "/workspace/project",
    passphrase: PASSPHRASE,
    createdAt: new Date("2026-07-13T01:02:03.000Z"),
    crypto: webcrypto
  });
  const serialized = new TextDecoder().decode(backup);
  assert.equal(serialized.includes("private project"), false);
  assert.equal(serialized.includes("export const ok"), false);

  const decoded = await decodeWorkspaceBackup({
    backup,
    passphrase: PASSPHRASE,
    expectedSubject: SUBJECT,
    crypto: webcrypto
  });
  assert.equal(decoded.manifest.format, WORKSPACE_BACKUP_FORMAT);
  assert.equal(decoded.manifest.version, WORKSPACE_BACKUP_VERSION);
  assert.equal(decoded.manifest.encrypted, true);
  assert.deepEqual(decoded.manifest.workspace, { root: "/workspace/project", files: 2, bytes: 42 });
  assert.deepEqual(decoded.files.map((file) => [file.path, new TextDecoder().decode(file.content)]), [
    ["README.md", "# private project\n"],
    ["src/index.mjs", "export const ok = true;\n"]
  ]);

  await assert.rejects(
    decodeWorkspaceBackup({ backup, passphrase: "wrong passphrase still long", expectedSubject: SUBJECT, crypto: webcrypto }),
    (error) => error instanceof WorkspaceBackupError && error.code === "decryption_failed"
  );
  await assert.rejects(
    decodeWorkspaceBackup({
      backup,
      passphrase: PASSPHRASE,
      expectedSubject: { ...SUBJECT, workspaceId: "other" },
      crypto: webcrypto
    }),
    (error) => error instanceof WorkspaceBackupError && error.code === "subject_mismatch"
  );
});

test("rejects ciphertext tampering, traversal, duplicate paths, and removed-runtime backups", async () => {
  const backup = await createWorkspaceBackup({
    files: [{ path: "safe.txt", content: bytes("safe") }],
    subject: SUBJECT,
    workspaceRoot: "/workspace/project",
    passphrase: PASSPHRASE,
    crypto: webcrypto
  });
  const envelope = JSON.parse(new TextDecoder().decode(backup));
  const ciphertext = Uint8Array.from(atob(envelope.ciphertext.data), (character) => character.charCodeAt(0));
  ciphertext[0] ^= 1;
  envelope.ciphertext.data = btoa(String.fromCharCode(...ciphertext));
  const tampered = new TextEncoder().encode(JSON.stringify(envelope));
  await assert.rejects(
    decodeWorkspaceBackup({ backup: tampered, passphrase: PASSPHRASE, expectedSubject: SUBJECT, crypto: webcrypto }),
    (error) => error.code === "ciphertext_integrity_failed"
  );
  await assert.rejects(
    createWorkspaceBackup({
      files: [{ path: "../escape", content: bytes("no") }],
      subject: SUBJECT,
      workspaceRoot: "/workspace/project",
      passphrase: PASSPHRASE,
      crypto: webcrypto
    }),
    (error) => error.code === "invalid_workspace_file"
  );
  await assert.rejects(
    createWorkspaceBackup({
      files: [],
      subject: SUBJECT,
      workspaceRoot: "/etc/not-a-user-workspace",
      passphrase: PASSPHRASE,
      crypto: webcrypto
    }),
    (error) => error.code === "invalid_workspace_root"
  );
  await assert.rejects(
    createWorkspaceBackup({
      files: [
        { path: "same.txt", content: bytes("one") },
        { path: "same.txt", content: bytes("two") }
      ],
      subject: SUBJECT,
      workspaceRoot: "/workspace/project",
      passphrase: PASSPHRASE,
      crypto: webcrypto
    }),
    (error) => error.code === "invalid_workspace_file"
  );
  await assert.rejects(
    decodeWorkspaceBackup({
      backup: bytes("CLAWBKP1removed-runtime-state"),
      passphrase: PASSPHRASE,
      expectedSubject: SUBJECT,
      crypto: webcrypto
    }),
    (error) => error.code === "legacy_runtime_backup_unsupported"
  );
});

test("migrates the checked BrowserPod v1 fixture into an encrypted v2 envelope", async () => {
  const fixture = await readFile(new URL("./test-fixtures/workspace-backup-v1.json", import.meta.url));
  const migrated = await migrateLegacyWorkspaceSnapshot({
    snapshot: fixture,
    expectedSubject: SUBJECT,
    passphrase: PASSPHRASE,
    createdAt: new Date("2026-07-13T02:00:00.000Z"),
    crypto: webcrypto
  });
  assert.equal(new TextDecoder().decode(migrated).includes("Migrated workspace"), false);
  const decoded = await decodeWorkspaceBackup({
    backup: migrated,
    passphrase: PASSPHRASE,
    expectedSubject: SUBJECT,
    crypto: webcrypto
  });
  assert.deepEqual(decoded.files.map((file) => [file.path, new TextDecoder().decode(file.content)]), [
    ["README.md", "# Migrated workspace\n"],
    ["src/index.mjs", "export const ok = true;\n"]
  ]);
});

test("exports and restores a real binary user workspace through the BrowserPod file boundary", async (t) => {
  const { runtime, hostPath, exchangeDocuments } = await createLocalNodeBrowserPodRuntime(t);
  const workspaceRoot = "/workspace/project";
  const exchangeRoot = "/workspace/.clawsembly/workspace-backup";
  await mkdir(hostPath(`${workspaceRoot}/src`), { recursive: true });
  await writeFile(hostPath(`${workspaceRoot}/README.md`), "# secret workspace\n", "utf8");
  await writeFile(hostPath(`${workspaceRoot}/src/data.bin`), Uint8Array.of(0, 1, 2, 255));
  const audits = [];
  const backup = await exportBrowserPodWorkspace({
    runtime,
    subject: SUBJECT,
    workspaceRoot,
    exchangeRoot,
    passphrase: PASSPHRASE,
    idFactory: () => "workspace_export_0001",
    now: () => new Date("2026-07-13T03:00:00.000Z"),
    onAudit: (event) => audits.push(event),
    crypto: webcrypto
  });
  assert.equal(new TextDecoder().decode(backup).includes("secret workspace"), false);
  await rm(hostPath(workspaceRoot), { recursive: true, force: true });

  const restored = await restoreBrowserPodWorkspace({
    runtime,
    backup,
    expectedSubject: SUBJECT,
    workspaceRoot,
    exchangeRoot,
    passphrase: PASSPHRASE,
    idFactory: () => "workspace_restore_0001",
    onAudit: (event) => audits.push(event),
    crypto: webcrypto
  });
  assert.deepEqual(restored, { files: 2, bytes: 23, root: workspaceRoot, complete: true });
  assert.equal(await readFile(hostPath(`${workspaceRoot}/README.md`), "utf8"), "# secret workspace\n");
  assert.deepEqual(new Uint8Array(await readFile(hostPath(`${workspaceRoot}/src/data.bin`))), Uint8Array.of(0, 1, 2, 255));
  assert.equal(exchangeDocuments.length >= 2, true);
  assert.equal(exchangeDocuments.some((document) => document.includes("secret workspace")), false);
  const auditText = JSON.stringify(audits);
  assert.equal(auditText.includes("secret workspace"), false);
  assert.equal(auditText.includes("README.md"), false);
  assert.equal(auditText.includes(PASSPHRASE), false);

  await assert.rejects(
    restoreBrowserPodWorkspace({
      runtime,
      backup,
      expectedSubject: SUBJECT,
      workspaceRoot,
      exchangeRoot,
      passphrase: PASSPHRASE,
      idFactory: () => "workspace_restore_0002",
      crypto: webcrypto
    }),
    (error) => error.code === "helper_failed"
  );
});

test("rejects short passphrases, foreign exchange roots, and mismatched migration subjects", async () => {
  await assert.rejects(
    createWorkspaceBackup({
      files: [],
      subject: SUBJECT,
      workspaceRoot: "/workspace/project",
      passphrase: "too short",
      crypto: webcrypto
    }),
    (error) => error instanceof WorkspaceBackupError && error.code === "invalid_passphrase"
  );
  const fixture = await readFile(new URL("./test-fixtures/workspace-backup-v1.json", import.meta.url));
  await assert.rejects(
    migrateLegacyWorkspaceSnapshot({
      snapshot: fixture,
      expectedSubject: { ...SUBJECT, workspaceId: "other" },
      passphrase: PASSPHRASE,
      crypto: webcrypto
    }),
    (error) => error.code === "subject_mismatch"
  );
  const runtime = createFakeRuntime({ onStart: () => { throw new Error("must not start"); } });
  await assert.rejects(
    exportBrowserPodWorkspace({
      runtime,
      subject: SUBJECT,
      workspaceRoot: "/workspace/project",
      exchangeRoot: "/workspace/elsewhere",
      passphrase: PASSPHRASE,
      crypto: webcrypto
    }),
    (error) => error.code === "invalid_exchange_root"
  );
});

test("fails closed when the helper completes without a result record", async () => {
  const runtime = createFakeRuntime({
    onStart: () => createFakeTask({ id: "helper-task", status: "completed", transcript: "unrelated output\n" })
  });
  await assert.rejects(
    exportBrowserPodWorkspace({
      runtime,
      subject: SUBJECT,
      workspaceRoot: "/workspace/project",
      passphrase: PASSPHRASE,
      crypto: webcrypto
    }),
    (error) => error.code === "helper_output_missing"
  );
});
