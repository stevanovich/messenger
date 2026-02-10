<?php
/**
 * Проверка миграции звонков: таблицы call_logs, user_sip_credentials и тип сообщения call.
 * Запуск: php test/test_calls_migration.php (требуется pdo_mysql и выполненная миграция).
 */
if (!extension_loaded('pdo_mysql')) {
    echo "SKIP: pdo_mysql недоступен. Выполните миграцию вручную: php tools/run_calls_migration.php\n";
    exit(0);
}

require_once __DIR__ . '/../config/database.php';

$errors = [];
global $pdo;

foreach (['call_logs', 'user_sip_credentials'] as $table) {
    try {
        $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table));
        if ($stmt->rowCount() === 0) {
            $errors[] = "Таблица {$table} не найдена. Выполните: php tools/run_calls_migration.php";
        }
    } catch (PDOException $e) {
        $errors[] = "Ошибка проверки {$table}: " . $e->getMessage();
    }
}

try {
    $stmt = $pdo->query("SHOW COLUMNS FROM messages WHERE Field = 'type'");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row && isset($row['Type']) && strpos($row['Type'], 'call') === false) {
        $errors[] = "В messages.type отсутствует значение 'call'. Выполните миграцию.";
    }
} catch (PDOException $e) {
    $errors[] = "Ошибка проверки messages.type: " . $e->getMessage();
}

if (!empty($errors)) {
    foreach ($errors as $e) echo "FAIL: $e\n";
    exit(1);
}

echo "OK: Миграция звонков применена (call_logs, user_sip_credentials, messages.type=call).\n";
exit(0);
