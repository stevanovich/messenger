<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= isset($pageTitle) ? escape($pageTitle) . ' — ' . escape(t('admin.admin')) : escape(t('admin.panel')) ?></title>
    <link rel="icon" type="image/svg+xml" href="<?= BASE_URL ?>assets/favicon.svg">
    <link rel="stylesheet" href="<?= BASE_URL ?>assets/css/main.css">
    <link rel="stylesheet" href="<?= BASE_URL ?>assets/css/admin.css">
    <?php if (!empty($additionalCSS) && is_array($additionalCSS)): ?>
        <?php foreach ($additionalCSS as $css): ?>
            <link rel="stylesheet" href="<?= BASE_URL . $css ?>?v=<?= file_exists(__DIR__ . '/../' . $css) ? filemtime(__DIR__ . '/../' . $css) : '0' ?>">
        <?php endforeach; ?>
    <?php endif; ?>
</head>
<body class="admin-body" data-twemoji-enabled="<?php echo (function_exists('getTwemojiEnabled') && getTwemojiEnabled()) ? '1' : '0'; ?>">
    <nav class="admin-nav">
        <div class="admin-nav-inner">
            <a href="<?= BASE_URL ?>admin/index.php" class="admin-nav-logo"><?= escape(t('admin.admin')) ?></a>
            <?php
            $currentFile = basename($_SERVER['PHP_SELF']);
            $currentSection = null;
            foreach ($adminNav as $section => $items) {
                if (is_array($items) && array_key_exists($currentFile, $items)) {
                    $currentSection = $section;
                    break;
                }
            }
            ?>
            <div class="admin-nav-links">
                <?php foreach ($adminNav as $section => $items): ?>
                    <?php if (!is_array($items)) continue; ?>
                    <?php $firstFile = array_key_first($items); ?>
                    <a href="<?= BASE_URL ?>admin/<?= $firstFile ?>" class="admin-nav-root <?= $currentSection === $section ? 'active' : '' ?>"><?= escape($section) ?></a>
                <?php endforeach; ?>
            </div>
            <div class="admin-nav-user">
                <span><?= escape(getCurrentUser()['username'] ?? '') ?></span>
                <a href="<?= BASE_URL ?>"><?= escape(t('common.app_name')) ?></a>
                <a href="<?= BASE_URL ?>logout.php"><?= escape(t('profile.logout')) ?></a>
            </div>
        </div>
        <?php if ($currentSection !== null): ?>
        <div class="admin-nav-sub-wrap">
            <div class="admin-nav-sub-inner">
                <div class="admin-nav-sub">
                    <?php foreach ($adminNav[$currentSection] as $file => $label): ?>
                        <a href="<?= BASE_URL ?>admin/<?= $file ?>" class="<?= $currentFile === $file ? 'active' : '' ?>"><?= escape($label) ?></a>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
        <?php endif; ?>
    </nav>
    <main class="admin-main">
