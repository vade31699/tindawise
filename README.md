# Store POS — offline mobile web app

A mobile-first point-of-sale and inventory system for small stores that runs **completely
offline** on plain PHP, SQLite, HTML, CSS and vanilla JavaScript. No internet, no accounts,
no build step — the whole store lives in one SQLite file on the device.

## Requirements

- PHP 8.0+ with the `pdo_sqlite` extension (XAMPP / Laragon / WAMP / `php -S` all qualify)
- Any modern mobile or desktop browser

## Running it

**Quickest (built-in server):**

```bash
php -S 0.0.0.0:8000
```

then open `http://localhost:8000/home.php` (or `http://<your-pc-ip>:8000/home.php` from a phone
on the same Wi-Fi).

**With XAMPP:** copy this folder into `htdocs/`, start Apache, and open
`http://localhost/store-pos/home.php`.

The first page load creates `data/store.sqlite` with all tables and default settings.

## Modules

| Page | What it does |
| --- | --- |
| `home.php` | Dashboard: today's sales/profit, last-7-days bar chart, stock alerts, recent sales |
| `inventory.php` | Searchable item list (live JS filter), add/update items, quick "receive stock" by packs, CSV import/export |
| `pos.php` | Tap-to-add product grid, quantity steppers, live total/profit/change, AJAX checkout, printable receipt |
| `reports.php` | Date-range revenue, cost, net profit, margin, best sellers, daily breakdown, CSV export |
| `settings.php` | Store name, cashier, currency symbol, low-stock level, receipt footer, database backup |

Profit is always computed as `selling_price − cost_price` per piece, stored per sale line, and
re-aggregated for reports — so the dashboard, reports and receipt can never disagree.

## Data model (`config/database.php`)

- **products** — name, sku, category, `cost_price` (buying), `selling_price` (retail),
  `stock_qty` (counted in single pieces), `pack_size` (pieces per bulk pack)
- **transactions** — reference, item_count, total_amount, total_cost, `profit`,
  cash_received, `change_due`, sold_at, sale_date
- **transaction_items** — one row per sold line: qty, cost, price, line_total, line_profit
  (sales history is independent of the catalog, so deleting an item never corrupts reports)
- **settings** — key/value store for store details

## CSV files

Inventory import/export uses this column order (download the template from
Inventory → CSV → Template):

```
name,sku,category,cost_price,selling_price,stock_qty,pack_size
"Bear Brand 300ml",BB300,Drinks,21.50,26.00,24,6
```

- **Merge mode** (default): rows whose `sku` already exists are updated, everything else is added.
- **Replace mode**: clears the catalog, then imports the file.
- Sales exports: one row per sale, or one row per line item (`Line items` button).
- Files start with a UTF-8 BOM so Excel opens the currency and item names correctly.

## Backups

Settings → *Back up database* downloads the SQLite file. Copy it to a USB drive or a
cloud-synced folder; restoring is just putting the file back in `data/store.sqlite`.
`data/.htaccess` blocks direct web access to it.

## File map

```
home.php · inventory.php · pos.php · reports.php · settings.php   pages
api.php                                                           JSON + CSV endpoint (all actions)
config/config.php · config/database.php                           constants, PDO connection, schema installer
includes/functions.php · includes/reports.php                     helpers + sales aggregation
includes/header.php · includes/footer.php                         app shell (header, bottom nav, scripts)
assets/css/app.css                                               design system
assets/js/*.js                                                   app.js shared helpers + one module per page
data/                                                            SQLite database (created on first run)
```
