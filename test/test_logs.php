<?php
/**
 * Проверка настроек логирования
 * Использование: откройте в браузере test/test_logs.php
 */

echo "<h1>Проверка настроек логирования</h1>";

echo "<h2>Настройки PHP:</h2>";
echo "<table border='1' cellpadding='5'>";
echo "<tr><th>Параметр</th><th>Значение</th></tr>";

$logSettings = [
    'error_log' => ini_get('error_log'),
    'log_errors' => ini_get('log_errors') ? 'On' : 'Off',
    'display_errors' => ini_get('display_errors') ? 'On' : 'Off',
    'error_reporting' => error_reporting(),
];

foreach ($logSettings as $key => $value) {
    echo "<tr>";
    echo "<td><strong>{$key}</strong></td>";
    echo "<td>" . ($value !== false ? htmlspecialchars($value) : 'Not set') . "</td>";
    echo "</tr>";
}

echo "</table>";

echo "<h2>Тест записи в лог:</h2>";

$testMessage = "Messenger Debug Test - " . date('Y-m-d H:i:s');
if (error_log($testMessage)) {
    echo "<p style='color: green;'>✓ Сообщение записано в лог</p>";
    echo "<p><strong>Тестовое сообщение:</strong> {$testMessage}</p>";
    if (ini_get('error_log')) {
        echo "<p><strong>Путь к логу:</strong> " . ini_get('error_log') . "</p>";
    } else {
        echo "<p><strong>Лог:</strong> Используется системный лог (проверьте логи веб-сервера)</p>";
    }
} else {
    echo "<p style='color: red;'>✗ Не удалось записать в лог</p>";
}

echo "<h2>Информация о логах веб-сервера:</h2>";
echo "<p>Проверьте логи в зависимости от вашего веб-сервера:</p>";
echo "<ul>";
echo "<li><strong>Apache:</strong> /var/log/apache2/error.log или /var/log/httpd/error_log</li>";
echo "<li><strong>Nginx:</strong> /var/log/nginx/error.log</li>";
echo "<li><strong>PHP-FPM:</strong> /var/log/php-fpm/error.log</li>";
echo "</ul>";

echo "<h2>Команды для проверки логов:</h2>";
echo "<pre>";
echo "# Проверить последние ошибки:\n";
echo "tail -n 50 /var/log/apache2/error.log\n";
echo "# или\n";
echo "tail -n 50 /var/log/nginx/error.log\n";
echo "\n";
echo "# Следить за логами в реальном времени:\n";
echo "tail -f /var/log/apache2/error.log\n";
echo "</pre>";

echo "<h2>Временный файл для отладки:</h2>";
$tempDir = sys_get_temp_dir();
$debugLog = $tempDir . '/messenger_debug.log';

echo "<p><strong>Временная папка:</strong> {$tempDir}</p>";
echo "<p><strong>Файл отладки:</strong> {$debugLog}</p>";

if (is_writable($tempDir)) {
    $testDebugMessage = date('Y-m-d H:i:s') . " - Test debug message\n";
    if (file_put_contents($debugLog, $testDebugMessage, FILE_APPEND)) {
        echo "<p style='color: green;'>✓ Можно записывать в временный файл отладки</p>";
        echo "<p>Последние 10 строк файла:</p>";
        if (file_exists($debugLog)) {
            $lines = file($debugLog);
            $lastLines = array_slice($lines, -10);
            echo "<pre>";
            echo htmlspecialchars(implode('', $lastLines));
            echo "</pre>";
        }
    } else {
        echo "<p style='color: orange;'>⚠ Не удалось записать в временный файл</p>";
    }
} else {
    echo "<p style='color: orange;'>⚠ Временная папка недоступна для записи</p>";
}
