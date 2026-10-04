<?php
/**
 * Global configuration for the offline Store POS.
 * Everything here is plain PHP + SQLite: no internet connection required.
 */

declare(strict_types=1);

// Absolute path to the project root and the SQLite file that stores all data.
define('APP_ROOT', dirname(__DIR__));
define('DATA_DIR', APP_ROOT . DIRECTORY_SEPARATOR . 'data');
define('DB_FILE', DATA_DIR . DIRECTORY_SEPARATOR . 'store.sqlite');

// Fallback currency symbol used before the settings table is read.
define('DEFAULT_CURRENCY', '₱');

// App metadata
define('APP_NAME', 'Store POS');
define('APP_VERSION', '1.0.0');

// Stock is flagged as "low" when the quantity drops to/below this value
// (can be overridden per install from the Settings page).
define('DEFAULT_LOW_STOCK', 5);

// Values that describe the SQLite schema version, used by the installer.
define('SCHEMA_VERSION', 1);
