<?php
/**
 * Shared helpers used by both the HTML pages and the JSON/CSV API.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/database.php';

/** Escape a value for safe HTML output. */
function e($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Read one setting value (cached for the duration of the request). */
function setting(string $key, string $default = ''): string
{
    static $cache = null;

    if ($cache === null) {
        $cache = [];
        foreach (db()->query('SELECT key, value FROM settings') as $row) {
            $cache[$row['key']] = $row['value'];
        }
    }

    return $cache[$key] ?? $default;
}

/** Persist a setting value. */
function save_setting(string $key, string $value): void
{
    $stmt = db()->prepare(
        'INSERT INTO settings (key, value) VALUES (:key, :value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    $stmt->execute([':key' => $key, ':value' => $value]);
}

/** The active currency symbol, e.g. "₱" or "$". */
function currency(): string
{
    return setting('currency', DEFAULT_CURRENCY);
}

/** Currency symbol plus a thousands-separated, 2 decimal amount. */
function money($amount, bool $withSymbol = true): string
{
    $formatted = number_format((float) $amount, 2);
    return $withSymbol ? currency() . $formatted : $formatted;
}

/** Number without trailing zeros, for stock quantities / item counts. */
function qty($value): string
{
    $value = (float) $value;
    return $value == (int) $value ? (string) (int) $value : rtrim(rtrim(number_format($value, 3, '.', ''), '0'), '.');
}

/** Format a YYYY-MM-DD (or datetime) string for display. */
function nice_date(?string $value): string
{
    if (!$value) {
        return '—';
    }
    $ts = strtotime($value);
    return $ts ? date('M j, Y', $ts) : $value;
}

/** Build the current URL path (used to highlight the active nav item). */
function current_page(): string
{
    return basename($_SERVER['SCRIPT_NAME'] ?? 'home.php');
}

/** True when the request came in over fetch()/XHR with a JSON body. */
function is_api_request(): bool
{
    return str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json')
        || ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'XMLHttpRequest';
}

/** Send a JSON response and stop. */
function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Send an error as JSON (used by the API endpoints). */
function json_error(string $message, int $status = 400): void
{
    json_response(['ok' => false, 'error' => $message], $status);
}

/**
 * Decode the JSON request body, falling back to form-encoded POST data so the
 * same endpoints work with a normal <form> as well.
 */
function request_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }
    return $_POST;
}

/** Validate + normalise a product payload coming from the UI or a CSV row. */
function normalise_product(array $data): array
{
    $name = trim((string) ($data['name'] ?? ''));
    if ($name === '') {
        throw new InvalidArgumentException('Item name is required.');
    }

    $cost    = round((float) ($data['cost_price'] ?? 0), 2);
    $selling = round((float) ($data['selling_price'] ?? 0), 2);
    $stock   = round((float) ($data['stock_qty'] ?? 0), 3);
    $pack    = (int) ($data['pack_size'] ?? 1);

    if ($cost < 0 || $selling < 0) {
        throw new InvalidArgumentException('Prices cannot be negative.');
    }
    if ($pack < 1) {
        $pack = 1;
    }

    return [
        'name'          => $name,
        'sku'           => trim((string) ($data['sku'] ?? '')),
        'category'      => trim((string) ($data['category'] ?? '')),
        'cost_price'    => $cost,
        'selling_price' => $selling,
        'stock_qty'     => $stock,
        'pack_size'     => $pack,
    ];
}

/** Generate a receipt number such as 20260922-0007. */
function next_reference(PDO $pdo, string $saleDate): string
{
    $stmt = $pdo->prepare('SELECT COUNT(*) AS c FROM transactions WHERE sale_date = :d');
    $stmt->execute([':d' => $saleDate]);
    $count = (int) $stmt->fetchColumn() + 1;

    return date('Ymd', strtotime($saleDate)) . '-' . str_pad((string) $count, 4, '0', STR_PAD_LEFT);
}

/** Stock health label used by badges in the UI. */
function stock_status(float $qty, float $lowStock): array
{
    if ($qty <= 0) {
        return ['out', 'Out of stock'];
    }
    if ($qty <= $lowStock) {
        return ['low', 'Low stock'];
    }
    return ['ok', 'In stock'];
}
