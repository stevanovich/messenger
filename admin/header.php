<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= isset($pageTitle) ? escape($pageTitle) . ' — Админ' : 'Админ-панель' ?></title>
    <link rel="icon" type="image/svg+xml" href="<?= BASE_URL ?>assets/favicon.svg">
    <link rel="stylesheet" href="<?= BASE_URL ?>assets/css/main.css">
    <link rel="stylesheet" href="<?= BASE_URL ?>assets/css/admin.css">
</head>
<body class="admin-body">
    <nav class="admin-nav">
        <div class="admin-nav-inner">
            <a href="<?= BASE_URL ?>admin/index.php" class="admin-nav-logo">Админ</a>
            <div class="admin-nav-links">
                <?php foreach ($adminNav as $file => $label): ?>
                    <a href="<?= BASE_URL ?>admin/<?= $file ?>" class="<?= basename($_SERVER['PHP_SELF']) === $file ? 'active' : '' ?>"><?= escape($label) ?></a>
                <?php endforeach; ?>
            </div>
            <div class="admin-nav-user">
                <span><?= escape(getCurrentUser()['username'] ?? '') ?></span>
                <a href="<?= BASE_URL ?>">Мессенджер</a>
                <a href="<?= BASE_URL ?>logout.php">Выход</a>
            </div>
        </div>
    </nav>
    <main class="admin-main">
