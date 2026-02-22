<?php
/**
 * Админка: настройки алгоритмов E2EE (криптография).
 * Список и порядок алгоритмов шифрования. Сохраняет в config/e2ee_algorithms.php.
 */
$pageTitle = 'Криптография';
require_once __DIR__ . '/common.php';

$configPath = dirname(__DIR__) . '/config/e2ee_algorithms.php';
$examplePath = dirname(__DIR__) . '/config/e2ee_algorithms.example.php';
$optionsPath = dirname(__DIR__) . '/config/e2ee_options.php';
$optionsExamplePath = dirname(__DIR__) . '/config/e2ee_options.example.php';

/** Разрешённые идентификаторы алгоритмов (совпадает с api/keys.php). */
$ALLOWED_ALGORITHMS = ['ECDH-P256-AES-GCM', 'GOST-Kuznechik-MGM', 'GOST-Magma-MGM'];

function loadE2EEOptions($optionsPath, $optionsExamplePath) {
    $path = is_file($optionsPath) ? $optionsPath : $optionsExamplePath;
    if (!is_file($path)) {
        return 'ECDH-P256';
    }
    $opts = include $path;
    if (!is_array($opts) || !isset($opts['gost_key_agreement'])) {
        return 'ECDH-P256';
    }
    $v = trim((string) $opts['gost_key_agreement']);
    return in_array($v, [ 'ECDH-P256', 'GOST-R-34.10' ], true) ? $v : 'ECDH-P256';
}

function loadAlgorithmsConfig($configPath, $examplePath) {
    global $ALLOWED_ALGORITHMS;
    $path = is_file($configPath) ? $configPath : $examplePath;
    if (!is_file($path)) {
        return ['ECDH-P256-AES-GCM'];
    }
    $list = include $path;
    if (!is_array($list)) {
        return ['ECDH-P256-AES-GCM'];
    }
    $result = [];
    foreach ($list as $a) {
        $a = is_string($a) ? trim($a) : '';
        if ($a !== '' && in_array($a, $ALLOWED_ALGORITHMS, true) && !in_array($a, $result, true)) {
            $result[] = $a;
        }
    }
    return $result !== [] ? $result : ['ECDH-P256-AES-GCM'];
}

$currentList = loadAlgorithmsConfig($configPath, $examplePath);
$currentGostKeyAgreement = loadE2EEOptions($optionsPath, $optionsExamplePath);
$saved = false;
$saveError = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $order1 = trim((string) ($_POST['order1'] ?? ''));
    $order2 = trim((string) ($_POST['order2'] ?? ''));
    $order3 = trim((string) ($_POST['order3'] ?? ''));
    $collected = array_filter([$order1, $order2, $order3]);
    $collected = array_values(array_unique($collected));
    $valid = [];
    foreach ($collected as $algo) {
        if (in_array($algo, $ALLOWED_ALGORITHMS, true)) {
            $valid[] = $algo;
        }
    }
    if ($valid === []) {
        $valid = ['ECDH-P256-AES-GCM'];
    }
    $lines = [];
    foreach ($valid as $algo) {
        $lines[] = "    '" . addslashes($algo) . "',";
    }
    $content = "<?php\n/**\n * Список алгоритмов E2EE (порядок = приоритет). Сгенерировано из админки.\n * Клиент выбирает первый общий алгоритм с собеседником по этому порядку.\n */\nreturn [\n" . implode("\n", $lines) . "\n];\n";
    $gostKeyAgreement = trim((string) ($_POST['gost_key_agreement'] ?? 'ECDH-P256'));
    if (!in_array($gostKeyAgreement, [ 'ECDH-P256', 'GOST-R-34.10' ], true)) {
        $gostKeyAgreement = 'ECDH-P256';
    }
    $optionsContent = "<?php\n/**\n * Настройки E2EE (согласование ключей для ГОСТ). Сгенерировано из админки.\n */\nreturn [\n    'gost_key_agreement' => '" . addslashes($gostKeyAgreement) . "',\n];\n";
    if (file_put_contents($configPath, $content) !== false) {
        if (file_put_contents($optionsPath, $optionsContent) !== false) {
            $saved = true;
            $currentList = loadAlgorithmsConfig($configPath, $examplePath);
            $currentGostKeyAgreement = loadE2EEOptions($optionsPath, $optionsExamplePath);
        } else {
            $saved = true;
            $currentList = loadAlgorithmsConfig($configPath, $examplePath);
            $saveError = 'Алгоритмы сохранены. Не удалось записать config/e2ee_options.php — проверьте права.';
        }
    } else {
        $saveError = 'Не удалось записать файл. Проверьте права на каталог config/.';
    }
}

