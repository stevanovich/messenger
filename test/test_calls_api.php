<?php
/**
 * Проверка API звонков (Этап 2). Проверяет наличие действий и структуру без БД.
 * Полная проверка: после миграции и входа в мессенджер откройте в консоли браузера:
 *   fetch(API_BASE + '/api/calls.php?action=config', {credentials:'include'}).then(r=>r.json()).then(console.log)
 * (API_BASE задаётся в app.js — с подпапкой, например /sites/messenger). Ожидается: { success: true, data: { call_mode, user_uuid, sip_uri, stun, ... } }
 */
$apiPath = __DIR__ . '/../api/calls.php';
if (!is_file($apiPath)) {
    echo "FAIL: api/calls.php не найден.\n";
    exit(1);
}

$code = file_get_contents($apiPath);
$requiredActions = ['config', 'token', 'history', 'start', 'end'];
foreach ($requiredActions as $action) {
    if (strpos($code, "'{$action}'") === false && strpos($code, "\"{$action}\"") === false) {
        echo "FAIL: в api/calls.php не найдено действие '{$action}'.\n";
        exit(1);
    }
}

$requiredInConfig = ['call_mode', 'user_uuid', 'sip_uri', 'stun'];
foreach ($requiredInConfig as $key) {
    if (strpos($code, $key) === false) {
        echo "FAIL: в api/calls.php в ответе config не найден ключ '{$key}'.\n";
        exit(1);
    }
}

// Проверка синтаксиса
exec('php -l ' . escapeshellarg($apiPath) . ' 2>&1', $out, $ret);
if ($ret !== 0) {
    echo "FAIL: синтаксис PHP: " . implode("\n", $out) . "\n";
    exit(1);
}

echo "OK: api/calls.php — синтаксис корректен, действия config, token, history, start, end присутствуют.\n";
echo "Напоминание: выполните миграцию: php tools/run_calls_migration.php\n";
exit(0);
