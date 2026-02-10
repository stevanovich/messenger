<?php
/**
 * Тест подключения к базе данных
 * Использование: откройте в браузере test/test_db.php
 */

require_once __DIR__ . '/../config/database.php';

echo "<h1>Тест подключения к базе данных</h1>";

try {
    echo "<p style='color: green;'>✓ Подключение успешно!</p>";
    
    // Тест запроса
    $stmt = $pdo->query("SELECT 1 as test");
    $result = $stmt->fetch();
    echo "<p style='color: green;'>✓ Тестовый запрос выполнен: " . print_r($result, true) . "</p>";
    
    // Проверка таблиц
    echo "<h2>Проверка таблиц:</h2>";
    $stmt = $pdo->query("SHOW TABLES");
    $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    
    $expectedTables = [
        'users',
        'conversations',
        'conversation_participants',
        'messages',
        'message_reactions',
        'stickers',
        'user_stickers',
        'analytics_events',
        'analytics_clicks',
        'sessions',
        'message_reads'
    ];
    
    echo "<p>Найдено таблиц: " . count($tables) . "</p>";
    echo "<ul>";
    foreach ($tables as $table) {
        $status = in_array($table, $expectedTables) ? '✓' : '?';
        echo "<li>{$status} {$table}</li>";
    }
    echo "</ul>";
    
    $missingTables = array_diff($expectedTables, $tables);
    if (!empty($missingTables)) {
        echo "<p style='color: orange;'>⚠ Отсутствующие таблицы:</p>";
        echo "<ul>";
        foreach ($missingTables as $table) {
            echo "<li>{$table}</li>";
        }
        echo "</ul>";
    } else {
        echo "<p style='color: green;'>✓ Все необходимые таблицы присутствуют!</p>";
    }
    
} catch (PDOException $e) {
    echo "<p style='color: red;'>✗ Ошибка: " . htmlspecialchars($e->getMessage()) . "</p>";
    echo "<p>Проверьте:</p>";
    echo "<ul>";
    echo "<li>База данных messenger_db создана</li>";
    echo "<li>Пользователь messenger_mngr существует</li>";
    echo "<li>Пароль правильный</li>";
    echo "<li>Схема импортирована: mysql -u messenger_mngr -p messenger_db < sql/schema.sql</li>";
    echo "</ul>";
}
