<?php
/**
 * Проверка миграции групповых звонков: таблицы group_calls, group_call_participants.
 * Запуск: php test/test_group_calls_migration.php (требуется pdo_mysql и выполненная миграция).
 */
if (!extension_loaded('pdo_mysql')) {
    echo "SKIP: pdo_mysql недоступен. Выполните миграцию вручную: php tools/run_group_calls_migration.php\n";
    exit(0);
}

require_once __DIR__ . '/../config/database.php';

$errors = [];
global $pdo;

function quoteIdentifier($name) {
    return '`' . str_replace('`', '``', $name) . '`';
}

foreach (['group_calls', 'group_call_participants'] as $table) {
    try {
        $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table));
        if ($stmt->rowCount() === 0) {
            $errors[] = "Таблица {$table} не найдена. Выполните: php tools/run_group_calls_migration.php";
        }
    } catch (PDOException $e) {
        $errors[] = "Ошибка проверки {$table}: " . $e->getMessage();
    }
}

$requiredColumns = [
    'group_calls' => ['id', 'conversation_id', 'created_by_uuid', 'with_video', 'started_at', 'ended_at', 'origin_call_id'],
    'group_call_participants' => ['id', 'group_call_id', 'user_uuid', 'joined_at', 'left_at'],
];
foreach ($requiredColumns as $table => $cols) {
    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM " . quoteIdentifier($table));
        $existing = $stmt->fetchAll(PDO::FETCH_COLUMN);
        foreach ($cols as $c) {
            if (!in_array($c, $existing, true)) {
                $errors[] = "В таблице {$table} отсутствует колонка {$c}.";
            }
        }
    } catch (PDOException $e) {
        $errors[] = "Ошибка проверки колонок {$table}: " . $e->getMessage();
    }
}

if (!empty($errors)) {
    foreach ($errors as $e) echo "FAIL: $e\n";
    exit(1);
}

echo "OK: Миграция групповых звонков применена (group_calls, group_call_participants).\n";
exit(0);
