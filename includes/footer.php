</main>

<nav class="bottom-nav" aria-label="Main navigation">
  <?php foreach ($nav_items as $item): ?>
    <a href="<?= e($item['file']) ?>" class="<?= $active_nav === $item['file'] ? 'is-active' : '' ?>"
       <?= $active_nav === $item['file'] ? 'aria-current="page"' : '' ?>>
      <span class="nav-icon" aria-hidden="true"><?= $item['icon'] ?></span>
      <span><?= e($item['label']) ?></span>
    </a>
  <?php endforeach; ?>
</nav>

<div class="toast-host" id="toast-host" role="status" aria-live="polite"></div>

<script src="assets/js/app.js?v=<?= e(APP_VERSION) ?>"></script>
<?php foreach (($page_scripts ?? []) as $script): ?>
  <script src="<?= e($script) ?>?v=<?= e(APP_VERSION) ?>"></script>
<?php endforeach; ?>
</body>
</html>
