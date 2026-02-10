<?php
/**
 * Проверка путей и конфигурации
 * Использование: откройте в браузере test/test_paths.php
 */

require_once __DIR__ . '/../config/config.php';

echo "<h1>Проверка путей и конфигурации</h1>";

echo "<h2>Константы:</h2>";
echo "<table border='1' cellpadding='5'>";
echo "<tr><th>Константа</th><th>Значение</th><th>Статус</th></tr>";

$paths = [
    'ROOT_PATH' => ROOT_PATH,
    'BASE_URL' => BASE_URL,
    'UPLOAD_PATH' => UPLOAD_PATH,
    'UPLOAD_URL' => UPLOAD_URL,
];

foreach ($paths as $name => $path) {
    $status = '✓';
    $color = 'green';
    
    if ($name === 'UPLOAD_PATH') {
        if (!is_dir($path)) {
            $status = '⚠';
            $color = 'orange';
        }
        if (!is_writable($path)) {
            $status = '✗';
            $color = 'red';
        }
    }
    
    echo "<tr>";
    echo "<td><strong>{$name}</strong></td>";
    echo "<td>" . htmlspecialchars($path) . "</td>";
    echo "<td style='color: {$color};'>{$status}</td>";
    echo "</tr>";
}

echo "</table>";

echo "<h2>Проверка папок:</h2>";
echo "<table border='1' cellpadding='5'>";
echo "<tr><th>Папка</th><th>Существует</th><th>Доступна для записи</th></tr>";

$dirs = [
    'ROOT_PATH' => ROOT_PATH,
    'UPLOAD_PATH' => UPLOAD_PATH,
    'UPLOAD_PATH/images' => UPLOAD_PATH . 'images/',
    'UPLOAD_PATH/documents' => UPLOAD_PATH . 'documents/',
];

foreach ($dirs as $name => $dir) {
    $exists = is_dir($dir) ? '✓' : '✗';
    $writable = is_writable($dir) ? '✓' : '✗';
    $existsColor = is_dir($dir) ? 'green' : 'red';
    $writableColor = is_writable($dir) ? 'green' : 'red';
    
    echo "<tr>";
    echo "<td>{$name}</td>";
    echo "<td style='color: {$existsColor};'>{$exists}</td>";
    echo "<td style='color: {$writableColor};'>{$writable}</td>";
    echo "</tr>";
}

echo "</table>";

// Проверка создания папок
echo "<h2>Автоматическое создание папок:</h2>";
if (!is_dir(UPLOAD_PATH)) {
    if (mkdir(UPLOAD_PATH, 0755, true)) {
        echo "<p style='color: green;'>✓ Создана папка: " . UPLOAD_PATH . "</p>";
    } else {
        echo "<p style='color: red;'>✗ Не удалось создать папку: " . UPLOAD_PATH . "</p>";
    }
}

$subdirs = ['images', 'documents'];
foreach ($subdirs as $subdir) {
    $path = UPLOAD_PATH . $subdir . '/';
    if (!is_dir($path)) {
        if (mkdir($path, 0755, true)) {
            echo "<p style='color: green;'>✓ Создана папка: {$path}</p>";
        } else {
            echo "<p style='color: red;'>✗ Не удалось создать папку: {$path}</p>";
        }
    } else {
        echo "<p style='color: green;'>✓ Папка существует: {$path}</p>";
    }
}
