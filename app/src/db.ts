/**
 * SQLite bootstrap — the on-device counterpart of config/database.php.
 *
 * Opens (and creates on first launch) the app's private SQLite database and
 * makes sure every table the app needs exists. The SQL is copied verbatim from
 * the PHP original so both versions share an identical schema.
 */

import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { DB_NAME, DEFAULT_CURRENCY, DEFAULT_LOW_STOCK } from './config';

/** Thrown for anything the user did wrong (maps to the PHP 422 responses). */
export class ValidationError extends Error {}

export type Row = Record<string, any>;

/** Connection factory. `createConnection` fails if the handle already exists,
 *  so every open goes through isConnection/retrieveConnection first. */
const sqlite = new SQLiteConnection(CapacitorSQLite);

let dbPromise: Promise<SQLiteDBConnection> | null = null;

/** Returns the shared connection, opening and migrating it on first use. */
export function db(): Promise<SQLiteDBConnection> {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLiteDBConnection> {
  await sqlite.checkConnectionsConsistency().catch(() => ({ result: true }));

  const existing = await sqlite.isConnection(DB_NAME, false).catch(() => ({ result: false }));

  const conn = existing.result
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  const open = await conn.isDBOpen().catch(() => ({ result: false }));
  if (!open.result) {
    await conn.open();
  }

  // Before anything else: a transaction left open by a crash would make the
  // plugin's own beginTransaction() calls below fail with "Already in
  // transaction".
  await clearStaleTransaction(conn);
  ownsTransaction = false;

  await applyPragmas(conn);

  try {
    await installSchema(conn);
  } catch (err) {
    throw new Error(`Could not create the app tables: ${message(err)}`);
  }

  try {
    await ensureColumns(conn);
  } catch (err) {
    throw new Error(`Could not upgrade the database: ${message(err)}`);
  }

  try {
    await seedDefaults(conn);
  } catch (err) {
    throw new Error(`Could not write the default settings: ${message(err)}`);
  }

  return conn;
}

/** Best-effort message extraction for wrapped errors. */
function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Connection settings the database actually ended up with, for the Settings page. */
let activePragmas: Record<string, any> = {};

/** The pragmas SQLite is really using right now. */
export function pragmas(): Record<string, any> {
  return activePragmas;
}

/**
 * Mirrors the three pragmas from config/database.php so the on-device database
 * behaves exactly like the PHP one: fast, crash safe, and with cascading
 * deletes actually firing.
 *
 * These MUST go through `query()`, never `execute()`: Android's execSQL()
 * refuses any statement that returns rows, and `PRAGMA journal_mode = WAL`
 * plus `PRAGMA busy_timeout = N` both return a row. Failure here is reported in
 * Settings rather than thrown, so a missing WAL journal cannot stop the app
 * from starting.
 */
async function applyPragmas(conn: SQLiteDBConnection): Promise<void> {
  const statements = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA foreign_keys = ON',
    'PRAGMA busy_timeout = 5000',
  ];

  for (const statement of statements) {
    try {
      await conn.query(statement);
    } catch (err) {
      activePragmas.failed = `${statement} — ${message(err)}`;
      console.warn(`[db] ${statement} failed:`, err);
    }
  }

  for (const pragma of ['journal_mode', 'foreign_keys', 'busy_timeout']) {
    const res = await conn.query(`PRAGMA ${pragma}`).catch(() => null);
    const row = (res?.values ?? [])[0] as Row | undefined;
    activePragmas[pragma] = row ? Object.values(row)[0] : null;
  }
}

/**
 * Confirms the database file is readable and not corrupt. Cheap enough to run
 * on every launch — a few thousand rows is microseconds of work.
 */
export async function integrityCheck(): Promise<string> {
  const value = await scalar('PRAGMA integrity_check');
  return typeof value === 'string' ? value : 'unknown';
}

/** Runs a SELECT and returns every row. */
export async function all(sql: string, values: any[] = []): Promise<Row[]> {
  const conn = await db();
  const res = await conn.query(sql, values);
  return (res.values ?? []) as Row[];
}

/** Runs a SELECT and returns the first row, or null. */
export async function one(sql: string, values: any[] = []): Promise<Row | null> {
  const rows = await all(sql, values);
  return rows.length ? rows[0] : null;
}

/** Runs a SELECT and returns a single scalar from the first column. */
export async function scalar(sql: string, values: any[] = []): Promise<any> {
  const row = await one(sql, values);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length ? row[keys[0]] : null;
}

/**
 * True while this module owns an open transaction.
 *
 * The plugin's `run()`/`execute()` take an optional `transaction` flag that
 * DEFAULTS TO TRUE, and Android implements it as a literal `beginTransaction()`
 * around the statement. Nesting one inside a transaction we already own is
 * refused with "Already in transaction", so every write has to tell the plugin
 * whether *it* should open the transaction.
 */
let ownsTransaction = false;

/** Runs an INSERT/UPDATE/DELETE. Resolves to { changes, lastId }. */
export async function exec(
  sql: string,
  values: any[] = []
): Promise<{ changes: number; lastId: number }> {
  const conn = await db();
  // true  -> the plugin wraps this single statement in its own transaction
  // false -> we are inside begin()/commit() already, so it must not
  const res = await conn.run(sql, values, !ownsTransaction);
  return {
    changes: res.changes?.changes ?? 0,
    lastId: res.changes?.lastId ?? 0,
  };
}

