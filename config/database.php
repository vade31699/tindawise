<?php
/**
 * SQLite bootstrap: opens (and creates on first run) the local database file
 * and makes sure every table the app needs exists.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Returns a shared PDO connection to the local SQLite database.
 */
function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0775, true);
    }

    $pdo = new PDO('sqlite:' . DB_FILE, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    // Pragmas that keep a single-file database fast and crash safe.
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    install_schema($pdo);
    seed_defaults($pdo);

    return $pdo;
}

/**
 * Creates every table if it does not exist yet. Safe to run on each request.
 */
function install_schema(PDO $pdo): void
{
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS products (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            sku           TEXT,
            category      TEXT    NOT NULL DEFAULT '',
            cost_price    REAL    NOT NULL DEFAULT 0,   -- buying price per piece
            selling_price REAL    NOT NULL DEFAULT 0,   -- retail price per piece
            stock_qty     REAL    NOT NULL DEFAULT 0,   -- stock counted in single pieces
            pack_size     INTEGER NOT NULL DEFAULT 1,   -- pieces per bulk pack (for restocking)
            created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku IS NOT NULL AND sku <> \'\'');

    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS transactions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            reference     TEXT    NOT NULL UNIQUE,      -- human readable receipt number
            item_count    INTEGER NOT NULL DEFAULT 0,
            total_amount  REAL    NOT NULL DEFAULT 0,   -- what the customer paid
            total_cost    REAL    NOT NULL DEFAULT 0,   -- cost of the goods sold
            profit        REAL    NOT NULL DEFAULT 0,   -- total_amount - total_cost
            cash_received REAL    NOT NULL DEFAULT 0,
            change_due    REAL    NOT NULL DEFAULT 0,
            sold_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            sale_date     TEXT    NOT NULL              -- YYYY-MM-DD, used by reports
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(sale_date)');

    $pdo->exec(<<<SQL
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
            line_profit  REAL    NOT NULL DEFAULT 0
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transaction_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_items_product ON transaction_items(product_id)');

    // Audit trail for items removed from a completed sale. The sale itself keeps
    // the reduced totals, so reports stay net of refunds without extra columns.
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS sale_voids (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            item_id         INTEGER,
            product_name    TEXT    NOT NULL,
            qty             REAL    NOT NULL DEFAULT 0,  -- pieces handed back
            unit_price      REAL    NOT NULL DEFAULT 0,  -- price per piece refunded
            refund_amount   REAL    NOT NULL DEFAULT 0,  -- unit_price * qty
            cost_price      REAL    NOT NULL DEFAULT 0,  -- cost of the returned goods
            reason          TEXT    NOT NULL DEFAULT '',
            voided_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_voids_transaction ON sale_voids(transaction_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_voids_voided_at ON sale_voids(voided_at)');

    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    SQL);
}

/**
 * Writes the default settings row set the very first time the app runs.
 */
function seed_defaults(PDO $pdo): void
{
    $defaults = [
        'store_name'   => 'My Sari-Sari Store',
        'owner_name'   => '',
        'currency'     => DEFAULT_CURRENCY,
        'low_stock'    => (string) DEFAULT_LOW_STOCK,
        'receipt_footer' => 'Thank you, come again!',
    ];

    $stmt = $pdo->prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (:key, :value)');
    foreach ($defaults as $key => $value) {
        $stmt->execute([':key' => $key, ':value' => $value]);
    }
}
