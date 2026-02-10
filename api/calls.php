<?php
/**
 * API звонков: конфиг (SIP/WebRTC), токен для SIP, история, старт/завершение звонка.
 * См. docs/SIP_CALLS_PLAN.md
 */
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$currentUserUuid = isLoggedIn() ? getCurrentUserUuid() : null;
global $pdo;

// Публичные действия (без авторизации): call_link_*, group_leave_guest, signaling_guest, group_status_guest (по guest_token)
$publicActions = ['call_link_info', 'call_link_join_guest', 'group_leave_guest', 'signaling_guest', 'group_status_guest', 'call_muted_guest'];
if (!in_array($action, $publicActions, true) && !isLoggedIn()) {
    jsonError('Не авторизован', 401);
}
if (isLoggedIn()) {
    updateLastSeenIfNeeded();
}

switch ($action) {
    case 'call_link_info':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $token = trim((string)($_GET['token'] ?? ''));
        if ($token === '') {
            jsonError('Укажите token', 400);
        }
        $stmt = $pdo->prepare("
            SELECT cl.id, cl.group_call_id, cl.call_id, cl.expires_at,
                   gc.conversation_id AS gc_conversation_id, gc.with_video AS gc_with_video,
                   cl.created_by_uuid
            FROM call_links cl
            LEFT JOIN group_calls gc ON gc.id = cl.group_call_id AND gc.ended_at IS NULL
            LEFT JOIN call_logs clog ON clog.id = cl.call_id AND clog.ended_at IS NULL
            WHERE cl.token = ? AND (cl.expires_at > UTC_TIMESTAMP() OR cl.expires_at > NOW())
        ");
        $stmt->execute([$token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            try {
                $stmtConv = $pdo->prepare("SELECT conversation_id FROM conversation_invite_links WHERE token = ? AND (expires_at > UTC_TIMESTAMP() OR expires_at > NOW()) LIMIT 1");
                $stmtConv->execute([$token]);
                if ($stmtConv->fetch()) {
                    $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
                    jsonSuccess(['redirect_to_conversation' => true, 'redirect_url' => $baseUrl . '/join-conversation.php?token=' . urlencode($token)]);
                    exit;
                }
            } catch (Throwable $e) {
                /* conversation_invite_links может отсутствовать */
            }
            jsonError('Ссылка недействительна или истекла', 404);
        }
        $groupCallId = $row['group_call_id'] !== null ? (int) $row['group_call_id'] : null;
        $callId = $row['call_id'] !== null ? (int) $row['call_id'] : null;
        if ($groupCallId !== null) {
            if ($row['gc_conversation_id'] === null) {
                jsonError('Звонок завершён', 404);
            }
            $withVideo = (bool) ($row['gc_with_video'] ?? 0);
        } else {
            $stmt = $pdo->prepare("SELECT with_video FROM call_logs WHERE id = ? AND ended_at IS NULL");
            $stmt->execute([$callId]);
            $clog = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$clog) {
                jsonError('Звонок завершён', 404);
            }
            $withVideo = (bool) $clog['with_video'];
        }
        $inviterName = null;
        if (!empty($row['created_by_uuid'])) {
            $stmt = $pdo->prepare("SELECT COALESCE(display_name, username) AS name FROM users WHERE uuid = ?");
            $stmt->execute([$row['created_by_uuid']]);
            $u = $stmt->fetch(PDO::FETCH_ASSOC);
            $inviterName = $u ? trim($u['name'] ?? '') : null;
        }
        jsonSuccess([
            'call_type' => $groupCallId !== null ? 'group' : 'call_1_1',
            'group_call_id' => $groupCallId,
            'with_video' => $withVideo,
            'inviter_name' => $inviterName,
            'expires_at' => $row['expires_at'],
        ]);
        break;

    case 'call_link_join_guest':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $linkToken = trim((string)($input['link_token'] ?? $input['token'] ?? ''));
        $displayName = trim((string)($input['display_name'] ?? ''));
        if ($linkToken === '') {
            jsonError('Укажите link_token', 400);
        }
        if (mb_strlen($displayName) < 1 || mb_strlen($displayName) > 255) {
            jsonError('Укажите отображаемое имя (1–255 символов)', 400);
        }
        $displayName = strip_tags($displayName);
        $displayName = preg_replace('/\s+/', ' ', trim($displayName));
        if ($displayName === '') {
            jsonError('Некорректное имя', 400);
        }
        if (mb_strlen($displayName) > 255) {
            $displayName = mb_substr($displayName, 0, 255);
        }
        $stmt = $pdo->prepare("
            SELECT cl.id, cl.group_call_id, cl.call_id, cl.expires_at
            FROM call_links cl
            WHERE cl.token = ? AND (cl.expires_at > UTC_TIMESTAMP() OR cl.expires_at > NOW())
        ");
        $stmt->execute([$linkToken]);
        $link = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$link) {
            jsonError('Ссылка недействительна или истекла', 404);
        }
        $groupCallId = $link['group_call_id'] !== null ? (int) $link['group_call_id'] : null;
        $callId = $link['call_id'] !== null ? (int) $link['call_id'] : null;
        if ($groupCallId === null && $callId !== null) {
            $stmt = $pdo->prepare("SELECT id, conversation_id, with_video FROM group_calls WHERE origin_call_id = ? AND ended_at IS NULL");
            $stmt->execute([$callId]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $groupCallId = (int) $existing['id'];
                $conversationId = (int) $existing['conversation_id'];
            } else {
                $stmt = $pdo->prepare("SELECT conversation_id, caller_uuid, callee_uuid, with_video FROM call_logs WHERE id = ? AND ended_at IS NULL");
                $stmt->execute([$callId]);
                $callLog = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$callLog) {
                    jsonError('Звонок завершён', 404);
                }
                $pdo->beginTransaction();
                try {
                    $stmt = $pdo->prepare("INSERT INTO conversations (type, name) VALUES ('group', 'Групповой звонок')");
                    $stmt->execute();
                    $newConvId = (int) $pdo->lastInsertId();
                    foreach ([$callLog['caller_uuid'], $callLog['callee_uuid']] as $uuid) {
                        $stmt = $pdo->prepare("INSERT INTO conversation_participants (conversation_id, user_uuid) VALUES (?, ?)");
                        $stmt->execute([$newConvId, $uuid]);
                    }
                    $stmt = $pdo->prepare("
                        INSERT INTO group_calls (conversation_id, created_by_uuid, with_video, origin_call_id)
                        VALUES (?, ?, ?, ?)
                    ");
                    $stmt->execute([$newConvId, $callLog['caller_uuid'], (int) $callLog['with_video'], $callId]);
                    $groupCallId = (int) $pdo->lastInsertId();
                    $stmt = $pdo->prepare("INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at) VALUES (?, ?, NOW())");
                    $stmt->execute([$groupCallId, $callLog['caller_uuid']]);
                    $stmt->execute([$groupCallId, $callLog['callee_uuid']]);
                    $pdo->prepare("UPDATE call_links SET group_call_id = ?, call_id = NULL WHERE token = ?")->execute([$groupCallId, $linkToken]);
                    $pdo->commit();
                } catch (Exception $e) {
                    $pdo->rollBack();
                    jsonError('Не удалось создать групповой звонок', 500);
                }
                $conversationId = $newConvId;
                notifyWebSocketEvent('call.converted_to_group', (int) $callLog['conversation_id'], [
                    'group_call_id' => $groupCallId,
                    'new_conversation_id' => $newConvId,
                    'with_video' => (bool) $callLog['with_video'],
                    'participants' => [$callLog['caller_uuid'], $callLog['callee_uuid']],
                    'invited' => [],
                ]);
            }
        }
        if ($groupCallId === null) {
            jsonError('Звонок не найден', 404);
        }
        if (!isset($conversationId)) {
            $stmt = $pdo->prepare("SELECT conversation_id FROM group_calls WHERE id = ? AND ended_at IS NULL");
            $stmt->execute([$groupCallId]);
            $gc = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$gc) {
                jsonError('Звонок завершён', 404);
            }
            $conversationId = (int) $gc['conversation_id'];
        }
        $stmt = $pdo->prepare("SELECT with_video FROM group_calls WHERE id = ?");
        $stmt->execute([$groupCallId]);
        $gcRow = $stmt->fetch(PDO::FETCH_ASSOC);
        $withVideo = $gcRow ? (bool) $gcRow['with_video'] : false;
        $guestToken = bin2hex(random_bytes(24));
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("INSERT INTO group_call_guests (group_call_id, display_name, guest_token, joined_at) VALUES (?, ?, ?, ?)");
        $stmt->execute([$groupCallId, $displayName, $guestToken, $now]);
        $guestId = (int) $pdo->lastInsertId();
        $wsGuestToken = bin2hex(random_bytes(32));
        $wsExpires = gmdate('Y-m-d H:i:s', time() + 900);
        $oldTz = $pdo->query("SELECT @@session.time_zone")->fetchColumn();
        $pdo->exec("SET SESSION time_zone = '+00:00'");
        $stmt = $pdo->prepare("INSERT INTO ws_guest_tokens (token, group_call_guest_id, expires_at) VALUES (?, ?, ?)");
        $stmt->execute([$wsGuestToken, $guestId, $wsExpires]);
        if ($oldTz !== false && $oldTz !== null) $pdo->exec("SET SESSION time_zone = " . $pdo->quote($oldTz));
        notifyWebSocketEvent('call.group.guest_joined', $conversationId, [
            'group_call_id' => $groupCallId,
            'guest_id' => $guestId,
            'display_name' => $displayName,
        ]);
        jsonSuccess([
            'group_call_id' => $groupCallId,
            'conversation_id' => $conversationId,
            'guest_token' => $guestToken,
            'with_video' => $withVideo,
            'ws_guest_token' => $wsGuestToken,
        ]);
        break;

    case 'call_link_create':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        $callId = (int)($input['call_id'] ?? 0);
        $expiresInSec = (int)($input['expires_in_sec'] ?? 86400);
        if ($expiresInSec < 60) $expiresInSec = 60;
        if ($expiresInSec > 604800) $expiresInSec = 604800;
        if ($groupCallId > 0 && $callId > 0) {
            jsonError('Укажите только group_call_id или только call_id', 400);
        }
        if ($groupCallId <= 0 && $callId <= 0) {
            jsonError('Укажите group_call_id или call_id', 400);
        }
        if ($groupCallId > 0) {
            $stmt = $pdo->prepare("
                SELECT gc.id, gc.conversation_id FROM group_calls gc
                INNER JOIN group_call_participants gcp ON gcp.group_call_id = gc.id AND gcp.user_uuid = ? AND gcp.left_at IS NULL
                WHERE gc.id = ? AND gc.ended_at IS NULL
            ");
            $stmt->execute([$currentUserUuid, $groupCallId]);
            if (!$stmt->fetch()) {
                jsonError('Звонок не найден или вы не участник', 404);
            }
            $linkGroupCallId = $groupCallId;
            $linkCallId = null;
            $stmt = $pdo->prepare("SELECT token, expires_at FROM call_links WHERE group_call_id = ? AND (expires_at > UTC_TIMESTAMP() OR expires_at > NOW()) ORDER BY expires_at DESC LIMIT 1");
            $stmt->execute([$groupCallId]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
                $joinUrl = $baseUrl . '/join-call.php?token=' . urlencode($existing['token']);
                jsonSuccess(['link_token' => $existing['token'], 'join_url' => $joinUrl, 'expires_at' => $existing['expires_at']]);
                break;
            }
        } else {
            $stmt = $pdo->prepare("SELECT id, conversation_id FROM call_logs WHERE id = ? AND ended_at IS NULL AND (caller_uuid = ? OR callee_uuid = ?)");
            $stmt->execute([$callId, $currentUserUuid, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Звонок не найден или вы не участник', 404);
            }
            $linkGroupCallId = null;
            $linkCallId = $callId;
            $stmt = $pdo->prepare("SELECT token, expires_at FROM call_links WHERE call_id = ? AND (expires_at > UTC_TIMESTAMP() OR expires_at > NOW()) ORDER BY expires_at DESC LIMIT 1");
            $stmt->execute([$callId]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
                $joinUrl = $baseUrl . '/join-call.php?token=' . urlencode($existing['token']);
                jsonSuccess(['link_token' => $existing['token'], 'join_url' => $joinUrl, 'expires_at' => $existing['expires_at']]);
                break;
            }
        }
        $token = bin2hex(random_bytes(24));
        $expiresAt = gmdate('Y-m-d H:i:s', time() + $expiresInSec);
        $stmt = $pdo->prepare("INSERT INTO call_links (token, group_call_id, call_id, created_by_uuid, expires_at) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$token, $linkGroupCallId ?: null, $linkCallId ?: null, $currentUserUuid, $expiresAt]);
        $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
        $joinUrl = $baseUrl . '/join-call.php?token=' . urlencode($token);
        jsonSuccess(['link_token' => $token, 'join_url' => $joinUrl, 'expires_at' => $expiresAt]);
        break;

    case 'call_link_join':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $linkToken = trim((string)($input['link_token'] ?? $input['token'] ?? ''));
        if ($linkToken === '') {
            jsonError('Укажите link_token', 400);
        }
        $stmt = $pdo->prepare("SELECT id, group_call_id, call_id FROM call_links WHERE token = ? AND (expires_at > UTC_TIMESTAMP() OR expires_at > NOW())");
        $stmt->execute([$linkToken]);
        $link = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$link) {
            jsonError('Ссылка недействительна или истекла', 404);
        }
        $groupCallId = $link['group_call_id'] !== null ? (int) $link['group_call_id'] : null;
        $callId = $link['call_id'] !== null ? (int) $link['call_id'] : null;
        if ($groupCallId === null && $callId !== null) {
            $stmt = $pdo->prepare("SELECT id, conversation_id, with_video FROM group_calls WHERE origin_call_id = ? AND ended_at IS NULL");
            $stmt->execute([$callId]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $groupCallId = (int) $existing['id'];
                $conversationId = (int) $existing['conversation_id'];
                $withVideo = (bool) $existing['with_video'];
            } else {
                $stmt = $pdo->prepare("SELECT conversation_id, caller_uuid, callee_uuid, with_video FROM call_logs WHERE id = ? AND ended_at IS NULL");
                $stmt->execute([$callId]);
                $callLog = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$callLog) {
                    jsonError('Звонок завершён', 404);
                }
                $pdo->beginTransaction();
                try {
                    $stmt = $pdo->prepare("INSERT INTO conversations (type, name) VALUES ('group', 'Групповой звонок')");
                    $stmt->execute();
                    $newConvId = (int) $pdo->lastInsertId();
                    foreach ([$callLog['caller_uuid'], $callLog['callee_uuid']] as $uuid) {
                        $stmt = $pdo->prepare("INSERT INTO conversation_participants (conversation_id, user_uuid) VALUES (?, ?)");
                        $stmt->execute([$newConvId, $uuid]);
                    }
                    $stmt = $pdo->prepare("
                        INSERT INTO group_calls (conversation_id, created_by_uuid, with_video, origin_call_id)
                        VALUES (?, ?, ?, ?)
                    ");
                    $stmt->execute([$newConvId, $currentUserUuid, (int) $callLog['with_video'], $callId]);
                    $groupCallId = (int) $pdo->lastInsertId();
                    $stmt = $pdo->prepare("INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at) VALUES (?, ?, NOW())");
                    $stmt->execute([$groupCallId, $callLog['caller_uuid']]);
                    $stmt->execute([$groupCallId, $callLog['callee_uuid']]);
                    $pdo->prepare("UPDATE call_links SET group_call_id = ?, call_id = NULL WHERE token = ?")->execute([$groupCallId, $linkToken]);
                    $pdo->commit();
                } catch (Exception $e) {
                    $pdo->rollBack();
                    jsonError('Не удалось создать групповой звонок', 500);
                }
                $conversationId = $newConvId;
                $withVideo = (bool) $callLog['with_video'];
                notifyWebSocketEvent('call.converted_to_group', (int) $callLog['conversation_id'], [
                    'group_call_id' => $groupCallId,
                    'new_conversation_id' => $newConvId,
                    'with_video' => $withVideo,
                    'participants' => [$callLog['caller_uuid'], $callLog['callee_uuid']],
                    'invited' => [],
                ]);
            }
        }
        if ($groupCallId === null) {
            jsonError('Звонок не найден', 404);
        }
        if (!isset($conversationId)) {
            $stmt = $pdo->prepare("SELECT conversation_id, with_video FROM group_calls WHERE id = ? AND ended_at IS NULL");
            $stmt->execute([$groupCallId]);
            $gc = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$gc) {
                jsonError('Звонок завершён', 404);
            }
            $conversationId = (int) $gc['conversation_id'];
            $withVideo = (bool) $gc['with_video'];
        }
        $stmt = $pdo->prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_uuid = ?");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            $stmt = $pdo->prepare("INSERT INTO conversation_participants (conversation_id, user_uuid) VALUES (?, ?)");
            $stmt->execute([$conversationId, $currentUserUuid]);
        }
        $stmt = $pdo->prepare("
            INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE joined_at = NOW(), left_at = NULL
        ");
        $stmt->execute([$groupCallId, $currentUserUuid]);
        notifyWebSocketEvent('call.group.joined', $conversationId, ['group_call_id' => $groupCallId, 'user_uuid' => $currentUserUuid]);
        $stmt = $pdo->prepare("
            SELECT user_uuid, joined_at, left_at FROM group_call_participants
            WHERE group_call_id = ? AND joined_at IS NOT NULL AND left_at IS NULL
            ORDER BY joined_at
        ");
        $stmt->execute([$groupCallId]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $stmt = $pdo->prepare("SELECT id, display_name, joined_at FROM group_call_guests WHERE group_call_id = ? AND left_at IS NULL ORDER BY joined_at");
        $stmt->execute([$groupCallId]);
        $guests = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!isset($withVideo)) {
            $stmt = $pdo->prepare("SELECT with_video FROM group_calls WHERE id = ?");
            $stmt->execute([$groupCallId]);
            $withVideo = (bool) $stmt->fetchColumn();
        }
        jsonSuccess([
            'group_call_id' => $groupCallId,
            'conversation_id' => $conversationId,
            'with_video' => $withVideo,
            'participants' => $participants,
            'guests' => $guests,
        ]);
        break;

    case 'call_link_revoke':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $linkToken = trim((string)($input['link_token'] ?? $input['token'] ?? ''));
        $revokeGroupCallId = (int)($input['group_call_id'] ?? 0);
        $revokeCallId = (int)($input['call_id'] ?? 0);
        if ($linkToken !== '') {
            $stmt = $pdo->prepare("
                SELECT cl.id, cl.group_call_id, cl.call_id FROM call_links cl
                WHERE cl.token = ?
            ");
            $stmt->execute([$linkToken]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                jsonError('Ссылка не найдена', 404);
            }
            $gcId = $row['group_call_id'] !== null ? (int) $row['group_call_id'] : 0;
            $cId = $row['call_id'] !== null ? (int) $row['call_id'] : 0;
            if ($gcId > 0) {
                $stmt = $pdo->prepare("SELECT 1 FROM group_call_participants WHERE group_call_id = ? AND user_uuid = ? AND left_at IS NULL");
                $stmt->execute([$gcId, $currentUserUuid]);
                if (!$stmt->fetch()) {
                    jsonError('Нет доступа', 403);
                }
            } else if ($cId > 0) {
                $stmt = $pdo->prepare("SELECT 1 FROM call_logs WHERE id = ? AND ended_at IS NULL AND (caller_uuid = ? OR callee_uuid = ?)");
                $stmt->execute([$cId, $currentUserUuid, $currentUserUuid]);
                if (!$stmt->fetch()) {
                    jsonError('Нет доступа', 403);
                }
            }
            $pdo->prepare("DELETE FROM call_links WHERE token = ?")->execute([$linkToken]);
            jsonSuccess(['ok' => true]);
            break;
        }
        if ($revokeGroupCallId > 0) {
            $stmt = $pdo->prepare("SELECT 1 FROM group_call_participants WHERE group_call_id = ? AND user_uuid = ? AND left_at IS NULL");
            $stmt->execute([$revokeGroupCallId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа', 403);
            }
            $pdo->prepare("DELETE FROM call_links WHERE group_call_id = ?")->execute([$revokeGroupCallId]);
        } elseif ($revokeCallId > 0) {
            $stmt = $pdo->prepare("SELECT 1 FROM call_logs WHERE id = ? AND ended_at IS NULL AND (caller_uuid = ? OR callee_uuid = ?)");
            $stmt->execute([$revokeCallId, $currentUserUuid, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа', 403);
            }
            $pdo->prepare("DELETE FROM call_links WHERE call_id = ?")->execute([$revokeCallId]);
        } else {
            jsonError('Укажите link_token или group_call_id/call_id', 400);
        }
        jsonSuccess(['ok' => true]);
        break;

    case 'group_leave_guest':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $guestToken = trim((string)($input['guest_token'] ?? ''));
        if ($guestToken === '') {
            jsonError('Укажите guest_token', 400);
        }
        $stmt = $pdo->prepare("
            SELECT gcg.id, gcg.group_call_id, gc.conversation_id
            FROM group_call_guests gcg
            INNER JOIN group_calls gc ON gc.id = gcg.group_call_id AND gc.ended_at IS NULL
            WHERE gcg.guest_token = ? AND gcg.left_at IS NULL
        ");
        $stmt->execute([$guestToken]);
        $guest = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$guest) {
            jsonError('Гость не найден или уже вышел', 404);
        }
        $now = date('Y-m-d H:i:s');
        $pdo->prepare("UPDATE group_call_guests SET left_at = ? WHERE id = ?")->execute([$now, $guest['id']]);
        notifyWebSocketEvent('call.group.guest_left', (int) $guest['conversation_id'], [
            'group_call_id' => (int) $guest['group_call_id'],
            'guest_id' => (int) $guest['id'],
        ]);
        jsonSuccess(['ok' => true]);
        break;

    case 'config':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $sipWsUrl = defined('SIP_WS_URL') ? trim(SIP_WS_URL) : '';
        $callMode = $sipWsUrl !== '' ? 'sip' : 'webrtc_only';

        $data = [
            'call_mode' => $callMode,
            'user_uuid' => $currentUserUuid,
            'sip_uri' => 'sip:' . $currentUserUuid . '@' . (defined('SIP_DOMAIN') && SIP_DOMAIN !== '' ? SIP_DOMAIN : 'localhost'),
            'stun' => (defined('SIP_STUN_URL') && trim(SIP_STUN_URL) !== '') ? trim(SIP_STUN_URL) : 'stun:stun.l.google.com:19302',
            'turn' => null,
            'turn_username' => null,
            'turn_credential' => null,
        ];

        if (defined('SIP_TURN_URL') && trim(SIP_TURN_URL) !== '') {
            $data['turn'] = trim(SIP_TURN_URL);
            $data['turn_username'] = defined('SIP_TURN_USER') ? SIP_TURN_USER : '';
            $data['turn_credential'] = defined('SIP_TURN_CREDENTIAL') && SIP_TURN_CREDENTIAL !== '' ? '***' : ''; // не отдаём пароль в конфиг
        }

        if ($callMode === 'sip') {
            $data['sip_ws_url'] = $sipWsUrl;
            $data['sip_domain'] = defined('SIP_DOMAIN') ? trim(SIP_DOMAIN) : '';
        }

        jsonSuccess($data);
        break;

    case 'token':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $sipWsUrl = defined('SIP_WS_URL') ? trim(SIP_WS_URL) : '';
        if ($sipWsUrl === '') {
            jsonError('Режим SIP не включён (call_mode webrtc_only)', 400);
        }

        $stmt = $pdo->prepare("SELECT sip_password FROM user_sip_credentials WHERE user_uuid = ?");
        $stmt->execute([$currentUserUuid]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row) {
            $sipPassword = $row['sip_password'];
        } else {
            $sipPassword = bin2hex(random_bytes(16));
            $pdo->prepare("INSERT INTO user_sip_credentials (user_uuid, sip_password) VALUES (?, ?)")
                ->execute([$currentUserUuid, $sipPassword]);
        }

        $sipDomain = defined('SIP_DOMAIN') && trim(SIP_DOMAIN) !== '' ? trim(SIP_DOMAIN) : 'localhost';
        jsonSuccess([
            'sip_username' => $currentUserUuid,
            'sip_password' => $sipPassword,
            'sip_domain' => $sipDomain,
        ]);
        break;

    case 'history':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $conversationId = (int)($_GET['conversation_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }

        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }

        $stmt = $pdo->prepare("
            SELECT id, conversation_id, caller_uuid, callee_uuid, started_at, ended_at, direction, duration_sec, with_video
            FROM call_logs
            WHERE conversation_id = ?
            ORDER BY started_at DESC
            LIMIT 100
        ");
        $stmt->execute([$conversationId]);
        $list = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($list as &$row) {
            $row['with_video'] = (int) $row['with_video'];
            $row['duration_sec'] = $row['duration_sec'] !== null ? (int) $row['duration_sec'] : null;
        }
        unset($row);

        jsonSuccess(['calls' => $list]);
        break;

    case 'start':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? $_POST['conversation_id'] ?? 0);
        $calleeUuid = trim((string)($input['callee_uuid'] ?? $_POST['callee_uuid'] ?? ''));
        $withVideo = !empty($input['with_video'] ?? $_POST['with_video'] ?? false);

        if ($conversationId <= 0 || $calleeUuid === '') {
            jsonError('Укажите conversation_id и callee_uuid', 400);
        }

        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }

        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $calleeUuid]);
        if (!$stmt->fetch()) {
            jsonError('Участник не в этой беседе', 400);
        }

        $stmt = $pdo->prepare("
            INSERT INTO call_logs (conversation_id, caller_uuid, callee_uuid, direction, with_video)
            VALUES (?, ?, ?, 'outgoing', ?)
        ");
        $stmt->execute([$conversationId, $currentUserUuid, $calleeUuid, $withVideo ? 1 : 0]);
        $callId = (int) $pdo->lastInsertId();

        jsonSuccess(['call_id' => $callId]);
        break;

    case 'end':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $callId = (int)($input['call_id'] ?? $_POST['call_id'] ?? 0);

        if ($callId <= 0) {
            jsonError('Укажите call_id', 400);
        }

        $stmt = $pdo->prepare("
            SELECT id, conversation_id, caller_uuid, callee_uuid, started_at, with_video
            FROM call_logs
            WHERE id = ? AND ended_at IS NULL
        ");
        $stmt->execute([$callId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$call) {
            jsonError('Звонок не найден или уже завершён', 404);
        }

        if ($currentUserUuid !== $call['caller_uuid'] && $currentUserUuid !== $call['callee_uuid']) {
            jsonError('Нет доступа к этому звонку', 403);
        }

        $endedAt = date('Y-m-d H:i:s');
        $started = strtotime($call['started_at']);
        $durationSec = max(0, time() - $started);

        $stmt = $pdo->prepare("UPDATE call_logs SET ended_at = ?, duration_sec = ? WHERE id = ?");
        $stmt->execute([$endedAt, $durationSec, $callId]);

        $withVideo = (int)($call['with_video'] ?? 0);
        $label = $withVideo ? 'Видеозвонок' : 'Звонок';
        $mins = floor($durationSec / 60);
        $secs = $durationSec % 60;
        $durationText = $mins > 0 ? $mins . ' мин' : $secs . ' сек';
        $content = $label . ' завершён, длительность ' . $durationText;

        $stmt = $pdo->prepare("
            INSERT INTO messages (conversation_id, user_uuid, content, type)
            VALUES (?, NULL, ?, 'call')
        ");
        $stmt->execute([$call['conversation_id'], $content]);
        $callMessageId = (int) $pdo->lastInsertId();
        $callMessage = [
            'id' => $callMessageId,
            'conversation_id' => (int) $call['conversation_id'],
            'user_uuid' => null,
            'content' => $content,
            'type' => 'call',
            'created_at' => $endedAt,
        ];
        notifyWebSocketEvent('message.new', (int) $call['conversation_id'], $callMessage);

        notifyWebSocketEvent('call.end', $call['conversation_id'], [
            'call_id' => $callId,
            'ended_by_uuid' => $currentUserUuid,
        ]);

        jsonSuccess(['call_id' => $callId, 'duration_sec' => $durationSec]);
        break;

    case 'call_decline':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $callId = (int)($input['call_id'] ?? 0);
        if ($callId <= 0) {
            jsonError('Укажите call_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT id, conversation_id, caller_uuid, callee_uuid
            FROM call_logs
            WHERE id = ? AND ended_at IS NULL AND callee_uuid = ?
        ");
        $stmt->execute([$callId, $currentUserUuid]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonError('Звонок не найден или вы не абонент', 404);
        }
        $endedAt = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("UPDATE call_logs SET ended_at = ?, duration_sec = 0 WHERE id = ?");
        $stmt->execute([$endedAt, $callId]);
        $stmt = $pdo->prepare("
            INSERT INTO messages (conversation_id, user_uuid, content, type)
            VALUES (?, NULL, ?, 'call')
        ");
        $stmt->execute([$call['conversation_id'], 'Звонок отклонён']);
        $callMessageId = (int) $pdo->lastInsertId();
        $callMessage = [
            'id' => $callMessageId,
            'conversation_id' => (int) $call['conversation_id'],
            'user_uuid' => null,
            'content' => 'Звонок отклонён',
            'type' => 'call',
            'created_at' => $endedAt,
        ];
        notifyWebSocketEvent('message.new', (int) $call['conversation_id'], $callMessage);
        if (function_exists('notifyUserEvent')) {
            notifyUserEvent('call.rejected', $call['caller_uuid'], (int) $call['conversation_id'], [
                'call_id' => $callId,
                'callee_uuid' => $currentUserUuid,
                'conversation_id' => (int) $call['conversation_id'],
            ]);
        }
        notifyWebSocketEvent('call.end', (int) $call['conversation_id'], [
            'call_id' => $callId,
            'ended_by_uuid' => $currentUserUuid,
        ]);
        jsonSuccess(['ok' => true]);
        break;

    case 'invite':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $calleeUuid = trim((string)($input['callee_uuid'] ?? ''));
        $withVideo = !empty($input['with_video'] ?? false);
        $callId = (int)($input['call_id'] ?? 0);

        if ($conversationId <= 0 || $calleeUuid === '' || $callId <= 0) {
            jsonError('Укажите conversation_id, callee_uuid и call_id', 400);
        }

        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        $stmt->execute([$conversationId, $calleeUuid]);
        if (!$stmt->fetch()) {
            jsonError('Участник не в этой беседе', 400);
        }

        $stmt = $pdo->prepare("SELECT id FROM call_logs WHERE id = ? AND conversation_id = ? AND caller_uuid = ? AND ended_at IS NULL");
        $stmt->execute([$callId, $conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Звонок не найден или уже завершён', 404);
        }

        notifyWebSocketEvent('call.invite', $conversationId, [
            'caller_uuid' => $currentUserUuid,
            'callee_uuid' => $calleeUuid,
            'with_video' => $withVideo,
            'call_id' => $callId,
            'conversation_id' => $conversationId,
        ]);

        $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
        $inviteUrl = $baseUrl . '/#/c/' . $conversationId;
        $stmt = $pdo->prepare("SELECT username, display_name FROM users WHERE uuid = ?");
        $stmt->execute([$currentUserUuid]);
        $caller = $stmt->fetch(PDO::FETCH_ASSOC);
        $callerName = $caller ? trim($caller['display_name'] ?? $caller['username'] ?? '') : 'Кто-то';
        if ($callerName === '') $callerName = $caller['username'] ?? 'Кто-то';
        $pushTitle = $withVideo ? 'Входящий видеозвонок' : 'Входящий звонок';
        $pushBody = $callerName . ' звонит вам';
        sendPushToUser($calleeUuid, $pushTitle, $pushBody, $inviteUrl, [
            'type' => 'incoming_call',
            'conversation_id' => $conversationId,
            'call_id' => $callId,
            'caller_uuid' => $currentUserUuid,
            'with_video' => $withVideo,
        ]);

        jsonSuccess(['ok' => true]);
        break;

    case 'call_status':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $conversationId = (int)($_GET['conversation_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        $stmt = $pdo->prepare("
            SELECT id AS call_id, caller_uuid, callee_uuid, with_video
            FROM call_logs
            WHERE conversation_id = ? AND ended_at IS NULL
            AND (caller_uuid = ? OR callee_uuid = ?)
            LIMIT 1
        ");
        $stmt->execute([$conversationId, $currentUserUuid, $currentUserUuid]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonSuccess(['active' => false]);
            break;
        }
        jsonSuccess([
            'active' => true,
            'call_id' => (int) $call['call_id'],
            'caller_uuid' => $call['caller_uuid'],
            'callee_uuid' => $call['callee_uuid'],
            'with_video' => (bool) $call['with_video'],
            'i_am_callee' => ($call['callee_uuid'] === $currentUserUuid),
        ]);
        break;

    case 'call_request_offer':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $callId = (int)($input['call_id'] ?? 0);
        if ($callId <= 0) {
            jsonError('Укажите call_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT id, conversation_id, caller_uuid, callee_uuid
            FROM call_logs
            WHERE id = ? AND ended_at IS NULL AND callee_uuid = ?
        ");
        $stmt->execute([$callId, $currentUserUuid]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonError('Звонок не найден или вы не абонент', 404);
        }
        notifyWebSocketEvent('call.resend_offer', (int) $call['conversation_id'], [
            'call_id' => $callId,
            'callee_uuid' => $currentUserUuid,
            'caller_uuid' => $call['caller_uuid'],
        ]);
        jsonSuccess(['ok' => true]);
        break;

    case 'signaling':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $targetUuid = trim((string)($input['target_uuid'] ?? ''));
        $targetGuestId = (int)($input['target_guest_id'] ?? 0);
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        $sdp = $input['sdp'] ?? null;
        $ice = $input['ice'] ?? null;

        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        if ($targetUuid === '' && $targetGuestId <= 0) {
            jsonError('Укажите target_uuid или target_guest_id', 400);
        }
        if ($sdp === null && $ice === null) {
            jsonError('Укажите sdp или ice', 400);
        }

        if ($targetGuestId > 0) {
            $stmt = $pdo->prepare("
                SELECT gc.conversation_id FROM group_calls gc
                INNER JOIN group_call_participants gcp ON gcp.group_call_id = gc.id AND gcp.user_uuid = ? AND gcp.left_at IS NULL AND gcp.joined_at IS NOT NULL
                INNER JOIN group_call_guests gcg ON gcg.group_call_id = gc.id AND gcg.id = ? AND gcg.left_at IS NULL
                WHERE gc.id = ? AND gc.ended_at IS NULL
            ");
            $stmt->execute([$currentUserUuid, $targetGuestId, $groupCallId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                jsonError('Гость не в этом звонке или вы не участник', 403);
            }
            $conversationId = (int) $row['conversation_id'];
        } elseif ($groupCallId > 0) {
            $stmt = $pdo->prepare("
                SELECT gc.conversation_id FROM group_calls gc
                INNER JOIN group_call_participants gcp1 ON gcp1.group_call_id = gc.id AND gcp1.user_uuid = ? AND gcp1.left_at IS NULL AND gcp1.joined_at IS NOT NULL
                INNER JOIN group_call_participants gcp2 ON gcp2.group_call_id = gc.id AND gcp2.user_uuid = ? AND gcp2.left_at IS NULL AND gcp2.joined_at IS NOT NULL
                WHERE gc.id = ? AND gc.ended_at IS NULL
            ");
            $stmt->execute([$currentUserUuid, $targetUuid, $groupCallId]);
            if (!$stmt->fetch()) {
                jsonError('Оба участника должны быть в активном групповом звонке', 403);
            }
        } else {
            $stmt = $pdo->prepare("
                SELECT 1 FROM conversation_participants
                WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Беседа не найдена или нет доступа', 404);
            }
            $stmt->execute([$conversationId, $targetUuid]);
            if (!$stmt->fetch()) {
                jsonError('Участник не в этой беседе', 400);
            }
        }

        $payload = $sdp !== null
            ? ['from_uuid' => $currentUserUuid, 'sdp' => $sdp]
            : ['from_uuid' => $currentUserUuid, 'ice' => $ice];
        if ($targetGuestId > 0) {
            $payload['to_guest_id'] = $targetGuestId;
        } else {
            $payload['to_uuid'] = $targetUuid;
        }
        notifyWebSocketEvent($sdp !== null ? 'call.sdp' : 'call.ice', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'signaling_guest':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $guestToken = trim((string)($input['guest_token'] ?? ''));
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        $targetUuid = trim((string)($input['target_uuid'] ?? ''));
        $targetGuestId = (int)($input['target_guest_id'] ?? 0);
        $sdp = $input['sdp'] ?? null;
        $ice = $input['ice'] ?? null;
        if ($guestToken === '' || $groupCallId <= 0) {
            jsonError('Укажите guest_token и group_call_id', 400);
        }
        if ($targetUuid === '' && $targetGuestId <= 0) {
            jsonError('Укажите target_uuid или target_guest_id', 400);
        }
        if ($sdp === null && $ice === null) {
            jsonError('Укажите sdp или ice', 400);
        }
        $stmt = $pdo->prepare("
            SELECT gcg.id, gcg.display_name, gc.conversation_id
            FROM group_call_guests gcg
            INNER JOIN group_calls gc ON gc.id = gcg.group_call_id AND gc.ended_at IS NULL
            WHERE gcg.guest_token = ? AND gcg.group_call_id = ? AND gcg.left_at IS NULL
        ");
        $stmt->execute([$guestToken, $groupCallId]);
        $guest = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$guest) {
            jsonError('Гость не найден или вышел из звонка', 404);
        }
        $conversationId = (int) $guest['conversation_id'];
        $payload = $sdp !== null
            ? ['from_guest_id' => (int) $guest['id'], 'display_name' => $guest['display_name'], 'sdp' => $sdp]
            : ['from_guest_id' => (int) $guest['id'], 'ice' => $ice];
        if ($targetGuestId > 0) {
            $payload['to_guest_id'] = $targetGuestId;
        } else {
            $payload['to_uuid'] = $targetUuid;
        }
        notifyWebSocketEvent($sdp !== null ? 'call.sdp' : 'call.ice', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'group_status_guest':
        if ($method !== 'GET' && $method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $guestToken = trim((string)($_GET['guest_token'] ?? $_POST['guest_token'] ?? ''));
        $groupCallId = (int)($_GET['group_call_id'] ?? $_POST['group_call_id'] ?? 0);
        if ($guestToken === '' || $groupCallId <= 0) {
            jsonError('Укажите guest_token и group_call_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT gcg.id, gc.conversation_id, gc.with_video
            FROM group_call_guests gcg
            INNER JOIN group_calls gc ON gc.id = gcg.group_call_id AND gc.ended_at IS NULL
            WHERE gcg.guest_token = ? AND gcg.group_call_id = ? AND gcg.left_at IS NULL
        ");
        $stmt->execute([$guestToken, $groupCallId]);
        $guest = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$guest) {
            jsonError('Гость не найден или звонок завершён', 404);
        }
        $stmt = $pdo->prepare("
            SELECT gcp.user_uuid, COALESCE(u.display_name, u.username, 'Участник') AS display_name, gcp.joined_at, gcp.left_at
            FROM group_call_participants gcp
            LEFT JOIN users u ON u.uuid = gcp.user_uuid
            WHERE gcp.group_call_id = ? AND gcp.joined_at IS NOT NULL AND gcp.left_at IS NULL
            ORDER BY gcp.joined_at
        ");
        $stmt->execute([$groupCallId]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $stmt = $pdo->prepare("
            SELECT id, display_name, joined_at
            FROM group_call_guests
            WHERE group_call_id = ? AND left_at IS NULL
            ORDER BY joined_at
        ");
        $stmt->execute([$groupCallId]);
        $guests = $stmt->fetchAll(PDO::FETCH_ASSOC);
        jsonSuccess([
            'group_call_id' => $groupCallId,
            'conversation_id' => (int) $guest['conversation_id'],
            'with_video' => (bool) $guest['with_video'],
            'participants' => $participants,
            'guests' => $guests,
        ]);
        break;

    case 'group_start':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? $_POST['conversation_id'] ?? 0);
        $withVideo = !empty($input['with_video'] ?? $_POST['with_video'] ?? false);

        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }

        $stmt = $pdo->prepare("
            SELECT c.type FROM conversations c
            INNER JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_uuid = ? AND cp.hidden_at IS NULL
            WHERE c.id = ?
        ");
        $stmt->execute([$currentUserUuid, $conversationId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        if (($row['type'] ?? '') !== 'group') {
            jsonError('Групповой звонок доступен только для групповых бесед', 400);
        }

        $stmt = $pdo->prepare("SELECT id FROM group_calls WHERE conversation_id = ? AND ended_at IS NULL");
        $stmt->execute([$conversationId]);
        if ($stmt->fetch()) {
            jsonError('В этой беседе уже идёт групповой звонок. Присоединяйтесь.', 409);
        }

        $stmt = $pdo->prepare("
            INSERT INTO group_calls (conversation_id, created_by_uuid, with_video)
            VALUES (?, ?, ?)
        ");
        $stmt->execute([$conversationId, $currentUserUuid, $withVideo ? 1 : 0]);
        $groupCallId = (int) $pdo->lastInsertId();

        $stmt = $pdo->prepare("
            INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at)
            VALUES (?, ?, NOW())
        ");
        $stmt->execute([$groupCallId, $currentUserUuid]);

        $stmt = $pdo->prepare("
            SELECT user_uuid FROM conversation_participants
            WHERE conversation_id = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId]);
        $participants = $stmt->fetchAll(PDO::FETCH_COLUMN);

        notifyWebSocketEvent('call.group.started', $conversationId, [
            'group_call_id' => $groupCallId,
            'conversation_id' => $conversationId,
            'created_by_uuid' => $currentUserUuid,
            'with_video' => (bool) $withVideo,
            'participants' => [$currentUserUuid],
        ]);

        jsonSuccess(['group_call_id' => $groupCallId, 'participants' => $participants]);
        break;

    case 'group_join':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $groupCallId = (int)($input['group_call_id'] ?? $_POST['group_call_id'] ?? 0);
        $conversationId = (int)($input['conversation_id'] ?? $_POST['conversation_id'] ?? 0);

        if ($groupCallId <= 0 && $conversationId <= 0) {
            jsonError('Укажите group_call_id или conversation_id', 400);
        }

        if ($groupCallId <= 0 && $conversationId > 0) {
            $stmt = $pdo->prepare("SELECT id FROM group_calls WHERE conversation_id = ? AND ended_at IS NULL");
            $stmt->execute([$conversationId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $groupCallId = (int) $row['id'];
            }
        }

        if ($groupCallId <= 0) {
            jsonError('Активный групповой звонок не найден', 404);
        }

        $stmt = $pdo->prepare("
            SELECT gc.conversation_id, gc.with_video
            FROM group_calls gc
            INNER JOIN conversation_participants cp ON cp.conversation_id = gc.conversation_id AND cp.user_uuid = ? AND cp.hidden_at IS NULL
            WHERE gc.id = ? AND gc.ended_at IS NULL
        ");
        $stmt->execute([$currentUserUuid, $groupCallId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonError('Звонок не найден, завершён или вы не участник беседы', 404);
        }

        $stmt = $pdo->prepare("
            INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE joined_at = NOW(), left_at = NULL
        ");
        $stmt->execute([$groupCallId, $currentUserUuid]);

        $stmt = $pdo->prepare("
            SELECT user_uuid, joined_at, left_at
            FROM group_call_participants
            WHERE group_call_id = ? AND joined_at IS NOT NULL AND left_at IS NULL
            ORDER BY joined_at
        ");
        $stmt->execute([$groupCallId]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("SELECT id, display_name, joined_at FROM group_call_guests WHERE group_call_id = ? AND left_at IS NULL ORDER BY joined_at");
        $stmt->execute([$groupCallId]);
        $guests = $stmt->fetchAll(PDO::FETCH_ASSOC);

        notifyWebSocketEvent('call.group.joined', (int) $call['conversation_id'], [
            'group_call_id' => $groupCallId,
            'user_uuid' => $currentUserUuid,
        ]);

        jsonSuccess([
            'group_call_id' => $groupCallId,
            'conversation_id' => (int) $call['conversation_id'],
            'with_video' => (bool) $call['with_video'],
            'participants' => $participants,
            'guests' => $guests,
        ]);
        break;

    case 'group_leave':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $groupCallId = (int)($input['group_call_id'] ?? $_POST['group_call_id'] ?? 0);

        if ($groupCallId <= 0) {
            jsonError('Укажите group_call_id', 400);
        }

        $stmt = $pdo->prepare("
            SELECT gc.conversation_id, gc.with_video
            FROM group_calls gc
            INNER JOIN group_call_participants gcp ON gcp.group_call_id = gc.id AND gcp.user_uuid = ?
            WHERE gc.id = ? AND gc.ended_at IS NULL AND gcp.left_at IS NULL
        ");
        $stmt->execute([$currentUserUuid, $groupCallId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonError('Вы не в этом звонке или звонок завершён', 404);
        }

        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("UPDATE group_call_participants SET left_at = ? WHERE group_call_id = ? AND user_uuid = ?");
        $stmt->execute([$now, $groupCallId, $currentUserUuid]);

        notifyWebSocketEvent('call.group.left', (int) $call['conversation_id'], [
            'group_call_id' => $groupCallId,
            'user_uuid' => $currentUserUuid,
        ]);

        $stmt = $pdo->prepare("
            SELECT 1 FROM group_call_participants
            WHERE group_call_id = ? AND left_at IS NULL AND joined_at IS NOT NULL
        ");
        $stmt->execute([$groupCallId]);
        if (!$stmt->fetch()) {
            $stmt = $pdo->prepare("UPDATE group_calls SET ended_at = ? WHERE id = ?");
            $stmt->execute([$now, $groupCallId]);

            $stmt = $pdo->prepare("SELECT started_at FROM group_calls WHERE id = ?");
            $stmt->execute([$groupCallId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $durationSec = $row ? max(0, time() - strtotime($row['started_at'])) : 0;
            $label = $call['with_video'] ? 'Групповой видеозвонок' : 'Групповой звонок';
            $mins = floor($durationSec / 60);
            $secs = $durationSec % 60;
            $durationText = $mins > 0 ? $mins . ' мин' : $secs . ' сек';
            $content = $label . ' завершён, длительность ' . $durationText;

            $stmt = $pdo->prepare("
                INSERT INTO messages (conversation_id, user_uuid, content, type, group_call_id)
                VALUES (?, NULL, ?, 'call', ?)
            ");
            $stmt->execute([(int) $call['conversation_id'], $content, $groupCallId]);
            $callMessageId = (int) $pdo->lastInsertId();
            $callMessage = [
                'id' => $callMessageId,
                'conversation_id' => (int) $call['conversation_id'],
                'user_uuid' => null,
                'content' => $content,
                'type' => 'call',
                'created_at' => $now,
                'group_call_id' => $groupCallId,
            ];
            notifyWebSocketEvent('message.new', (int) $call['conversation_id'], $callMessage);

            notifyWebSocketEvent('call.group.ended', (int) $call['conversation_id'], [
                'group_call_id' => $groupCallId,
                'ended_by_uuid' => $currentUserUuid,
            ]);
        }

        jsonSuccess(['group_call_id' => $groupCallId]);
        break;

    case 'group_end':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $groupCallId = (int)($input['group_call_id'] ?? $_POST['group_call_id'] ?? 0);
        if ($groupCallId <= 0) {
            jsonError('Укажите group_call_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT gc.conversation_id, gc.with_video, gc.started_at
            FROM group_calls gc
            INNER JOIN group_call_participants gcp ON gcp.group_call_id = gc.id AND gcp.user_uuid = ?
            WHERE gc.id = ? AND gc.ended_at IS NULL AND gcp.left_at IS NULL
        ");
        $stmt->execute([$currentUserUuid, $groupCallId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonError('Вы не в этом звонке или звонок уже завершён', 404);
        }
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("UPDATE group_calls SET ended_at = ? WHERE id = ?");
        $stmt->execute([$now, $groupCallId]);
        $durationSec = max(0, time() - strtotime($call['started_at']));
        $label = $call['with_video'] ? 'Групповой видеозвонок' : 'Групповой звонок';
        $mins = floor($durationSec / 60);
        $secs = $durationSec % 60;
        $durationText = $mins > 0 ? $mins . ' мин' : $secs . ' сек';
        $content = $label . ' завершён для всех, длительность ' . $durationText;
        $stmt = $pdo->prepare("
            INSERT INTO messages (conversation_id, user_uuid, content, type, group_call_id)
            VALUES (?, NULL, ?, 'call', ?)
        ");
        $stmt->execute([(int) $call['conversation_id'], $content, $groupCallId]);
        $callMessageId = (int) $pdo->lastInsertId();
        $callMessage = [
            'id' => $callMessageId,
            'conversation_id' => (int) $call['conversation_id'],
            'user_uuid' => null,
            'content' => $content,
            'type' => 'call',
            'created_at' => $now,
            'group_call_id' => $groupCallId,
        ];
        notifyWebSocketEvent('message.new', (int) $call['conversation_id'], $callMessage);
        notifyWebSocketEvent('call.group.ended', (int) $call['conversation_id'], [
            'group_call_id' => $groupCallId,
            'ended_by_uuid' => $currentUserUuid,
        ]);
        jsonSuccess(['group_call_id' => $groupCallId]);
        break;

    case 'group_status':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $conversationId = (int)($_GET['conversation_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }

        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }

        $stmt = $pdo->prepare("
            SELECT id AS group_call_id, conversation_id, created_by_uuid, with_video, started_at
            FROM group_calls
            WHERE conversation_id = ? AND ended_at IS NULL
        ");
        $stmt->execute([$conversationId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonSuccess(['active' => false]);
            break;
        }

        $stmt = $pdo->prepare("
            SELECT gcp.user_uuid, COALESCE(u.display_name, u.username, 'Участник') AS display_name, gcp.joined_at, gcp.left_at
            FROM group_call_participants gcp
            LEFT JOIN users u ON u.uuid = gcp.user_uuid
            WHERE gcp.group_call_id = ? AND gcp.joined_at IS NOT NULL AND gcp.left_at IS NULL
            ORDER BY gcp.joined_at
        ");
        $stmt->execute([$call['group_call_id']]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("
            SELECT id, display_name, joined_at
            FROM group_call_guests
            WHERE group_call_id = ? AND left_at IS NULL
            ORDER BY joined_at
        ");
        $stmt->execute([$call['group_call_id']]);
        $guests = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $call['active'] = true;
        $call['participants'] = $participants;
        $call['guests'] = $guests;
        $call['with_video'] = (bool) $call['with_video'];
        jsonSuccess($call);
        break;

    case 'external_call_info':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $conversationId = (int)($_GET['conversation_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT c.type FROM conversations c
            INNER JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_uuid = ? AND cp.hidden_at IS NULL
            WHERE c.id = ?
        ");
        $stmt->execute([$currentUserUuid, $conversationId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || ($row['type'] ?? '') !== 'external') {
            jsonError('Беседа не найдена или это не внешний звонок', 404);
        }
        $stmt = $pdo->prepare("
            SELECT gc.id AS group_call_id, gc.with_video
            FROM group_calls gc
            WHERE gc.conversation_id = ? AND gc.ended_at IS NULL
        ");
        $stmt->execute([$conversationId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonSuccess(['active' => false]);
            break;
        }
        $groupCallId = (int) $call['group_call_id'];
        $stmt = $pdo->prepare("SELECT token FROM call_links WHERE group_call_id = ? AND (expires_at > UTC_TIMESTAMP() OR expires_at > NOW()) LIMIT 1");
        $stmt->execute([$groupCallId]);
        $link = $stmt->fetch(PDO::FETCH_ASSOC);
        $inviteUrl = null;
        if ($link) {
            $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
            $inviteUrl = $baseUrl . '/join-call.php?token=' . $link['token'];
        }
        jsonSuccess([
            'active' => true,
            'group_call_id' => $groupCallId,
            'conversation_id' => $conversationId,
            'with_video' => (bool) $call['with_video'],
            'invite_url' => $inviteUrl,
        ]);
        break;

    case 'group_call_participants':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $groupCallId = (int)($_GET['group_call_id'] ?? 0);
        if ($groupCallId <= 0) {
            jsonError('Укажите group_call_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT gc.conversation_id, gc.ended_at
            FROM group_calls gc
            WHERE gc.id = ?
        ");
        $stmt->execute([$groupCallId]);
        $call = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$call) {
            jsonError('Звонок не найден', 404);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([(int) $call['conversation_id'], $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Нет доступа к этому звонку', 404);
        }
        $stmt = $pdo->prepare("
            SELECT gcp.user_uuid, COALESCE(u.display_name, u.username, 'Участник') AS display_name, gcp.joined_at, gcp.left_at
            FROM group_call_participants gcp
            LEFT JOIN users u ON u.uuid = gcp.user_uuid
            WHERE gcp.group_call_id = ? AND gcp.joined_at IS NOT NULL
            ORDER BY gcp.joined_at
        ");
        $stmt->execute([$groupCallId]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $stmt = $pdo->prepare("
            SELECT id, display_name, joined_at, left_at
            FROM group_call_guests
            WHERE group_call_id = ?
            ORDER BY joined_at
        ");
        $stmt->execute([$groupCallId]);
        $guests = $stmt->fetchAll(PDO::FETCH_ASSOC);
        jsonSuccess([
            'participants' => $participants,
            'guests' => $guests,
            'ended_at' => $call['ended_at'],
        ]);
        break;

    case 'call_add_participant':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $callId = (int)($input['call_id'] ?? 0);
        $inviteeUuid = trim((string)($input['invitee_uuid'] ?? ''));

        if ($callId <= 0 || $inviteeUuid === '') {
            jsonError('Укажите call_id и invitee_uuid', 400);
        }
        if ($inviteeUuid === $currentUserUuid) {
            jsonError('Нельзя пригласить себя', 400);
        }

        $stmt = $pdo->prepare("
            SELECT id, conversation_id, caller_uuid, callee_uuid, with_video
            FROM call_logs
            WHERE id = ? AND ended_at IS NULL
        ");
        $stmt->execute([$callId]);
        $callLog = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$callLog) {
            jsonError('Звонок не найден или уже завершён', 404);
        }
        if ($currentUserUuid !== $callLog['caller_uuid'] && $currentUserUuid !== $callLog['callee_uuid']) {
            jsonError('Нет доступа к этому звонку', 403);
        }
        $callerUuid = $callLog['caller_uuid'];
        $calleeUuid = $callLog['callee_uuid'];
        $oldConversationId = (int) $callLog['conversation_id'];
        $withVideo = (int) $callLog['with_video'];

        $stmt = $pdo->prepare("SELECT 1 FROM users WHERE uuid = ?");
        $stmt->execute([$inviteeUuid]);
        if (!$stmt->fetch()) {
            jsonError('Пользователь не найден', 400);
        }

        $stmt = $pdo->prepare("SELECT id, conversation_id FROM group_calls WHERE origin_call_id = ? AND ended_at IS NULL");
        $stmt->execute([$callId]);
        $existingGroup = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($existingGroup) {
            $newConversationId = (int) $existingGroup['conversation_id'];
            $groupCallId = (int) $existingGroup['id'];
            $stmt = $pdo->prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_uuid = ?");
            $stmt->execute([$newConversationId, $inviteeUuid]);
            if (!$stmt->fetch()) {
                $stmt = $pdo->prepare("INSERT INTO conversation_participants (conversation_id, user_uuid) VALUES (?, ?)");
                $stmt->execute([$newConversationId, $inviteeUuid]);
            }
            $stmt = $pdo->prepare("
                INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at)
                VALUES (?, ?, NULL)
                ON DUPLICATE KEY UPDATE joined_at = NULL, left_at = NULL
            ");
            $stmt->execute([$groupCallId, $inviteeUuid]);
        } else {
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare("INSERT INTO conversations (type, name) VALUES ('group', 'Групповой звонок')");
                $stmt->execute();
                $newConversationId = (int) $pdo->lastInsertId();
                foreach ([$callerUuid, $calleeUuid, $inviteeUuid] as $uuid) {
                    $stmt = $pdo->prepare("INSERT INTO conversation_participants (conversation_id, user_uuid) VALUES (?, ?)");
                    $stmt->execute([$newConversationId, $uuid]);
                }
                $stmt = $pdo->prepare("
                    INSERT INTO group_calls (conversation_id, created_by_uuid, with_video, origin_call_id)
                    VALUES (?, ?, ?, ?)
                ");
                $stmt->execute([$newConversationId, $currentUserUuid, $withVideo, $callId]);
                $groupCallId = (int) $pdo->lastInsertId();
                $stmt = $pdo->prepare("INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at) VALUES (?, ?, NOW())");
                $stmt->execute([$groupCallId, $callerUuid]);
                $stmt->execute([$groupCallId, $calleeUuid]);
                $stmt = $pdo->prepare("INSERT INTO group_call_participants (group_call_id, user_uuid, joined_at) VALUES (?, ?, NULL)");
                $stmt->execute([$groupCallId, $inviteeUuid]);
                $pdo->commit();
            } catch (Exception $e) {
                $pdo->rollBack();
                jsonError('Не удалось создать групповой звонок', 500);
            }
        }

        $participantsInCall = [$callerUuid, $calleeUuid];
        $invited = [$inviteeUuid];
        notifyWebSocketEvent('call.converted_to_group', $oldConversationId, [
            'group_call_id' => $groupCallId,
            'new_conversation_id' => $newConversationId,
            'with_video' => (bool) $withVideo,
            'participants' => $participantsInCall,
            'invited' => $invited,
        ]);
        notifyWebSocketEvent('call.group.participant_invited', $newConversationId, [
            'group_call_id' => $groupCallId,
            'conversation_id' => $newConversationId,
            'inviter_uuid' => $currentUserUuid,
            'with_video' => (bool) $withVideo,
        ]);

        $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
        $inviteUrl = $baseUrl . '/#/c/' . $newConversationId;
        $stmt = $pdo->prepare("SELECT username, display_name FROM users WHERE uuid = ?");
        $stmt->execute([$currentUserUuid]);
        $inviter = $stmt->fetch(PDO::FETCH_ASSOC);
        $inviterName = trim($inviter['display_name'] ?? $inviter['username'] ?? 'Кто-то');
        sendPushToUser($inviteeUuid, 'Приглашение в звонок', $inviterName . ' приглашает вас в звонок', $inviteUrl, [
            'group_call_id' => $groupCallId,
            'conversation_id' => $newConversationId,
        ]);

        jsonSuccess([
            'group_call_id' => $groupCallId,
            'new_conversation_id' => $newConversationId,
            'invited' => $inviteeUuid,
        ]);
        break;

    case 'call_invites':
        if ($method !== 'GET') {
            jsonError('Метод не разрешён', 405);
        }
        $stmt = $pdo->prepare("
            SELECT gcp.group_call_id, gc.conversation_id, gc.with_video, gc.created_by_uuid AS inviter_uuid
            FROM group_call_participants gcp
            INNER JOIN group_calls gc ON gc.id = gcp.group_call_id AND gc.ended_at IS NULL
            WHERE gcp.user_uuid = ? AND gcp.joined_at IS NULL
            ORDER BY gc.started_at DESC
        ");
        $stmt->execute([$currentUserUuid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $invites = [];
        foreach ($rows as $r) {
            $invites[] = [
                'group_call_id' => (int) $r['group_call_id'],
                'conversation_id' => (int) $r['conversation_id'],
                'with_video' => (bool) $r['with_video'],
                'inviter_uuid' => $r['inviter_uuid'],
            ];
        }
        jsonSuccess(['invites' => $invites]);
        break;

    case 'call_decline_invite':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        if ($groupCallId <= 0) {
            jsonError('Укажите group_call_id', 400);
        }
        $stmt = $pdo->prepare("
            DELETE FROM group_call_participants
            WHERE group_call_id = ? AND user_uuid = ? AND joined_at IS NULL
        ");
        $stmt->execute([$groupCallId, $currentUserUuid]);
        jsonSuccess(['ok' => true]);
        break;

    case 'recording_started':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $callId = (int)($input['call_id'] ?? 0);
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        if ($groupCallId > 0) {
            $stmt = $pdo->prepare("
                SELECT 1 FROM group_call_participants
                WHERE group_call_id = ? AND user_uuid = ? AND left_at IS NULL
            ");
            $stmt->execute([$groupCallId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Вы не в этом групповом звонке', 403);
            }
        }
        $payload = [
            'recording_by_uuid' => $currentUserUuid,
            'conversation_id' => $conversationId,
        ];
        if ($callId > 0) $payload['call_id'] = $callId;
        if ($groupCallId > 0) $payload['group_call_id'] = $groupCallId;
        notifyWebSocketEvent('call.recording.started', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'recording_stopped':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $callId = (int)($input['call_id'] ?? 0);
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        $payload = [
            'recording_by_uuid' => $currentUserUuid,
            'conversation_id' => $conversationId,
        ];
        if ($callId > 0) $payload['call_id'] = $callId;
        if ($groupCallId > 0) $payload['group_call_id'] = $groupCallId;
        notifyWebSocketEvent('call.recording.stopped', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'screen_share_start':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        if ($groupCallId > 0) {
            $stmt = $pdo->prepare("
                SELECT 1 FROM group_call_participants
                WHERE group_call_id = ? AND user_uuid = ? AND left_at IS NULL
            ");
            $stmt->execute([$groupCallId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Вы не в этом групповом звонке', 403);
            }
        }
        $payload = [
            'from_uuid' => $currentUserUuid,
            'screen_share' => true,
            'conversation_id' => $conversationId,
        ];
        if ($groupCallId > 0) $payload['group_call_id'] = $groupCallId;
        notifyWebSocketEvent('call.screen_share', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'screen_share_stop':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        $payload = [
            'from_uuid' => $currentUserUuid,
            'screen_share' => false,
            'conversation_id' => $conversationId,
        ];
        if ($groupCallId > 0) $payload['group_call_id'] = $groupCallId;
        notifyWebSocketEvent('call.screen_share', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'call_muted':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($input['conversation_id'] ?? 0);
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        $muted = isset($input['muted']) ? (bool) $input['muted'] : null;
        if ($conversationId <= 0) {
            jsonError('Укажите conversation_id', 400);
        }
        if ($muted === null) {
            jsonError('Укажите muted (true/false)', 400);
        }
        $stmt = $pdo->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        $payload = [
            'from_uuid' => $currentUserUuid,
            'user_uuid' => $currentUserUuid,
            'muted' => $muted,
            'conversation_id' => $conversationId,
        ];
        if ($groupCallId > 0) {
            $payload['group_call_id'] = $groupCallId;
        }
        notifyWebSocketEvent('call.muted', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    case 'call_muted_guest':
        if ($method !== 'POST') {
            jsonError('Метод не разрешён', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $guestToken = trim((string)($input['guest_token'] ?? ''));
        $groupCallId = (int)($input['group_call_id'] ?? 0);
        $muted = isset($input['muted']) ? (bool) $input['muted'] : null;
        if ($guestToken === '' || $groupCallId <= 0) {
            jsonError('Укажите guest_token и group_call_id', 400);
        }
        if ($muted === null) {
            jsonError('Укажите muted (true/false)', 400);
        }
        $stmt = $pdo->prepare("
            SELECT gcg.id, gcg.display_name, gc.conversation_id
            FROM group_call_guests gcg
            INNER JOIN group_calls gc ON gc.id = gcg.group_call_id AND gc.ended_at IS NULL
            WHERE gcg.guest_token = ? AND gcg.group_call_id = ? AND gcg.left_at IS NULL
        ");
        $stmt->execute([$guestToken, $groupCallId]);
        $guest = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$guest) {
            jsonError('Гость не найден или вышел из звонка', 404);
        }
        $conversationId = (int) $guest['conversation_id'];
        $payload = [
            'from_guest_id' => (int) $guest['id'],
            'muted' => $muted,
            'conversation_id' => $conversationId,
            'group_call_id' => $groupCallId,
        ];
        notifyWebSocketEvent('call.muted', $conversationId, $payload);
        jsonSuccess(['ok' => true]);
        break;

    default:
        jsonError('Неизвестное действие', 400);
}
