<?php
/**
 * Технологический скрипт: сброс всех активных звонков (завершение в БД и опционально уведомление клиентов).
 *
 * Запуск из корня проекта:
 *   php tools/reset_active_calls.php --all
 *   php tools/reset_active_calls.php --user=uuid1,uuid2,uuid3
 *   php tools/reset_active_calls.php --all --dry-run
 *   php tools/reset_active_calls.php --all --no-ws
 *
 * Опции:
 *   --all          Завершить все активные звонки (1-на-1 и групповые) для всех пользователей.
 *   --user=UUIDs   Завершить только звонки, в которых участвуют указанные пользователи (через запятую).
 *   --dry-run      Только показать, что будет сброшено, без изменений в БД и без отправки событий.
 *   --no-ws        Не отправлять события в WebSocket (клиенты не получат call.end / call.group.ended).
 */

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "Скрипт предназначен только для запуска из командной строки (CLI).\n");
    exit(1);
}

$options = getopt('', ['all', 'user:', 'dry-run', 'no-ws']);
$doAll = isset($options['all']);
$userList = isset($options['user']) ? trim($options['user']) : '';
$dryRun = isset($options['dry-run']);
$noWs = isset($options['no-ws']);

if (!$doAll && $userList === '') {
    fwrite(STDERR, "Укажите --all или --user=uuid1,uuid2\n");
    fwrite(STDERR, "Пример: php tools/reset_active_calls.php --all\n");
    exit(1);
}

$userUuids = [];
if ($userList !== '') {
    $userUuids = array_filter(array_map('trim', explode(',', $userList)));
    $userUuids = array_values($userUuids);
    if (empty($userUuids)) {
        fwrite(STDERR, "Список UUID в --user не должен быть пустым.\n");
        exit(1);
    }
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/call_reset.php';

$resetOptions = [
    'user_uuids' => $userUuids,
    'dry_run' => $dryRun,
    'send_ws' => !$noWs,
    'source' => 'script',
];

if ($dryRun) {
    $result = resetActiveCalls($resetOptions);
    echo "Найдено активных звонков 1-на-1: " . $result['call_logs_count'] . "\n";
    echo "Найдено активных групповых звонков: " . $result['group_calls_count'] . "\n";
    echo "\nРежим --dry-run: изменения не применены.\n";
    exit(0);
}

$result = resetActiveCalls($resetOptions);

if ($result['error'] !== null) {
    fwrite(STDERR, "Ошибка: " . $result['error'] . "\n");
    exit(1);
}

echo "Завершено звонков 1-на-1: " . $result['call_logs_count'] . "\n";
echo "Завершено групповых звонков: " . $result['group_calls_count'] . "\n";
echo "Готово.\n";