/** Rolls back a transaction left open by a crash or a failed earlier attempt. */
async function clearStaleTransaction(conn: SQLiteDBConnection): Promise<void> {
  try {
    if ((await conn.isTransactionActive()).result) {
      console.warn('[db] rolling back a transaction left open by an earlier error');
      await conn.rollbackTransaction();
    }
  } catch (err) {
    console.warn('[db] stale rollback failed:', message(err));
  }
}

/**
 * Opens a transaction. Any transaction still open from a previous failure is
 * rolled back first, so a single bad sale cannot wedge every later one.
 * Use with commit()/rollback(), never the plugin methods directly.
 */
export async function begin(conn: SQLiteDBConnection): Promise<void> {
  await clearStaleTransaction(conn);
  await conn.beginTransaction();
  ownsTransaction = true;
}

/** Commits the transaction opened by begin(). */
export async function commit(conn: SQLiteDBConnection): Promise<void> {
  try {
    await conn.commitTransaction();
  } finally {
    ownsTransaction = false;
  }
}

/** Undoes the transaction opened by begin(). Never masks the original error. */
export async function rollback(conn: SQLiteDBConnection): Promise<void> {
  ownsTransaction = false;
  try {
    if ((await conn.isTransactionActive()).result) {
      await conn.rollbackTransaction();
    }
  } catch (err) {
    console.warn('[db] rollback failed:', message(err));
  }
}

/**
 * Creates every table if it does not exist yet. Safe to run on each launch.
 * The SQL matches config/database.php exactly.
 *
 * `execute()` is correct here: CREATE TABLE/INDEX return no rows, which is what
 * Android's execSQL() requires.
 */
async function installSchema(conn: SQLiteDBConnection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS products (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        sku           TEXT,
        category      TEXT    NOT NULL DEFAULT '',
        cost_price    REAL    NOT NULL DEFAULT 0,
        selling_price REAL    NOT NULL DEFAULT 0,
        stock_qty     REAL    NOT NULL DEFAULT 0,
        pack_size     INTEGER NOT NULL DEFAULT 1,
        pack_price    REAL    NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku IS NOT NULL AND sku <> '';

    CREATE TABLE IF NOT EXISTS transactions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        reference     TEXT    NOT NULL UNIQUE,
        item_count    INTEGER NOT NULL DEFAULT 0,
        total_amount  REAL    NOT NULL DEFAULT 0,
        total_cost    REAL    NOT NULL DEFAULT 0,
        profit        REAL    NOT NULL DEFAULT 0,
        cash_received REAL    NOT NULL DEFAULT 0,
        change_due    REAL    NOT NULL DEFAULT 0,
        sold_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
        sale_date     TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(sale_date);

    CREATE TABLE IF NOT EXISTS transaction_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        product_id   INTEGER,
        product_name TEXT    NOT NULL,
        qty          REAL    NOT NULL DEFAULT 0,
        cost_price   REAL    NOT NULL DEFAULT 0,
        selling_price REAL   NOT NULL DEFAULT 0,
        discount     REAL    NOT NULL DEFAULT 0,
        line_total   REAL    NOT NULL DEFAULT 0,
        line_profit  REAL    NOT NULL DEFAULT 0,
        unit         TEXT    NOT NULL DEFAULT 'pc'
    );
    CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_items_product ON transaction_items(product_id);

    CREATE TABLE IF NOT EXISTS sale_voids (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        item_id         INTEGER,
        product_name    TEXT    NOT NULL,
        qty             REAL    NOT NULL DEFAULT 0,
        unit_price      REAL    NOT NULL DEFAULT 0,
        refund_amount   REAL    NOT NULL DEFAULT 0,
        cost_price      REAL    NOT NULL DEFAULT 0,
        reason          TEXT    NOT NULL DEFAULT '',
        unit            TEXT    NOT NULL DEFAULT 'pc',
        voided_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_voids_transaction ON sale_voids(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_voids_voided_at ON sale_voids(voided_at);

    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
  `);
}

/**
 * Adds columns introduced after a table was first created. CREATE TABLE IF
 * NOT EXISTS cannot change an existing table, so without this an upgraded app
 * would crash on the first INSERT that mentions the new column.
 */
const COLUMN_UPGRADES: Array<{ table: string; column: string; definition: string }> = [
  { table: 'products', column: 'pack_price', definition: 'REAL NOT NULL DEFAULT 0' },
  { table: 'transaction_items', column: 'unit', definition: "TEXT NOT NULL DEFAULT 'pc'" },
  { table: 'sale_voids', column: 'unit', definition: "TEXT NOT NULL DEFAULT 'pc'" },
];

async function ensureColumns(conn: SQLiteDBConnection): Promise<void> {
  for (const upgrade of COLUMN_UPGRADES) {
    const res = await conn.query(`PRAGMA table_info(${upgrade.table})`);
    const columns = (res.values ?? []).map((row) => String((row as Row).name ?? '').toLowerCase());
    if (!columns.includes(upgrade.column.toLowerCase())) {
      await conn.execute(
        `ALTER TABLE ${upgrade.table} ADD COLUMN ${upgrade.column} ${upgrade.definition}`
      );
    }
  }
}

/** Writes the default settings rows the very first time the app runs. */
async function seedDefaults(conn: SQLiteDBConnection): Promise<void> {
  const defaults: Record<string, string> = {
    store_name: 'My Sari-Sari Store',
    owner_name: '',
    currency: DEFAULT_CURRENCY,
    low_stock: String(DEFAULT_LOW_STOCK),
    receipt_footer: 'Thank you, come again!',
  };

  for (const [key, value] of Object.entries(defaults)) {
    // Explicit `true`: the plugin wraps this one insert in its own transaction
    // (we are still inside openAndMigrate, so db()/exec() cannot be used).
    await conn.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value], true);
  }
}