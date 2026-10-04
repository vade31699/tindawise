<?php
/**
 * Shared page shell: <head>, sticky header and bottom navigation.
 * Pages set $page_title / $page_subtitle / $active_nav before including this.
 */

require_once __DIR__ . '/functions.php';

$page_title    = $page_title ?? APP_NAME;
$page_subtitle = $page_subtitle ?? (setting('store_name', APP_NAME));
$active_nav    = $active_nav ?? current_page();
$header_extra  = $header_extra ?? '';   // optional raw HTML buttons on the right
$body_class    = $body_class ?? '';     // extra utility class for the <body> tag

$nav_items = [
    ['file' => 'home.php',      'label' => 'Dashboard', 'icon' => '🏠'],
    ['file' => 'inventory.php', 'label' => 'Inventory', 'icon' => '📦'],
    ['file' => 'pos.php',       'label' => 'POS',       'icon' => '🛒'],
    ['file' => 'reports.php',   'label' => 'Reports',   'icon' => '📊'],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<meta name="theme-color" content="#3f5a8a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<title><?= e($page_title) ?> · <?= e(setting('store_name', APP_NAME)) ?></title>
<link rel="stylesheet" href="assets/css/app.css?v=<?= e(APP_VERSION) ?>">
</head>
<body class="<?= e($body_class) ?>">

<header class="app-header">
  <div class="app-header__titles">
    <h1><?= e($page_title) ?></h1>
    <span><?= e($page_subtitle) ?></span>
  </div>
  <?= $header_extra ?>
  <a class="app-header__action" href="settings.php" aria-label="Settings" title="Settings">⚙️</a>
</header>

<main class="page">
