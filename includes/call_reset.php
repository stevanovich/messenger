<?php
/**
 * Сброс активных звонков: завершение в БД, сообщения в беседы, опционально события WebSocket.
 * Используется из tools/reset_active_calls.php и admin/calls.php.
 *
 * @param array $options [
 *   'user_uuids' => string[]  пустой = все звонки, иначе только с участием этих UUID
 *   'dry_run'    => bool      true = только подсчёт, без изменений
 *   'send_ws'    => bool      true = отправлять call.end / call.group.ended
 *   'source'     => string   для текста в сообщениях: 'admin' (сброс из админки) или 'script' (сброс скриптом)
 * ]
 * @return array ['call_logs_count' => int, 'group_calls_count' => int, 'error' => string|null]
 */
function resetActiveCalls(array $options = []) {
    global $pdo;
    $userUuids = isset($options['user_uuids']) && is_array($options['user_uuids'])
        ? array_values(array_filter(array_map('trim', $options['user_uuids'])))
        : [];
    $dryRun = !empty($options['dry_run']);
    $sendWs = !empty($options['send_ws']);
    $source = (isset($options['source']) && $options['source'] === 'script') ? 'скриптом' : 'из админки';

    $result = ['call_logs_count' => 0, 'group_calls_count' => 0, 'error' => null];

    $callLogsWhere = 'ended_at IS NULL';
    $callLogsParams = [];
    if (!empty($userUuids)) {
        $placeholders = implode(',', array_fill(0, count($userUuids), '?'));
        $callLogsWhere .= " AND (caller_uuid IN ($placeholders) OR callee_uuid IN ($placeholders))";
        $callLogsParams = array_merge($callLogsParams, $userUuids, $userUuids);
    }

    $stmt = $pdo->prepare("
        SELECT id, conversation_id, caller_uuid, callee_uuid, started_at, with_video
        FROM call_logs
        WHERE $callLogsWhere
    ");
    $stmt->execute($callLogsParams);
    $activeCalls = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $groupCallsWhere = 'gc.ended_at IS NULL';
    $groupCallsParams = [];
    if (!empty($userUuids)) {
        $placeholders = implode(',', array_fill(0, count($userUuids), '?'));
        $groupCallsWhere .= " AND (
            gc.created_by_uuid IN ($placeholders)
            OR EXISTS (
                SELECT 1 FROM group_call_participants gcp
                WHERE gcp.group_call_id = gc.id AND gcp.user_uuid IN ($placeholders)
            )
        )";
        $groupCallsParams = array_merge($groupCallsParams, $userUuids, $userUuids);
    }

    $stmt = $pdo->prepare("
        SELECT gc.id, gc.conversation_id, gc.created_by_uuid, gc.with_video, gc.started_at
        FROM group_calls gc
        WHERE $groupCallsWhere
    ");
    $stmt->execute($groupCallsParams);
    $activeGroupCalls = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result['call_logs_count'] = count($activeCalls);
    $result['group_calls_count'] = count($activeGroupCalls);

    if ($dryRun) {
        return $result;
    }

    $now = date('Y-m-d H:i:s');

    try {
        $pdo->beginTransaction();

        if (!empty($activeCalls)) {
            $ids = array_column($activeCalls, 'id');
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("
                UPDATE call_logs
                SET ended_at = ?,
                    duration_sec = TIMESTAMPDIFF(SECOND, started_at, ?)
                WHERE id IN ($placeholders)
            ");
            $stmt->execute(array_merge([$now, $now], $ids));

            foreach ($activeCalls as $c) {
                $content = ($c['with_video'] ? 'Видеозвонок' : 'Звонок') . ' завершён (сброс ' . $source . ')';
                $stmt = $pdo->prepare("
                    INSERT INTO messages (conversation_id, user_uuid, content, type)
                    VALUES (?, NULL, ?, 'call')
                ");
                $stmt->execute([$c['conversation_id'], $content]);
            }

            if ($sendWs && function_exists('notifyWebSocketEvent')) {
                foreach ($activeCalls as $c) {
                    notifyWebSocketEvent('call.end', (int) $c['conversation_id'], [
                        'call_id' => (int) $c['id'],
                        'ended_by_uuid' => null,
                    ]);
                }
            }
        }

        if (!empty($activeGroupCalls)) {
            $ids = array_column($activeGroupCalls, 'id');
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("
                UPDATE group_calls
                SET ended_at = ?
                WHERE id IN ($placeholders)
            ");
            $stmt->execute(array_merge([$now], $ids));

            foreach ($activeGroupCalls as $g) {
                $durationSec = max(0, time() - strtotime($g['started_at']));
                $label = $g['with_video'] ? 'Групповой видеозвонок' : 'Групповой звонок';
                $mins = floor($durationSec / 60);
                $secs = $durationSec % 60;
                $durationText = $mins > 0 ? $mins . ' мин' : $secs . ' сек';
                $content = $label . ' завершён (сброс из админки), длительность ' . $durationText;
                $stmt = $pdo->prepare("
                    INSERT INTO messages (conversation_id, user_uuid, content, type, group_call_id)
                    VALUES (?, NULL, ?, 'call', ?)
                ");
                $stmt->execute([$g['conversation_id'], $content, $g['id']]);
            }

            if ($sendWs && function_exists('notifyWebSocketEvent')) {
                foreach ($activeGroupCalls as $g) {
                    notifyWebSocketEvent('call.group.ended', (int) $g['conversation_id'], [
                        'group_call_id' => (int) $g['id'],
                        'ended_by_uuid' => null,
                    ]);
                }
            }
        }

        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        $result['error'] = $e->getMessage();
    }

    return $result;
}

/**
 * Подсчёт активных звонков (без изменений).
 * @return array ['call_logs' => int, 'group_calls' => int]
 */
function getActiveCallsCount() {
    global $pdo;
    $stmt = $pdo->query("SELECT COUNT(*) FROM call_logs WHERE ended_at IS NULL");
    $callLogs = (int) $stmt->fetchColumn();
    $stmt = $pdo->query("SELECT COUNT(*) FROM group_calls WHERE ended_at IS NULL");
    $groupCalls = (int) $stmt->fetchColumn();
    return ['call_logs' => $callLogs, 'group_calls' => $groupCalls];
}
