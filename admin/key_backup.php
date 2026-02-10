<?php
/**
 * Админка: настройки защиты ключей E2EE (этап 4).
 * Сохраняет в config/e2ee_key_backup.php.
 */
$pageTitle = 'Защита ключей';
require_once __DIR__ . '/common.php';

$configPath = dirname(__DIR__) . '/config/e2ee_key_backup.php';
$examplePath = dirname(__DIR__) . '/config/e2ee_key_backup.example.php';

function loadKeyBackupConfig($configPath, $examplePath) {
    $defaults = [
        'rate_limit_per_hour' => 10,
        'failures_before_lockout' => 5,
        'lockout_hours' => 24,
        'client_delay_base_sec' => 2,
        'client_delay_max_sec' => 300,
        'kdf_iterations' => 100000,
    ];
    $path = is_file($configPath) ? $configPath : $examplePath;
    if (is_file($path)) {
        $cfg = include $path;
        return is_array($cfg) ? array_merge($defaults, $cfg) : $defaults;
    }
    return $defaults;
}

$cfg = loadKeyBackupConfig($configPath, $examplePath);
$saved = false;
$saveError = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $rateLimit = (int) ($_POST['rate_limit_per_hour'] ?? 10);
    $failuresBeforeLockout = (int) ($_POST['failures_before_lockout'] ?? 5);
    $lockoutHours = (int) ($_POST['lockout_hours'] ?? 24);
    $clientDelayBase = (int) ($_POST['client_delay_base_sec'] ?? 2);
    $clientDelayMax = (int) ($_POST['client_delay_max_sec'] ?? 300);
    $kdfIterations = (int) ($_POST['kdf_iterations'] ?? 100000);

    $rateLimit = max(1, min(100, $rateLimit));
    $failuresBeforeLockout = max(1, min(50, $failuresBeforeLockout));
    $lockoutHours = max(1, min(720, $lockoutHours));
    $clientDelayBase = max(0, min(60, $clientDelayBase));
    $clientDelayMax = max(1, min(3600, $clientDelayMax));
    $kdfIterations = max(10000, min(1000000, $kdfIterations));

    $content = "<?php\n/**\n * Настройки защиты ключей E2EE (этап 4).\n * Сгенерировано из админки.\n */\nreturn [\n" .
        "    'rate_limit_per_hour' => " . $rateLimit . ",\n" .
        "    'failures_before_lockout' => " . $failuresBeforeLockout . ",\n" .
        "    'lockout_hours' => " . $lockoutHours . ",\n" .
        "    'client_delay_base_sec' => " . $clientDelayBase . ",\n" .
        "    'client_delay_max_sec' => " . $clientDelayMax . ",\n" .
        "    'kdf_iterations' => " . $kdfIterations . ",\n];\n";
    if (file_put_contents($configPath, $content) !== false) {
        $saved = true;
        $cfg = loadKeyBackupConfig($configPath, $examplePath);
    } else {
        $saveError = 'Не удалось записать файл. Проверьте права на каталог config/.';
    }
}

$baseUrl = defined('BASE_URL') ? BASE_URL : '/';
include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Защита ключей (E2EE)</h1>
<p class="admin-description">Параметры резервного копирования ключей под паролем и защиты от подбора пароля. Применяются без перезапуска.</p>

<?php if ($saved): ?>
<p class="admin-message admin-message--success">Настройки сохранены.</p>
<?php endif; ?>
<?php if ($saveError): ?>
<p class="admin-message admin-message--error"><?= escape($saveError) ?></p>
<?php endif; ?>

<form method="post" class="admin-form">
    <div class="admin-form-section">
        <h2>Сервер</h2>
        <div class="admin-form-row">
            <label class="admin-label" for="rate_limit_per_hour">Запросов blob в час на пользователя (rate limit)</label>
            <input class="admin-input" type="number" id="rate_limit_per_hour" name="rate_limit_per_hour" value="<?= (int)($cfg['rate_limit_per_hour'] ?? 10) ?>" min="1" max="100">
        </div>
        <div class="admin-form-row">
            <label class="admin-label" for="failures_before_lockout">Неудачных попыток до блокировки выдачи blob</label>
            <input class="admin-input" type="number" id="failures_before_lockout" name="failures_before_lockout" value="<?= (int)($cfg['failures_before_lockout'] ?? 5) ?>" min="1" max="50">
        </div>
        <div class="admin-form-row">
            <label class="admin-label" for="lockout_hours">Длительность блокировки (часы)</label>
            <input class="admin-input" type="number" id="lockout_hours" name="lockout_hours" value="<?= (int)($cfg['lockout_hours'] ?? 24) ?>" min="1" max="720">
        </div>
    </div>
    <div class="admin-form-section">
        <h2>Клиент (задержка после неверного пароля)</h2>
        <div class="admin-form-row">
            <label class="admin-label" for="client_delay_base_sec">Базовая задержка (сек)</label>
            <input class="admin-input" type="number" id="client_delay_base_sec" name="client_delay_base_sec" value="<?= (int)($cfg['client_delay_base_sec'] ?? 2) ?>" min="0" max="60">
        </div>
        <div class="admin-form-row">
            <label class="admin-label" for="client_delay_max_sec">Максимальная задержка (сек)</label>
            <input class="admin-input" type="number" id="client_delay_max_sec" name="client_delay_max_sec" value="<?= (int)($cfg['client_delay_max_sec'] ?? 300) ?>" min="1" max="3600">
        </div>
    </div>
    <div class="admin-form-section">
        <h2>KDF</h2>
        <div class="admin-form-row">
            <label class="admin-label" for="kdf_iterations">Итерации PBKDF2</label>
            <input class="admin-input" type="number" id="kdf_iterations" name="kdf_iterations" value="<?= (int)($cfg['kdf_iterations'] ?? 100000) ?>" min="10000" max="1000000">
        </div>
    </div>
    <div class="admin-form-actions">
        <button type="submit" class="admin-btn admin-btn-primary">Сохранить</button>
    </div>
</form>

<?php include __DIR__ . '/footer.php'; ?>
