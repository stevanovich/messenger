<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}

updateLastSeenIfNeeded();

$method = $_SERVER['REQUEST_METHOD'];
$currentUserUuid = getCurrentUserUuid();
global $pdo;

switch ($method) {
    case 'GET':
        // Получение одной беседы по id (для просмотра информации о группе и списка участников)
        $conversationId = (int)($_GET['id'] ?? 0);
        if ($conversationId > 0) {
            $stmt = $pdo->prepare("
                SELECT c.id, c.type, c.name, c.avatar, c.created_at, COALESCE(cp.notifications_enabled, 1) as notifications_enabled, cp.role as my_role
                FROM conversations c
                INNER JOIN conversation_participants cp ON c.id = cp.conversation_id AND cp.hidden_at IS NULL
                WHERE c.id = ? AND cp.user_uuid = ?
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            $conv = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($conv && isset($conv['notifications_enabled'])) {
                $conv['notifications_enabled'] = (int) $conv['notifications_enabled'];
            }
            if (!$conv) {
                jsonError('Беседа не найдена или нет доступа', 404);
            }
            if ($conv['type'] === 'group' || $conv['type'] === 'external') {
                $stmt = $pdo->prepare("
                    SELECT u.uuid, u.username, u.display_name, u.status, u.avatar, cp.role
                    FROM conversation_participants cp
                    JOIN users u ON cp.user_uuid = u.uuid
                    WHERE cp.conversation_id = ? AND cp.hidden_at IS NULL
                    ORDER BY cp.role DESC, u.username
                ");
                $stmt->execute([$conversationId]);
                $conv['participants'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                $conv['participant_count'] = count($conv['participants']);
            }
            jsonSuccess(['conversation' => $conv]);
        }

        // Получение списка бесед (чаты с активным звонком — выше в списке)
        $stmt = $pdo->prepare("
            SELECT 
                c.id,
                c.type,
                c.name,
                c.avatar,
                c.created_at,
                (SELECT COUNT(*) FROM conversation_participants cp2 WHERE cp2.conversation_id = c.id) as participant_count,
                (SELECT m.content 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                   AND m.deleted_at IS NULL 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message,
                (SELECT m.type 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                   AND m.deleted_at IS NULL 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message_type,
                (SELECT CONCAT(COALESCE(m.file_path, ''), COALESCE(m.file_name, '')) 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                   AND m.deleted_at IS NULL 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message_file_path,
                (SELECT m.created_at 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                   AND m.deleted_at IS NULL 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message_time,
                (SELECT COALESCE(m.encrypted, 0) 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                   AND m.deleted_at IS NULL 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message_encrypted,
                (SELECT COUNT(*) 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                   AND m.deleted_at IS NULL
                   AND m.user_uuid != ?
                   AND NOT EXISTS (
                       SELECT 1 FROM message_reads mr 
                       WHERE mr.message_id = m.id AND mr.user_uuid = ?
                   )) as unread_count,
                COALESCE(cp.notifications_enabled, 1) as notifications_enabled,
                COALESCE(
                    (SELECT 1 FROM group_calls gc WHERE gc.conversation_id = c.id AND gc.ended_at IS NULL LIMIT 1),
                    (SELECT 1 FROM call_logs cl WHERE cl.conversation_id = c.id AND cl.ended_at IS NULL AND (cl.caller_uuid = ? OR cl.callee_uuid = ?) LIMIT 1),
                    0
                ) AS has_active_call,
                (SELECT 1 FROM call_logs cl WHERE cl.conversation_id = c.id AND cl.ended_at IS NULL AND cl.callee_uuid = ? LIMIT 1) AS incoming_1_1_call
            FROM conversations c
            INNER JOIN conversation_participants cp ON c.id = cp.conversation_id AND cp.hidden_at IS NULL
            WHERE cp.user_uuid = ?
            ORDER BY has_active_call DESC, last_message_time DESC, c.created_at DESC
        ");
        $stmt->execute([$currentUserUuid, $currentUserUuid, $currentUserUuid, $currentUserUuid, $currentUserUuid, $currentUserUuid]);
        $conversations = $stmt->fetchAll();
        
        // Получение информации об участниках для приватных чатов
        foreach ($conversations as &$conv) {
            if ($conv['type'] === 'private') {
                $stmt = $pdo->prepare("
                    SELECT u.uuid, u.username, u.display_name, u.status, u.avatar, u.last_seen
                    FROM conversation_participants cp
                    JOIN users u ON cp.user_uuid = u.uuid
                    WHERE cp.conversation_id = ? AND cp.user_uuid != ?
                ");
                $stmt->execute([$conv['id'], $currentUserUuid]);
                $otherUser = $stmt->fetch();
                if ($otherUser) {
                    $conv['other_user'] = ['uuid' => $otherUser['uuid'], 'username' => $otherUser['username'], 'display_name' => $otherUser['display_name'] ?? null, 'status' => $otherUser['status'] ?? null, 'avatar' => $otherUser['avatar'], 'last_seen' => $otherUser['last_seen']];
                    if (!$conv['name']) {
                        $conv['name'] = !empty($otherUser['display_name']) ? $otherUser['display_name'] : $otherUser['username'];
                    }
                    if (!$conv['avatar']) {
                        $conv['avatar'] = $otherUser['avatar'];
                    }
                }
            }
        }
        
        jsonSuccess(['conversations' => $conversations]);
        break;
        
    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $action = $data['action'] ?? $_GET['action'] ?? '';

        // Добавление участников в группу (только для type=group, только админ)
        if ($action === 'add_participants') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            $userUuids = $data['user_uuids'] ?? [];
            if (!$conversationId || !is_array($userUuids) || empty($userUuids)) {
                jsonError('Укажите conversation_id и массив user_uuids');
            }
            $stmt = $pdo->prepare("SELECT c.type, cp.role FROM conversations c INNER JOIN conversation_participants cp ON c.id = cp.conversation_id AND cp.hidden_at IS NULL WHERE c.id = ? AND cp.user_uuid = ?");
            $stmt->execute([$conversationId, $currentUserUuid]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                jsonError('Беседа не найдена или нет доступа', 404);
            }
            if ($row['type'] !== 'group') {
                jsonError('Добавлять участников можно только в группу');
            }
            if ($row['role'] !== 'admin') {
                jsonError('Только администратор группы может добавлять участников', 403);
            }
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare("INSERT IGNORE INTO conversation_participants (conversation_id, user_uuid, role) VALUES (?, ?, 'member')");
                $added = 0;
                foreach ($userUuids as $userUuid) {
                    $userUuid = trim((string) $userUuid);
                    if ($userUuid === '') continue;
                    $stmtU = $pdo->prepare("SELECT uuid FROM users WHERE uuid = ?");
                    $stmtU->execute([$userUuid]);
                    if (!$stmtU->fetch()) continue;
                    if ($userUuid === $currentUserUuid) continue; // уже в группе
                    $stmt->execute([$conversationId, $userUuid]);
                    if ($stmt->rowCount() > 0) $added++;
                }
                $pdo->commit();
                jsonSuccess(['added' => $added], $added ? 'Участники добавлены' : 'Нет новых участников для добавления');
            } catch (Exception $e) {
                $pdo->rollBack();
                jsonError('Ошибка при добавлении участников');
            }
        }

        // Создание новой беседы
        $type = $data['type'] ?? 'private';
        $name = trim($data['name'] ?? '');
        $participants = $data['participants'] ?? [];
        
        if ($type === 'private') {
            // Приватный чат - нужен один участник (передаётся uuid)
            if (count($participants) !== 1) {
                jsonError('Для приватного чата нужен один участник');
            }
            $otherUserUuid = trim($participants[0]);
            $stmt = $pdo->prepare("SELECT uuid FROM users WHERE uuid = ?");
            $stmt->execute([$otherUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Пользователь не найден');
            }
            
            // Проверка существования приватного чата (без учёта hidden_at — беседа одна на пару)
            $stmt = $pdo->prepare("
                SELECT c.id
                FROM conversations c
                INNER JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_uuid = ?
                INNER JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_uuid = ?
                WHERE c.type = 'private'
            ");
            $stmt->execute([$currentUserUuid, $otherUserUuid]);
            $existing = $stmt->fetch();
            
            if ($existing) {
                // Вернуть беседу в список у текущего пользователя (если скрывал)
                $pdo->prepare("UPDATE conversation_participants SET hidden_at = NULL WHERE conversation_id = ? AND user_uuid = ?")
                    ->execute([$existing['id'], $currentUserUuid]);
                jsonSuccess(['conversation_id' => $existing['id']], 'Беседа уже существует');
            }
        } elseif ($type === 'group') {
            if (empty($name)) {
                jsonError('Название группы обязательно');
            }
            if (empty($participants)) {
                jsonError('Добавьте участников группы');
            }
        } elseif ($type === 'external') {
            // Внешняя беседа = звонок (аудио/видео) по ссылке для людей без аккаунта и с аккаунтом
            $name = $name ?: 'Внешний звонок';
            $participants = [];
        }
        
        // Создание беседы
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("
                INSERT INTO conversations (type, name) 
                VALUES (?, ?)
            ");
            $stmt->execute([$type, $name ?: null]);
            $conversationId = $pdo->lastInsertId();
            
            // Добавление текущего пользователя
            $stmt = $pdo->prepare("
                INSERT INTO conversation_participants (conversation_id, user_uuid, role)
                VALUES (?, ?, 'admin')
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            
            // Добавление других участников (participants — массив uuid)
            $stmt = $pdo->prepare("
                INSERT INTO conversation_participants (conversation_id, user_uuid, role)
                VALUES (?, ?, 'member')
            ");
            foreach ($participants as $userUuid) {
                $userUuid = trim($userUuid);
                $stmtU = $pdo->prepare("SELECT uuid FROM users WHERE uuid = ?");
                $stmtU->execute([$userUuid]);
                if ($stmtU->fetch()) {
                    $stmt->execute([$conversationId, $userUuid]);
                }
            }
            
            $inviteUrl = null;
            $linkToken = null;
            $expiresAt = null;
            $groupCallId = null;
            if ($type === 'external') {
                $withVideo = !empty($data['with_video']);
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
                $linkToken = bin2hex(random_bytes(24));
                $expiresAt = gmdate('Y-m-d H:i:s', time() + 604800); // 7 дней, UTC
                $stmt = $pdo->prepare("
                    INSERT INTO call_links (token, group_call_id, call_id, created_by_uuid, expires_at)
                    VALUES (?, ?, NULL, ?, ?)
                ");
                $stmt->execute([$linkToken, $groupCallId, $currentUserUuid, $expiresAt]);
                $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
                $inviteUrl = $baseUrl . '/join-call.php?token=' . $linkToken;
            }
            
            $pdo->commit();
            $payload = ['conversation_id' => (int) $conversationId];
            if ($inviteUrl !== null) {
                $payload['invite_url'] = $inviteUrl;
                $payload['link_token'] = $linkToken;
                $payload['expires_at'] = $expiresAt;
                $payload['group_call_id'] = $groupCallId;
            }
            jsonSuccess($payload, $type === 'external' ? 'Внешний звонок создан' : 'Беседа создана');
        } catch (Exception $e) {
            $pdo->rollBack();
            jsonError('Ошибка при создании беседы');
        }
        break;
        
    case 'DELETE':
        // Удаление участника из группы (id, user_uuid) или скрытие беседы для себя (только id)
        $conversationId = (int)($_GET['id'] ?? 0);
        $removeUserUuid = trim((string)($_GET['user_uuid'] ?? ''));
        if (!$conversationId) {
            jsonError('Не указан ID беседы');
        }

        // Проверка участия текущего пользователя
        $stmt = $pdo->prepare("
            SELECT c.type, cp.role FROM conversations c
            INNER JOIN conversation_participants cp ON c.id = cp.conversation_id AND cp.hidden_at IS NULL
            WHERE c.id = ? AND cp.user_uuid = ?
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        $myParticipation = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$myParticipation) {
            jsonError('Нет доступа к этой беседе', 403);
        }

        if ($removeUserUuid !== '') {
            // Удаление участника из группы (исключить другого или выйти самому)
            if ($myParticipation['type'] !== 'group' && $myParticipation['type'] !== 'external') {
                jsonError('Удаление участников доступно только для групп', 400);
            }
            $isSelf = ($removeUserUuid === $currentUserUuid);
            if (!$isSelf && $myParticipation['role'] !== 'admin') {
                jsonError('Только администратор может исключать участников', 403);
            }
            $stmt = $pdo->prepare("
                SELECT id FROM conversation_participants
                WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
            ");
            $stmt->execute([$conversationId, $removeUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Участник не найден в группе', 404);
            }
            $pdo->prepare("
                UPDATE conversation_participants SET hidden_at = NOW()
                WHERE conversation_id = ? AND user_uuid = ?
            ")->execute([$conversationId, $removeUserUuid]);
            // Forward secrecy (E2EE этап 5): при уходе участника инвалидируем ключ группы
            try {
                $pdo->prepare("DELETE FROM conversation_member_keys WHERE conversation_id = ?")->execute([$conversationId]);
            } catch (PDOException $e) {
                // таблица может отсутствовать до миграции 002
            }
            jsonSuccess(null, $isSelf ? 'Вы вышли из группы' : 'Участник исключён');
            break;
        }

        // Скрытие беседы для текущего пользователя (исходное поведение)
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("
                UPDATE conversation_participants
                SET hidden_at = NOW()
                WHERE conversation_id = ? AND user_uuid = ?
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);

            // Forward secrecy (E2EE этап 5): при уходе из группы инвалидируем ключ группы
            try {
                $pdo->prepare("DELETE FROM conversation_member_keys WHERE conversation_id = ?")->execute([$conversationId]);
            } catch (PDOException $e) {
                // таблица может отсутствовать до миграции 002
            }

            $stmt = $pdo->prepare("
                SELECT COUNT(*) FROM conversation_participants
                WHERE conversation_id = ? AND hidden_at IS NULL
            ");
            $stmt->execute([$conversationId]);
            $visibleCount = (int) $stmt->fetchColumn();
            if ($visibleCount === 0) {
                $pdo->prepare("DELETE FROM conversations WHERE id = ?")->execute([$conversationId]);
            }

            $pdo->commit();
            jsonSuccess(null, 'Беседа удалена');
        } catch (Exception $e) {
            $pdo->rollBack();
            jsonError('Ошибка при удалении беседы');
        }
        break;

    case 'PATCH':
        // Настройка уведомлений для беседы (только для текущего участника)
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $conversationId = (int)($data['conversation_id'] ?? $_GET['id'] ?? 0);
        $notificationsEnabled = isset($data['notifications_enabled']) ? (bool) $data['notifications_enabled'] : null;
        if ($conversationId <= 0 || $notificationsEnabled === null) {
            jsonError('Укажите conversation_id и notifications_enabled (true/false)');
        }
        $stmt = $pdo->prepare("
            UPDATE conversation_participants
            SET notifications_enabled = ?
            WHERE conversation_id = ? AND user_uuid = ?
        ");
        $stmt->execute([$notificationsEnabled ? 1 : 0, $conversationId, $currentUserUuid]);
        if ($stmt->rowCount() === 0) {
            jsonError('Беседа не найдена или нет доступа', 404);
        }
        jsonSuccess(['notifications_enabled' => $notificationsEnabled]);
        break;
        
    default:
        jsonError('Метод не поддерживается', 405);
}
