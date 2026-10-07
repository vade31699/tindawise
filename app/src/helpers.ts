/**
 * Shared helpers — the on-device counterpart of includes/functions.php.
 *
 * The formatting functions intentionally mirror PHP's number_format() output so
 * the app looks identical to the browser version.
 */

import { all, db, exec, one, rollback as rollbackTx, Row, ValidationError } from './db';
import { DEFAULT_CURRENCY, DEFAULT_LOW_STOCK } from './config';

/* ------------------------------------------------------------------ dates */

/** Local YYYY-MM-DD (SQLite's 'localtime' modifier is not applied here). */
export function today(): string {
  return localDate(new Date());
}

/** Local YYYY-MM-DD for a Date, avoiding the UTC shift of toISOString(). */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local 'YYYY-MM-DD HH:MM:SS' — matches SQLite datetime('now','localtime'). */
export function localDateTime(d: Date): string {
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return `${localDate(d)} ${time}`;
}

/** Compact YYYYMMDD, used to build receipt numbers. */
export function compactDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

/** Shift a YYYY-MM-DD string by whole days. */
export function shiftDate(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** First day of the month for a YYYY-MM-DD string. */
export function monthStart(dateStr: string): string {
  return dateStr.slice(0, 8) + '01';
}

/** Parse 'YYYY-MM-DD' (or 'YYYY-MM-DD HH:MM:SS') into a local Date. */
export function parseDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return new Date(NaN);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? '0'),
    Number(m[5] ?? '0'),
    Number(m[6] ?? '0')
  );
}

/* ------------------------------------------------------------- formatting */

/** Thousands-separated amount with 2 decimals, matching PHP number_format(). */
export function num(value: any, decimals = 2): string {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Number without trailing zeros, for stock quantities / item counts. */
export function qty(value: any): string {
  const n = Number(value) || 0;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(3)));
}

/** Rounds like PHP's round(): half away from zero. */
export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  // Guard against binary representation drift (e.g. 1.005 * 100 = 100.49999).
  const fixed = Math.round(Number(scaled.toFixed(6)));
  return (value < 0 ? -fixed : fixed) / factor;
}

/* --------------------------------------------------------------- settings */

let settingsCache: Record<string, string> | null = null;

/** Reads one setting (cached for the lifetime of the app session). */
export async function setting(key: string, fallback = ''): Promise<string> {
  if (!settingsCache) {
    settingsCache = {};
    const rows = await all('SELECT key, value FROM settings');
    for (const row of rows) {
      settingsCache[String(row.key)] = String(row.value);
    }
  }
  return settingsCache[key] ?? fallback;
}

/** Persists a setting value. */
export async function saveSetting(key: string, value: string): Promise<void> {
  await exec(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
  if (settingsCache) {
    settingsCache[key] = value;
  }
}

/** Drops the cached settings so the next read hits the database. */
export function invalidateSettings(): void {
  settingsCache = null;
}

/** The configured low-stock threshold as a number. */
export async function lowStockThreshold(): Promise<number> {
  return Number(await setting('low_stock', String(DEFAULT_LOW_STOCK))) || 0;
}

/* -------------------------------------------------------------- validation */

export type ProductInput = {
  name?: any;
  sku?: any;
  category?: any;
  cost_price?: any;
  selling_price?: any;
  stock_qty?: any;
  pack_size?: any;
  pack_price?: any;
};

export type NormalisedProduct = {
  name: string;
  sku: string;
  category: string;
  cost_price: number;
  selling_price: number;
  stock_qty: number;
  pack_size: number;
  pack_price: number;
};

/** Validates + normalises a product payload coming from the UI or a CSV row. */
export function normaliseProduct(data: ProductInput): NormalisedProduct {
  const name = String(data.name ?? '').trim();
  if (name === '') {
    throw new ValidationError('Item name is required.');
  }

  const cost = round(Number(data.cost_price ?? 0), 2);
  const selling = round(Number(data.selling_price ?? 0), 2);
  const stock = round(Number(data.stock_qty ?? 0), 3);
  const packPrice = round(Number(data.pack_price ?? 0), 2);
  let pack = Math.trunc(Number(data.pack_size ?? 1));

  if (cost < 0 || selling < 0) {
    throw new ValidationError('Prices cannot be negative.');
  }
  if (packPrice < 0) {
    throw new ValidationError('The price per pack cannot be negative.');
  }
  if (!Number.isFinite(pack) || pack < 1) {
    pack = 1;
  }

  return {
    name,
    sku: String(data.sku ?? '').trim(),
    category: String(data.category ?? '').trim(),
    cost_price: cost,
    selling_price: selling,
    stock_qty: stock,
    pack_size: pack,
    pack_price: packPrice,
  };
}

/* ---------------------------------------------------------------- receipts */

/** Stock health label used by badges in the UI. */
export function stockStatus(
  quantity: number,
  lowStock: number
): { key: 'out' | 'low' | 'ok'; label: string } {
  if (quantity <= 0) return { key: 'out', label: 'Out of stock' };
  if (quantity <= lowStock) return { key: 'low', label: 'Low stock' };
  return { key: 'ok', label: 'In stock' };
}

/** Base receipt number such as 20260922-0007. */
export async function nextReference(saleDate: string): Promise<string> {
  const row = await one('SELECT COUNT(*) AS c FROM transactions WHERE sale_date = ?', [saleDate]);
  const count = Number(row?.c ?? 0) + 1;
  return `${compactDate(saleDate)}-${String(count).padStart(4, '0')}`;
}

/** Unique receipt number, retried in case two sales land in the same second. */
export async function makeReference(saleDate: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    let reference = await nextReference(saleDate);
    if (attempt > 0) {
      reference += `-${1 + Math.floor(Math.random() * 9)}`;
    }
    const clash = await one('SELECT 1 FROM transactions WHERE reference = ?', [reference]);
    if (!clash) return reference;
  }
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${saleDate}-${rand}`;
}

/** Ensures a transaction rollback can never mask the original error. */
export async function rollback(): Promise<void> {
  await rollbackTx(await db());
}

export { DEFAULT_CURRENCY };
export type { Row };