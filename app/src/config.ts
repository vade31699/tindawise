/**
 * Global configuration — the on-device counterpart of config/config.php.
 *
 * Everything is local: no internet connection is required at any point.
 */

export const APP_NAME = 'Store POS';
export const APP_VERSION = '1.1.1';

/** Name of the SQLite database created inside the app's private storage. */
export const DB_NAME = 'store';

/** Fallback currency symbol used before the settings table is read. */
export const DEFAULT_CURRENCY = '₱';

/** Stock is flagged as "low" at/below this value until Settings says otherwise. */
export const DEFAULT_LOW_STOCK = 5;

/** Where the SQLite file physically lives inside the app sandbox. */
export const DB_PATH = `/data/data/APP_ID/databases/${DB_NAME}`;

/** Column order used by the inventory CSV export / import / template. */
export const CSV_HEADERS = [
  'name',
  'sku',
  'category',
  'cost_price',
  'selling_price',
  'stock_qty',
  'pack_size',
  'pack_price',
] as const;