$baseUrl = defined('BASE_URL') ? BASE_URL : '/';
include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Криптография (E2EE)</h1>
<p class="admin-description">Список и порядок алгоритмов шифрования. Клиент получает его при загрузке и выбирает первый общий алгоритм с собеседником. Первый в списке — высший приоритет. Изменения применяются без перезапуска.</p>

<?php if ($saved): ?>
<p class="admin-message admin-message--success">Настройки сохранены.</p>
<?php endif; ?>
<?php if ($saveError): ?>
<p class="admin-message admin-message--error"><?= escape($saveError) ?></p>
<?php endif; ?>

<form method="post" class="admin-form">
    <div class="admin-form-section">
        <h2>Порядок алгоритмов (приоритет)</h2>
        <p class="admin-hint">Выберите алгоритм для каждой позиции. Пустая позиция — не используется. Должен быть выбран хотя бы один алгоритм.</p>
        <?php
        $sel = [
            'order1' => $currentList[0] ?? '',
            'order2' => $currentList[1] ?? '',
            'order3' => $currentList[2] ?? '',
        ];
        foreach (['order1' => '1 (высший)', 'order2' => '2', 'order3' => '3'] as $name => $label):
            $val = $sel[$name] ?? '';
        ?>
        <div class="admin-form-row">
            <label class="admin-label" for="<?= $name ?>">Позиция <?= escape($label) ?></label>
            <select class="admin-input admin-select" id="<?= $name ?>" name="<?= $name ?>">
                <option value="">— не использовать —</option>
                <?php foreach ($ALLOWED_ALGORITHMS as $algo): ?>
                <option value="<?= escape($algo) ?>"<?= $val === $algo ? ' selected' : '' ?>><?= escape($algo) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <?php endforeach; ?>
    </div>
    <div class="admin-form-section">
        <h2>Согласование ключей для ГОСТ</h2>
        <p class="admin-hint">При использовании алгоритмов GOST-Kuznechik-MGM и GOST-Magma-MGM общий секрет можно получать по ECDH P-256 либо по ГОСТ Р 34.10-2012 (VKO). Оба варианта поддерживаются в клиенте.</p>
        <div class="admin-form-row">
            <label class="admin-label" for="gost_key_agreement">Способ согласования ключа</label>
            <select class="admin-input admin-select" id="gost_key_agreement" name="gost_key_agreement">
                <option value="ECDH-P256"<?= $currentGostKeyAgreement === 'ECDH-P256' ? ' selected' : '' ?>>ECDH P-256 (рекомендуется)</option>
                <option value="GOST-R-34.10"<?= $currentGostKeyAgreement === 'GOST-R-34.10' ? ' selected' : '' ?>>ГОСТ Р 34.10-2012 (VKO)</option>
            </select>
        </div>
    </div>
    <div class="admin-form-section">
        <h2>Справка</h2>
        <ul class="admin-list admin-list--bullets">
            <li><strong>ECDH-P256-AES-GCM</strong> — рекомендуется оставить первым для обратной совместимости.</li>
            <li><strong>GOST-Kuznechik-MGM</strong> — ГОСТ Р 34.12 (Кузнечик), режим MGM (RFC 9058).</li>
            <li><strong>GOST-Magma-MGM</strong> — ГОСТ Р 34.12 (Магма, 64-бит блок), режим MGM (RFC 9058).</li>
        </ul>
    </div>
    <div class="admin-form-actions">
        <button type="submit" class="admin-btn admin-btn-primary">Сохранить</button>
    </div>
</form>

<?php include __DIR__ . '/footer.php'; ?>
