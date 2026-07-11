import fs, { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

const fsBigIntAdapterMarker = Symbol.for("clawsembly.fs-bigint-position-adapter");

export function installFsBigIntPositionAdapter() {
  if (fs.readSync[fsBigIntAdapterMarker]) return;
  const originalReadSync = fs.readSync;
  function readSyncWithBigIntPosition(...args) {
    if (typeof args[4] === "bigint") {
      const position = Number(args[4]);
      if (!Number.isSafeInteger(position)) throw new RangeError("fs.readSync position exceeds safe integer range");
      args[4] = position;
    }
    return Reflect.apply(originalReadSync, this, args);
  }
  Object.defineProperty(readSyncWithBigIntPosition, fsBigIntAdapterMarker, { value: true });
  fs.readSync = readSyncWithBigIntPosition;
  Module.syncBuiltinESMExports?.();
}

function normalizeBoundValue(value) {
  if (typeof value !== "bigint") return value;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError("BigInt parameter exceeds sql.js safe integer range");
  return number;
}

function normalizeParameters(values) {
  if (values.length === 0) return undefined;
  if (values.length === 1 && (Array.isArray(values[0]) || (values[0] && typeof values[0] === "object"))) {
    if (Array.isArray(values[0])) return values[0].map(normalizeBoundValue);
    return Object.fromEntries(Object.entries(values[0]).map(([key, value]) => [key, normalizeBoundValue(value)]));
  }
  return values.map(normalizeBoundValue);
}

export async function installNodeSqlitePolyfill() {
  installFsBigIntPositionAdapter();
  const requireFromAdapter = Module.createRequire(import.meta.url);
  const wasmPath = requireFromAdapter.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({
    locateFile() { return wasmPath; }
  });

  class StatementSync {
    constructor(owner, sourceSQL) {
      this.owner = owner;
      this.sourceSQL = sourceSQL;
      this.readBigInts = false;
    }

    columns() {
      const statement = this.owner.database.prepare(this.sourceSQL);
      try {
        return statement.getColumnNames().map((name) => ({
          column: name,
          database: null,
          name,
          originName: name,
          table: null
        }));
      } finally {
        statement.free();
      }
    }

    all(...values) {
      const statement = this.owner.database.prepare(this.sourceSQL);
      const rows = [];
      try {
        const parameters = normalizeParameters(values);
        if (parameters !== undefined) statement.bind(parameters);
        while (statement.step()) {
          const row = statement.getAsObject();
          if (this.readBigInts) {
            for (const [key, value] of Object.entries(row)) {
              if (typeof value === "number" && Number.isInteger(value)) row[key] = BigInt(value);
            }
          }
          rows.push(row);
        }
        return rows;
      } finally {
        statement.free();
      }
    }

    get(...values) {
      return this.all(...values)[0];
    }

    *iterate(...values) {
      for (const row of this.all(...values)) yield row;
    }

    run(...values) {
      const statement = this.owner.database.prepare(this.sourceSQL);
      try {
        const parameters = normalizeParameters(values);
        if (parameters !== undefined) statement.bind(parameters);
        while (statement.step()) {
          // Consume rows for statements such as INSERT ... RETURNING.
        }
      } finally {
        statement.free();
      }
      const changes = this.owner.database.getRowsModified();
      const lastInsert = this.owner.database.exec("SELECT last_insert_rowid() AS id");
      const lastInsertRowid = Number(lastInsert[0]?.values[0]?.[0] ?? 0);
      this.owner.persist();
      return this.readBigInts
        ? { changes: BigInt(changes), lastInsertRowid: BigInt(lastInsertRowid) }
        : { changes, lastInsertRowid };
    }

    setAllowBareNamedParameters() {
      return this;
    }

    setReadBigInts(enabled) {
      this.readBigInts = Boolean(enabled);
      return this;
    }
  }

  class DatabaseSync {
    constructor(pathname = ":memory:", options = {}) {
      this.path = pathname;
      this.readOnly = Boolean(options.readOnly);
      this.isOpen = true;
      this.transactionDepth = 0;
      const existing = pathname !== ":memory:" && existsSync(pathname) ? readFileSync(pathname) : undefined;
      this.database = existing ? new SQL.Database(existing) : new SQL.Database();
      this.persist();
    }

    exec(sql) {
      this.assertOpen();
      const command = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase();
      this.database.run(sql);
      if (command === "BEGIN") {
        this.transactionDepth += 1;
        return;
      }
      if (command === "COMMIT" || command === "ROLLBACK") {
        this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      }
      this.persist();
    }

    prepare(sql) {
      this.assertOpen();
      return new StatementSync(this, sql);
    }

    close() {
      if (!this.isOpen) return;
      this.persist(true);
      this.database.close();
      this.isOpen = false;
    }

    persist(force = false) {
      if (!this.isOpen || this.readOnly || this.path === ":memory:" || (!force && this.transactionDepth > 0)) return;
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, this.database.export());
    }

    assertOpen() {
      if (!this.isOpen) throw new Error("database is not open");
    }
  }

  const sqliteModule = { DatabaseSync, StatementSync };
  const originalLoad = Module._load;
  Module._load = function loadWithBrowserSqlite(request, parent, isMain) {
    if (request === "node:sqlite") return sqliteModule;
    return originalLoad.call(this, request, parent, isMain);
  };

  return sqliteModule;
}
