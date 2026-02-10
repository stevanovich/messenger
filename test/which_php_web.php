<?php
/**
 * Какой PHP использует веб-сервер (Web Station) и есть ли pdo_mysql.
 * Откройте в браузере: https://ваш-домен/sites/messenger/test/which_php_web.php
 * Путь к бинарнику (если выведен) подставьте в config.php: WEBSOCKET_PHP_PATH
 */
header('Content-Type: text/plain; charset=utf-8');

echo "=== PHP веб-сервера (тот, что обрабатывает сайт) ===\n\n";
echo "Версия: " . PHP_VERSION . "\n";
echo "SAPI:   " . php_sapi_name() . "\n";

if (defined('PHP_BINARY') && PHP_BINARY !== '') {
    echo "Бинарник (PHP_BINARY): " . PHP_BINARY . "\n";
    echo "\nМодули этого PHP (pdo*):\n";
    $out = [];
    @exec(escapeshellarg(PHP_BINARY) . ' -m 2>&1', $out);
    foreach ($out as $line) {
        if (stripos($line, 'pdo') !== false) echo "  $line\n";
    }
    if (empty($out)) echo "  (не удалось выполнить)\n";
} else {
    echo "PHP_BINARY не задан (типично для Apache/PHP-FPM).\n";
}

echo "\nЗагруженные расширения (pdo*):\n";
$ext = array_filter(get_loaded_extensions(), function ($e) {
    return stripos($e, 'pdo') !== false;
});
sort($ext);
foreach ($ext as $e) {
    echo "  - $e\n";
}

$has = extension_loaded('pdo_mysql');
echo "\npdo_mysql загружен: " . ($has ? 'ДА' : 'НЕТ') . "\n";

if ($has) {
    echo "\nЭтот PHP (веб-сервер) умеет работать с MySQL.\n";
    echo "Чтобы запускать WebSocket тем же PHP, найдите путь к этому бинарнику на NAS:\n";
    echo "  find /var/packages /usr/local -name php -type f 2>/dev/null\n";
    echo "  /найденный/путь/php -m | grep pdo_mysql\n";
    echo "Если у одного из них есть pdo_mysql — задайте его в config.php: WEBSOCKET_PHP_PATH\n";
}
