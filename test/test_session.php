<?php
/**
 * Тест работы сессий
 * Использование: откройте в браузере test/test_session.php
 */

session_start();

echo "<h1>Тест сессий</h1>";

// Установка тестового значения
$_SESSION['test'] = 'value';
$_SESSION['test_time'] = date('Y-m-d H:i:s');

echo "<h2>Информация о сессии:</h2>";
echo "<p><strong>Session ID:</strong> " . session_id() . "</p>";
echo "<p><strong>Session Name:</strong> " . session_name() . "</p>";
echo "<p><strong>Session Save Path:</strong> " . ini_get('session.save_path') . "</p>";

echo "<h2>Тестовые значения:</h2>";
echo "<p><strong>test:</strong> " . ($_SESSION['test'] ?? 'not set') . "</p>";
echo "<p><strong>test_time:</strong> " . ($_SESSION['test_time'] ?? 'not set') . "</p>";

// Проверка записи
if (isset($_SESSION['test']) && $_SESSION['test'] === 'value') {
    echo "<p style='color: green;'>✓ Сессии работают корректно!</p>";
} else {
    echo "<p style='color: red;'>✗ Проблема с сессиями!</p>";
    echo "<p>Проверьте:</p>";
    echo "<ul>";
    echo "<li>Права на папку сессий: " . ini_get('session.save_path') . "</li>";
    echo "<li>Настройки session в php.ini</li>";
    echo "</ul>";
}

// Показать все данные сессии
echo "<h2>Все данные сессии:</h2>";
echo "<pre>";
print_r($_SESSION);
echo "</pre>";
