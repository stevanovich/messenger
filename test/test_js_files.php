<?php
/**
 * Проверка JavaScript файлов
 * Использование: откройте в браузере test/test_js_files.php
 */

require_once __DIR__ . '/../config/config.php';

echo "<h1>Проверка JavaScript файлов</h1>";

$jsFiles = [
    'assets/css/main.css',
    'assets/css/chat.css',
    'assets/js/app.js',
    'assets/js/chat.js',
    'assets/js/polling.js'
];

echo "<h2>Проверка наличия файлов:</h2>";
echo "<table border='1' cellpadding='5'>";
echo "<tr><th>Файл</th><th>Существует</th><th>Размер</th><th>URL</th></tr>";

foreach ($jsFiles as $file) {
    $path = __DIR__ . '/../' . $file;
    $exists = file_exists($path);
    $size = $exists ? filesize($path) : 0;
    $url = BASE_URL . $file;
    
    $status = $exists ? '✓' : '✗';
    $color = $exists ? 'green' : 'red';
    
    echo "<tr>";
    echo "<td>{$file}</td>";
    echo "<td style='color: {$color};'>{$status}</td>";
    echo "<td>" . ($exists ? number_format($size) . ' bytes' : '-') . "</td>";
    echo "<td><a href='{$url}' target='_blank'>{$url}</a></td>";
    echo "</tr>";
}

echo "</table>";

echo "<h2>Проверка загрузки через браузер:</h2>";
echo "<p>Откройте консоль браузера (F12) и проверьте:</p>";
echo "<ul>";
echo "<li>Наличие ошибок в консоли</li>";
echo "<li>Загрузку всех файлов во вкладке Network</li>";
echo "<li>Статус всех запросов (должен быть 200)</li>";
echo "</ul>";

echo "<h2>Ссылки для проверки:</h2>";
echo "<ul>";
foreach ($jsFiles as $file) {
    $url = BASE_URL . $file;
    echo "<li><a href='{$url}' target='_blank'>{$file}</a></li>";
}
echo "</ul>";
