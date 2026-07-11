import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installFsBigIntPositionAdapter, installNodeSqlitePolyfill } from "./node-sqlite-polyfill.mjs";

test("fs adapter accepts Node-compatible bigint read positions", () => {
  installFsBigIntPositionAdapter();
  const file = new URL("./node-sqlite-polyfill.test.mjs", import.meta.url);
  const descriptor = fs.openSync(file, "r");
  try {
    const byte = Buffer.alloc(1);
    assert.equal(fs.readSync(descriptor, byte, 0, 1, 1n), 1);
    assert.equal(byte.toString(), "m");
  } finally {
    fs.closeSync(descriptor);
  }
});

test("setReadBigInts applies to rows and run metadata", async () => {
  await installNodeSqlitePolyfill();
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)");
  const insert = database.prepare("INSERT INTO records (value) VALUES (?)");
  insert.setReadBigInts(true);
  const result = insert.run(42n);
  assert.deepEqual(result, { changes: 1n, lastInsertRowid: 1n });

  const select = database.prepare("SELECT id, value FROM records");
  select.setReadBigInts(true);
  assert.deepEqual(select.get(), { id: 1n, value: 42n });
  database.close();
});

test("transactions persist only committed rows across close and reopen", async (t) => {
  await installNodeSqlitePolyfill();
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "clawsembly-sqlite-"));
  const pathname = join(directory, "state.sqlite");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let database = new DatabaseSync(pathname);
  database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)");
  database.exec("BEGIN");
  database.prepare("INSERT INTO records (value) VALUES (?)").run(10);
  database.exec("ROLLBACK");
  database.close();

  database = new DatabaseSync(pathname);
  const countAfterRollback = database.prepare("SELECT COUNT(*) AS count FROM records");
  countAfterRollback.setReadBigInts(true);
  assert.deepEqual(countAfterRollback.get(), { count: 0n });
  database.exec("BEGIN");
  database.prepare("INSERT INTO records (value) VALUES (?)").run(20n);
  database.exec("COMMIT");
  database.close();

  database = new DatabaseSync(pathname, { readOnly: true });
  const committed = database.prepare("SELECT id, value FROM records");
  committed.setReadBigInts(true);
  assert.deepEqual(committed.all(), [{ id: 1n, value: 20n }]);
  database.close();
});
