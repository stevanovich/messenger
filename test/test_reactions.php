<?php
/**
 * Тестовый скрипт для проверки функционала реакций
 * Проверяет, можно ли добавить все типы эмодзи на одно сообщение
 */

session_start();
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: text/html; charset=utf-8');

echo "<h1>Тест реакций</h1>";

// Проверяем подключение к БД
try {
    global $pdo;
    
    // Проверяем структуру таблицы
    echo "<h2>1. Структура таблицы message_reactions</h2>";
    $stmt = $pdo->query("SHOW INDEX FROM message_reactions");
    $indexes = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo "<table border='1' cellpadding='5'>";
    echo "<tr><th>Key_name</th><th>Non_unique</th><th>Column_name</th></tr>";
    $hasProblematicIndex = false;
    foreach ($indexes as $idx) {
        $keyName = $idx['Key_name'];
        $nonUnique = (int)$idx['Non_unique'];
        $columnName = $idx['Column_name'];
        $isUnique = ($nonUnique === 0);
        
        // Проверяем, есть ли UNIQUE(message_id, user_uuid) без emoji
        if ($isUnique && $keyName !== 'PRIMARY' && $keyName !== 'message_user_emoji') {
            $stmt2 = $pdo->query("
                SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) as cols
                FROM information_schema.STATISTICS
                WHERE table_schema = DATABASE() 
                AND table_name = 'message_reactions' 
                AND index_name = '$keyName'
                GROUP BY index_name
            ");
            $colsRow = $stmt2->fetch();
            if ($colsRow && $colsRow['cols'] === 'message_id,user_uuid') {
                $hasProblematicIndex = true;
                echo "<tr style='background: #ffcccc;'><td>$keyName</td><td>$nonUnique (UNIQUE)</td><td>$columnName</td></tr>";
            } else {
                echo "<tr><td>$keyName</td><td>$nonUnique</td><td>$columnName</td></tr>";
            }
        } else {
            echo "<tr><td>$keyName</td><td>$nonUnique</td><td>$columnName</td></tr>";
        }
    }
    echo "</table>";
    
    if ($hasProblematicIndex) {
        echo "<p style='color: red;'><strong>ПРОБЛЕМА:</strong> Найден UNIQUE индекс по (message_id, user_uuid) без emoji. Это не позволит добавлять несколько реакций на одно сообщение.</p>";
    } else {
        echo "<p style='color: green;'><strong>OK:</strong> Нет проблемных индексов. Можно добавлять несколько реакций на одно сообщение.</p>";
    }
    
    // Проверяем примеры данных
    echo "<h2>2. Примеры данных</h2>";
    $stmt = $pdo->query("
        SELECT message_id, user_uuid, COUNT(*) as cnt, GROUP_CONCAT(emoji) as emojis
        FROM message_reactions
        GROUP BY message_id, user_uuid
        HAVING cnt > 1
        ORDER BY cnt DESC
        LIMIT 10
    ");
    $multiReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (empty($multiReactions)) {
        echo "<p style='color: orange;'>Нет примеров сообщений, где один пользователь оставил несколько реакций. Это может означать, что функционал еще не использовался, или есть ограничение в БД.</p>";
    } else {
        echo "<p style='color: green;'><strong>OK:</strong> Найдены примеры сообщений с несколькими реакциями от одного пользователя:</p>";
        echo "<table border='1' cellpadding='5'>";
        echo "<tr><th>message_id</th><th>user_uuid</th><th>Количество реакций</th><th>Эмодзи</th></tr>";
        foreach ($multiReactions as $r) {
            echo "<tr><td>{$r['message_id']}</td><td>" . substr($r['user_uuid'], 0, 8) . "...</td><td>{$r['cnt']}</td><td>{$r['emojis']}</td></tr>";
        }
        echo "</table>";
    }
    
    echo "<h2>3. Рекомендации</h2>";
    if ($hasProblematicIndex) {
        echo "<p style='color: red;'><strong>Требуется миграция:</strong> Удалите UNIQUE индекс по (message_id, user_uuid) и оставьте только UNIQUE(message_id, user_uuid, emoji).</p>";
        echo "<pre>ALTER TABLE message_reactions DROP INDEX имя_проблемного_индекса;</pre>";
    } else {
        echo "<p style='color: green;'><strong>Схема БД корректна.</strong> Функционал должен работать правильно.</p>";
    }
    
} catch (PDOException $e) {
    echo "<p style='color: red;'>Ошибка БД: " . htmlspecialchars($e->getMessage()) . "</p>";
}
