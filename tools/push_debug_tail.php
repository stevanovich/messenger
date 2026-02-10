<?php
/**
 * Вывести последние строки отладочного журнала push.
 * Запуск: php tools/push_debug_tail.php [число_строк]
 * По умолчанию — последние 100 строк.
 */

$root = dirname(__DIR__);
$logFile = $root . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'push_debug.log';
$lines = (int) ($argv[1] ?? 100);
if ($lines < 1) $lines = 100;

if (!is_file($logFile)) {
    echo "Файл не найден: config/push_debug.log\n";
    echo "Включите PUSH_DEBUG в config/config.php и отправьте сообщение в чат.\n";
    exit(0);
}

$content = file_get_contents($logFile);
$all = explode("\n", $content);
$all = array_filter($all, function ($l) { return $l !== ''; });
$slice = array_slice($all, -$lines);
echo "--- Последние " . count($slice) . " строк " . $logFile . " ---\n";
echo implode("\n", $slice);
echo "\n";
