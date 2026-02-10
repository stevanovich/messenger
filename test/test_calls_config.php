<?php
/**
 * Проверка конфигурации звонков (Этап 1 плана SIP_CALLS_PLAN).
 * Убеждаемся, что константы заданы и логика call_mode корректна.
 * Запуск: в браузере test/test_calls_config.php или: php test/test_calls_config.php
 */

require_once __DIR__ . '/../config/config.php';

$errors = [];
$ok = [];

// 1. Константы должны быть определены
$constants = ['SIP_WS_URL', 'SIP_DOMAIN', 'SIP_STUN_URL', 'SIP_TURN_URL', 'SIP_TURN_USER', 'SIP_TURN_CREDENTIAL'];
foreach ($constants as $c) {
    if (!defined($c)) {
        $errors[] = "Константа {$c} не определена.";
    } else {
        $val = constant($c);
        $masked = in_array($c, ['SIP_TURN_CREDENTIAL'], true) ? (strlen($val) ? '***' : '') : $val;
        $ok[] = "{$c} = " . (strlen($masked) ? "'{$masked}'" : '(пусто)');
    }
}

// 2. STUN обязателен для WebRTC (по плану)
if (defined('SIP_STUN_URL') && trim(SIP_STUN_URL) === '') {
    $errors[] = "SIP_STUN_URL не должен быть пустым (нужен для WebRTC).";
} elseif (defined('SIP_STUN_URL')) {
    $ok[] = "STUN задан (обязательный минимум для браузера за NAT).";
}

// 3. Логика call_mode: пустой SIP_WS_URL => webrtc_only, иначе sip
$sip_ws_url = defined('SIP_WS_URL') ? trim(SIP_WS_URL) : '';
$expected_mode = $sip_ws_url === '' ? 'webrtc_only' : 'sip';
$ok[] = "Ожидаемый call_mode при текущем конфиге: {$expected_mode}";

// 4. При режиме sip должны быть заданы SIP_DOMAIN (для отображения/регистрации)
if ($expected_mode === 'sip' && defined('SIP_DOMAIN') && trim(SIP_DOMAIN) === '') {
    $errors[] = "При включённом SIP (SIP_WS_URL задан) желательно задать SIP_DOMAIN.";
}

$isCli = (php_sapi_name() === 'cli');
if ($isCli) {
    if (!empty($errors)) {
        foreach ($errors as $e) echo "[ОШИБКА] $e\n";
        exit(1);
    }
    foreach ($ok as $o) echo "[OK] $o\n";
    exit(0);
}

// Вывод в браузере
header('Content-Type: text/html; charset=utf-8');
echo "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Проверка конфига звонков</title></head><body>";
echo "<h1>Проверка конфигурации звонков (Этап 1)</h1>";
if (!empty($errors)) {
    echo "<ul style='color:red'>";
    foreach ($errors as $e) echo "<li>" . htmlspecialchars($e) . "</li>";
    echo "</ul><p>Этап 1: конфиг требует исправлений.</p>";
} else {
    echo "<p style='color:green'><strong>Все проверки пройдены.</strong></p>";
    echo "<ul>";
    foreach ($ok as $o) echo "<li>" . htmlspecialchars($o) . "</li>";
    echo "</ul>";
    echo "<p>Текущий режим: <code>" . htmlspecialchars($expected_mode) . "</code>. API <code>action=config</code> будет отдавать это значение в <code>call_mode</code>.</p>";
}
echo "</body></html>";
