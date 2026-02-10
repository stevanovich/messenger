<?php
/**
 * Проверка API групповых звонков (Этап 2.2).
 * Проверяет наличие действий group_start, group_join, group_leave, group_status и синтаксис.
 * Полная проверка с БД: после миграции и с авторизованной сессией вызывать API (см. docs/GROUP_CALLS_PLAN.md).
 */
$apiPath = __DIR__ . '/../api/calls.php';
if (!is_file($apiPath)) {
    echo "FAIL: api/calls.php не найден.\n";
    exit(1);
}

$code = file_get_contents($apiPath);
$requiredActions = ['group_start', 'group_join', 'group_leave', 'group_end', 'group_status', 'call_add_participant', 'call_invites', 'call_decline_invite'];
foreach ($requiredActions as $action) {
    if (strpos($code, "'{$action}'") === false && strpos($code, "\"{$action}\"") === false) {
        echo "FAIL: в api/calls.php не найдено действие '{$action}'.\n";
        exit(1);
    }
}

$requiredStrings = ['group_calls', 'group_call_participants', 'call.group.started', 'call.group.joined', 'call.group.left', 'call.group.ended', 'call.converted_to_group', 'call.group.participant_invited'];
foreach ($requiredStrings as $s) {
    if (strpos($code, $s) === false) {
        echo "FAIL: в api/calls.php не найдена ожидаемая строка '{$s}'.\n";
        exit(1);
    }
}

exec('php -l ' . escapeshellarg($apiPath) . ' 2>&1', $out, $ret);
if ($ret !== 0) {
    echo "FAIL: синтаксис PHP: " . implode("\n", $out) . "\n";
    exit(1);
}

echo "OK: API групповых звонков — синтаксис корректен, действия group_start, group_join, group_leave, group_end, group_status присутствуют.\n";
echo "Напоминание: выполните миграцию групповых звонков: php tools/run_group_calls_migration.php\n";
exit(0);
