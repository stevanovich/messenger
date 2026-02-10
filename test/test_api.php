<?php
/**
 * Тест API endpoints
 * Использование: откройте в браузере test/test_api.php
 */

echo "<h1>Тест API</h1>";

// URL из текущего хоста (без хардкода домена)
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$basePath = dirname(dirname($_SERVER['SCRIPT_NAME'] ?? ''));
$baseUrl = $scheme . '://' . $host . rtrim($basePath, '/') . '/api/';

echo "<h2>1. Тест auth.php без авторизации:</h2>";
echo "<p>GET запрос: {$baseUrl}auth.php?action=me</p>";
echo "<p>Ожидаемый ответ: {\"error\":\"Не авторизован\"}</p>";

// Тест через curl если доступен
if (function_exists('curl_init')) {
    $ch = curl_init($baseUrl . 'auth.php?action=me');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    echo "<p><strong>HTTP код:</strong> {$httpCode}</p>";
    echo "<p><strong>Ответ:</strong></p>";
    echo "<pre>" . htmlspecialchars($response) . "</pre>";
    
    $decoded = json_decode($response, true);
    if ($decoded && isset($decoded['error'])) {
        echo "<p style='color: green;'>✓ API возвращает правильную ошибку для неавторизованного пользователя</p>";
    } else {
        echo "<p style='color: orange;'>⚠ Неожиданный ответ от API</p>";
    }
} else {
    echo "<p style='color: orange;'>⚠ cURL не доступен. Используйте браузер или curl вручную:</p>";
    echo "<pre>curl {$baseUrl}auth.php?action=me</pre>";
}

echo "<h2>2. Проверка существования API файлов:</h2>";
$apiFiles = [
    'auth.php',
    'conversations.php',
    'messages.php',
    'users.php',
    'upload.php',
    'analytics.php'
];

echo "<table border='1' cellpadding='5'>";
echo "<tr><th>Файл</th><th>Существует</th></tr>";

foreach ($apiFiles as $file) {
    $path = __DIR__ . '/../api/' . $file;
    $exists = file_exists($path) ? '✓' : '✗';
    $color = file_exists($path) ? 'green' : 'red';
    
    echo "<tr>";
    echo "<td>{$file}</td>";
    echo "<td style='color: {$color};'>{$exists}</td>";
    echo "</tr>";
}

echo "</table>";

echo "<h2>3. Проверка структуры API файлов:</h2>";
foreach ($apiFiles as $file) {
    $path = __DIR__ . '/../api/' . $file;
    if (file_exists($path)) {
        $content = file_get_contents($path);
        $hasJsonHeader = strpos($content, "Content-Type: application/json") !== false || 
                         strpos($content, "jsonResponse") !== false ||
                         strpos($content, "jsonError") !== false;
        $hasSession = strpos($content, "session_start") !== false;
        
        echo "<h3>{$file}:</h3>";
        echo "<ul>";
        echo "<li>JSON заголовок: " . ($hasJsonHeader ? '✓' : '⚠') . "</li>";
        echo "<li>Сессии: " . ($hasSession ? '✓' : '⚠') . "</li>";
        echo "</ul>";
    }
}
