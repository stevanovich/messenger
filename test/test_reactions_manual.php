<?php
/**
 * Тестовый скрипт для проверки функционала реакций
 * Показывает, можно ли добавить все типы эмодзи на одно сообщение
 */

session_start();
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: text/html; charset=utf-8');

if (!isLoggedIn()) {
    die('Необходимо войти в систему');
}

$currentUserUuid = getCurrentUserUuid();
global $pdo;

echo "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Тест реакций</title>";
echo "<style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .test-section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
    .success { background: #d4edda; border-color: #c3e6cb; }
    .error { background: #f8d7da; border-color: #f5c6cb; }
    .info { background: #d1ecf1; border-color: #bee5eb; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f2f2f2; }
    .emoji { font-size: 1.5em; }
</style></head><body>";

echo "<h1>Тест функционала реакций</h1>";

// 1. Проверка структуры БД
echo "<div class='test-section'>";
echo "<h2>1. Проверка структуры базы данных</h2>";

$stmt = $pdo->query("SHOW INDEX FROM message_reactions");
$indexes = $stmt->fetchAll(PDO::FETCH_ASSOC);

$hasProblematicIndex = false;
$hasCorrectIndex = false;

foreach ($indexes as $idx) {
    if ($idx['Non_unique'] == 0 && $idx['Key_name'] !== 'PRIMARY') {
        $stmt2 = $pdo->query("
            SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) as cols
            FROM information_schema.STATISTICS
            WHERE table_schema = DATABASE() 
            AND table_name = 'message_reactions' 
            AND index_name = '{$idx['Key_name']}'
            GROUP BY index_name
        ");
        $colsRow = $stmt2->fetch();
        if ($colsRow && $colsRow['cols'] === 'message_id,user_uuid') {
            $hasProblematicIndex = true;
        }
        if ($colsRow && $colsRow['cols'] === 'message_id,user_uuid,emoji') {
            $hasCorrectIndex = true;
        }
    }
}

if ($hasProblematicIndex) {
    echo "<p class='error'><strong>ОШИБКА:</strong> Найден UNIQUE индекс по (message_id, user_uuid) без emoji. Это не позволит добавлять несколько реакций.</p>";
} else if ($hasCorrectIndex) {
    echo "<p class='success'><strong>OK:</strong> Структура БД корректна. Есть UNIQUE(message_id, user_uuid, emoji).</p>";
} else {
    echo "<p class='info'><strong>ИНФО:</strong> Не найден ожидаемый индекс. Проверьте структуру БД.</p>";
}
echo "</div>";

// 2. Проверка существующих данных
echo "<div class='test-section'>";
echo "<h2>2. Проверка существующих реакций</h2>";

$stmt = $pdo->query("
    SELECT message_id, user_uuid, COUNT(*) as cnt, GROUP_CONCAT(DISTINCT emoji) as emojis
    FROM message_reactions
    GROUP BY message_id, user_uuid
    HAVING cnt > 1
    ORDER BY cnt DESC
    LIMIT 10
");
$multiReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);

if (empty($multiReactions)) {
    echo "<p class='info'>Нет примеров сообщений, где один пользователь оставил несколько реакций. Это нормально, если функционал еще не использовался.</p>";
} else {
    echo "<p class='success'><strong>OK:</strong> Найдены примеры сообщений с несколькими реакциями от одного пользователя:</p>";
    echo "<table><tr><th>message_id</th><th>user_uuid</th><th>Количество</th><th>Эмодзи</th></tr>";
    foreach ($multiReactions as $r) {
        echo "<tr><td>{$r['message_id']}</td><td>" . substr($r['user_uuid'], 0, 8) . "...</td><td>{$r['cnt']}</td><td class='emoji'>{$r['emojis']}</td></tr>";
    }
    echo "</table>";
}
echo "</div>";

// 3. Тест добавления реакций
echo "<div class='test-section'>";
echo "<h2>3. Тест добавления всех 6 реакций</h2>";

// Находим любое сообщение для теста
$stmt = $pdo->prepare("
    SELECT m.id, m.conversation_id 
    FROM messages m
    JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
    WHERE cp.user_uuid = ? AND m.deleted_at IS NULL
    ORDER BY m.id DESC
    LIMIT 1
");
$stmt->execute([$currentUserUuid]);
$testMessage = $stmt->fetch();

if (!$testMessage) {
    echo "<p class='error'>Не найдено сообщение для теста. Создайте сообщение в любой беседе.</p>";
} else {
    $testMessageId = (int)$testMessage['id'];
    $testConversationId = (int)$testMessage['conversation_id'];
    
    echo "<p><strong>Тестовое сообщение ID:</strong> {$testMessageId}</p>";
    
    // Проверяем существующие реакции перед удалением
    $stmt = $pdo->prepare("SELECT emoji FROM message_reactions WHERE message_id = ? AND user_uuid = ?");
    $stmt->execute([$testMessageId, $currentUserUuid]);
    $existingBefore = $stmt->fetchAll(PDO::FETCH_COLUMN);
    
    // Удаляем все существующие реакции пользователя на это сообщение для чистого теста
    $stmt = $pdo->prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_uuid = ?");
    $stmt->execute([$testMessageId, $currentUserUuid]);
    $deleted = $stmt->rowCount();
    if ($deleted > 0) {
        echo "<p class='info'>Удалено {$deleted} существующих реакций для чистого теста: " . implode(' ', $existingBefore) . "</p>";
    } else {
        echo "<p class='info'>На сообщении не было ваших реакций перед тестом.</p>";
    }
    
    // Тестируем добавление всех 6 реакций
    $testEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    $results = [];
    
    foreach ($testEmojis as $emoji) {
        // Сначала проверяем, есть ли уже такая реакция
        $stmt = $pdo->prepare("
            SELECT id FROM message_reactions
            WHERE message_id = ? AND user_uuid = ? AND emoji = ?
        ");
        $stmt->execute([$testMessageId, $currentUserUuid, $emoji]);
        $existing = $stmt->fetch();
        
        if ($existing) {
            $results[] = ['emoji' => $emoji, 'status' => 'info', 'message' => 'Уже существует (пропущена)'];
            continue;
        }
        
        try {
            $stmt = $pdo->prepare("
                INSERT INTO message_reactions (message_id, user_uuid, emoji)
                VALUES (?, ?, ?)
            ");
            $stmt->execute([$testMessageId, $currentUserUuid, $emoji]);
            $results[] = ['emoji' => $emoji, 'status' => 'success', 'message' => 'Добавлена'];
        } catch (PDOException $e) {
            if ($e->getCode() == 23000) {
                // Проверяем еще раз после ошибки
                $stmt = $pdo->prepare("
                    SELECT id FROM message_reactions
                    WHERE message_id = ? AND user_uuid = ? AND emoji = ?
                ");
                $stmt->execute([$testMessageId, $currentUserUuid, $emoji]);
                if ($stmt->fetch()) {
                    $results[] = ['emoji' => $emoji, 'status' => 'warning', 'message' => 'Добавлена (была ошибка дубликата, но реакция существует)'];
                } else {
                    $results[] = ['emoji' => $emoji, 'status' => 'error', 'message' => 'Ошибка дубликата, но реакция не найдена: ' . $e->getMessage()];
                }
            } else {
                $results[] = ['emoji' => $emoji, 'status' => 'error', 'message' => 'Ошибка: ' . $e->getMessage()];
            }
        }
    }
    
    // Проверяем результат
    $stmt = $pdo->prepare("
        SELECT emoji, COUNT(*) as cnt
        FROM message_reactions
        WHERE message_id = ? AND user_uuid = ?
        GROUP BY emoji
    ");
    $stmt->execute([$testMessageId, $currentUserUuid]);
    $finalReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo "<table><tr><th>Эмодзи</th><th>Статус</th><th>Сообщение</th></tr>";
    foreach ($results as $r) {
        $class = 'info';
        if ($r['status'] === 'success') $class = 'success';
        elseif ($r['status'] === 'error') $class = 'error';
        elseif ($r['status'] === 'warning') $class = 'info';
        echo "<tr class='{$class}'><td class='emoji'>{$r['emoji']}</td><td>{$r['status']}</td><td>{$r['message']}</td></tr>";
    }
    echo "</table>";
    
    echo "<h3>Итоговые реакции на сообщении (ваши):</h3>";
    $totalReactions = count($finalReactions);
    if ($totalReactions >= 6) {
        echo "<p class='success'><strong>✅ УСПЕХ!</strong> На сообщении есть " . $totalReactions . " реакций (включая все 6 типов):</p>";
        echo "<div style='font-size: 2em; margin: 10px 0; padding: 10px; background: #f0f0f0; border-radius: 5px;'>";
        foreach ($finalReactions as $r) {
            echo "<span style='margin: 0 5px;' title='{$r['emoji']}'>{$r['emoji']}</span>";
        }
        echo "</div>";
        echo "<p class='success'><strong>Функционал работает корректно!</strong> Можно оставить все типы эмодзи-реакций на одно сообщение.</p>";
    } else if ($totalReactions > 0) {
        echo "<p class='info'><strong>ИНФО:</strong> На сообщении " . $totalReactions . " реакций:</p>";
        echo "<div style='font-size: 2em; margin: 10px 0; padding: 10px; background: #f0f0f0; border-radius: 5px;'>";
        foreach ($finalReactions as $r) {
            echo "<span style='margin: 0 5px;' title='{$r['emoji']}'>{$r['emoji']}</span>";
        }
        echo "</div>";
        echo "<p class='info'>Попробуйте добавить оставшиеся реакции через интерфейс мессенджера.</p>";
    } else {
        echo "<p class='error'><strong>ПРОБЛЕМА:</strong> На сообщении нет реакций.</p>";
    }
    
    // Проверяем, какие из 6 типов реакций есть
    $expectedEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    $foundEmojis = array_column($finalReactions, 'emoji');
    $missingEmojis = array_diff($expectedEmojis, $foundEmojis);
    
    if (empty($missingEmojis)) {
        echo "<p class='success'><strong>✅ Все 6 типов реакций присутствуют!</strong></p>";
    } else {
        echo "<p class='info'><strong>Отсутствующие реакции:</strong> ";
        echo "<span style='font-size: 1.5em;'>" . implode(' ', $missingEmojis) . "</span></p>";
    }
    
    // Показываем все реакции в БД
    $stmt = $pdo->prepare("
        SELECT emoji, user_uuid, created_at
        FROM message_reactions
        WHERE message_id = ?
        ORDER BY created_at
    ");
    $stmt->execute([$testMessageId]);
    $allReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo "<h3>Все реакции на сообщении (включая других пользователей):</h3>";
    echo "<table><tr><th>Эмодзи</th><th>Пользователь</th><th>Время</th></tr>";
    foreach ($allReactions as $r) {
        $isOwn = ($r['user_uuid'] === $currentUserUuid);
        $userDisplay = $isOwn ? '<strong>Вы</strong>' : substr($r['user_uuid'], 0, 8) . '...';
        echo "<tr><td class='emoji'>{$r['emoji']}</td><td>{$userDisplay}</td><td>{$r['created_at']}</td></tr>";
    }
    echo "</table>";
}
echo "</div>";

echo "<p><a href='../index.php'>Вернуться в мессенджер</a></p>";
echo "</body></html>";
