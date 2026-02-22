<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/locale.php';
initLocale();

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}

updateLastSeenIfNeeded();

$method = $_SERVER['REQUEST_METHOD'];
$currentUserUuid = getCurrentUserUuid();
global $pdo;

try {
switch ($method) {
    case 'GET':
        // Поиск по тексту сообщений в переписках пользователя (только незашифрованные)
        $searchAction = $_GET['action'] ?? '';
        $searchQuery = trim((string)($_GET['q'] ?? ''));
        if ($searchAction === 'search') {
            if (mb_strlen($searchQuery) < 2) {
                jsonSuccess(['results' => []]);
                exit;
            }
            $searchTerm = '%' . $searchQuery . '%';
            $limit = min((int)($_GET['limit'] ?? 30), 50);
            $stmt = $pdo->prepare("
                SELECT m.id AS message_id, m.conversation_id, m.content, m.created_at
                FROM messages m
                INNER JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_uuid = ?
                WHERE m.deleted_at IS NULL AND (m.encrypted = 0 OR m.encrypted IS NULL) AND m.type = 'text'
                  AND m.content LIKE ?
                ORDER BY m.created_at DESC
                LIMIT ?
            ");
            $stmt->execute([$currentUserUuid, $searchTerm, $limit]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $snippetLen = 80;
            $results = [];
            foreach ($rows as $r) {
                $content = (string)($r['content'] ?? '');
                $preview = mb_strlen($content) > $snippetLen ? mb_substr($content, 0, $snippetLen) . '…' : $content;
                $results[] = [
                    'conversation_id' => (int)$r['conversation_id'],
                    'message_id' => (int)$r['message_id'],
                    'content_preview' => $preview,
                    'created_at' => $r['created_at'] ?? null,
                ];
            }
            jsonSuccess(['results' => $results]);
            exit;
        }

        // Получение сообщений
        $conversationId = $_GET['conversation_id'] ?? 0;
        $lastMessageId = $_GET['last_message_id'] ?? 0;
        $limit = min((int)($_GET['limit'] ?? 50), 100);
        
        if (!$conversationId) {
            jsonError('Не указан ID беседы');
        }
        
        // Проверка участия в беседе
        $stmt = $pdo->prepare("
            SELECT cp.conversation_id
            FROM conversation_participants cp
            WHERE cp.conversation_id = ? AND cp.user_uuid = ?
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Нет доступа к этой беседе', 403);
        }

        // Получение сообщений (LEFT JOIN — user_uuid может быть NULL для анонимизированных)
        if ($lastMessageId > 0) {
            $stmt = $pdo->prepare("
                SELECT m.*, u.username, u.display_name, u.avatar,
                       (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id) as read_count,
                       (SELECT COUNT(*) FROM message_deliveries md WHERE md.message_id = m.id) as delivery_count
                FROM messages m
                LEFT JOIN users u ON m.user_uuid = u.uuid
                WHERE m.conversation_id = ?
                  AND m.id > ?
                  AND m.deleted_at IS NULL
                ORDER BY m.created_at ASC
                LIMIT ?
            ");
            $stmt->execute([$conversationId, $lastMessageId, $limit]);
            $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } else {
            $stmt = $pdo->prepare("
                SELECT m.*, u.username, u.display_name, u.avatar,
                       (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id) as read_count,
                       (SELECT COUNT(*) FROM message_deliveries md WHERE md.message_id = m.id) as delivery_count
                FROM messages m
                LEFT JOIN users u ON m.user_uuid = u.uuid
                WHERE m.conversation_id = ?
                  AND m.deleted_at IS NULL
                ORDER BY m.created_at DESC
                LIMIT ?
            ");
            $stmt->execute([$conversationId, $limit]);
            $messages = array_reverse($stmt->fetchAll());
        }
        foreach ($messages as &$m) {
            $dn = trim($m['display_name'] ?? '');
            $un = trim($m['username'] ?? '');
            $m['username'] = $dn ?: ($un ?: 'неизвестный автор');
        }
        unset($m);
        
        // Получение реакций для сообщений (анонимно, сгруппировано по emoji)
        $messageIds = array_column($messages, 'id');
        $reactions = [];
        if (!empty($messageIds)) {
            $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
            $stmt = $pdo->prepare("
                SELECT mr.message_id, mr.emoji, mr.user_uuid, u.avatar, u.display_name, u.username
                FROM message_reactions mr
                LEFT JOIN users u ON u.uuid = mr.user_uuid
                WHERE mr.message_id IN ($placeholders)
            ");
            $stmt->execute($messageIds);
            $allReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $rawByMessage = [];
            foreach ($allReactions as $r) {
                $mid = (int)$r['message_id'];
                if (!isset($rawByMessage[$mid])) {
                    $rawByMessage[$mid] = [];
                }
                $rawByMessage[$mid][] = $r;
            }
            foreach ($rawByMessage as $mid => $list) {
                $reactions[$mid] = groupReactionsByEmoji($list, $currentUserUuid);
            }
        }
        
        // Добавление реакций и reply_to к сообщениям
        $replyToIds = array_filter(array_unique(array_column($messages, 'reply_to_id')));
        $replyToMap = [];
        if (!empty($replyToIds)) {
            $placeholders = implode(',', array_fill(0, count($replyToIds), '?'));
            $stmt = $pdo->prepare("
                SELECT r.id, r.content, r.type, r.file_name, r.deleted_at, r.encrypted, u.username, u.display_name
                FROM messages r
                LEFT JOIN users u ON r.user_uuid = u.uuid
                WHERE r.id IN ($placeholders)
            ");
            $stmt->execute(array_values($replyToIds));
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $replyToMap[(int) $row['id']] = buildReplyToObject($row);
            }
        }
        // forwarded_from: объект для пересланных сообщений
        $forwardedFromIds = array_filter(array_unique(array_column($messages, 'forwarded_from_message_id')));
        $forwardedFromMap = [];
        if (!empty($forwardedFromIds)) {
            $placeholders = implode(',', array_fill(0, count($forwardedFromIds), '?'));
            $stmt = $pdo->prepare("
                SELECT r.id, r.content, r.type, r.file_path, r.file_name, r.deleted_at, u.username, u.display_name
                FROM messages r
                LEFT JOIN users u ON r.user_uuid = u.uuid
                WHERE r.id IN ($placeholders)
            ");
            $stmt->execute(array_values($forwardedFromIds));
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $forwardedFromMap[(int) $row['id']] = buildForwardedFromObject($row);
            }
        }
        // read_details: кто и когда прочитал (для tooltip)
        $readDetailsMap = [];
        $readByMeIds = [];
        if (!empty($messageIds)) {
            $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
            $stmt = $pdo->prepare("
                SELECT mr.message_id, mr.read_at, u.display_name, u.username
                FROM message_reads mr
                JOIN users u ON mr.user_uuid = u.uuid
                WHERE mr.message_id IN ($placeholders)
                ORDER BY mr.read_at ASC
            ");
            $stmt->execute($messageIds);
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $mid = (int) $row['message_id'];
                if (!isset($readDetailsMap[$mid])) {
                    $readDetailsMap[$mid] = [];
                }
                $readDetailsMap[$mid][] = [
                    'username' => trim($row['display_name'] ?? '') ?: trim($row['username'] ?? '') ?: '—',
                    'read_at' => $row['read_at'],
                ];
            }
            // Сообщения, прочитанные текущим пользователем (для прокрутки к первому непрочитанному)
            $stmt = $pdo->prepare("
                SELECT message_id FROM message_reads
                WHERE user_uuid = ? AND message_id IN ($placeholders)
            ");
            $stmt->execute(array_merge([$currentUserUuid], $messageIds));
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $readByMeIds[(int) $row['message_id']] = true;
            }
        }

        // recipient_count: количество получателей (участники − 1)
        $stmt = $pdo->prepare("
            SELECT COUNT(*) FROM conversation_participants
            WHERE conversation_id = ? AND (hidden_at IS NULL OR hidden_at > NOW())
        ");
        $stmt->execute([$conversationId]);
        $recipientCount = max(0, (int) $stmt->fetchColumn() - 1);

        foreach ($messages as &$message) {
            $message['reactions'] = $reactions[$message['id']] ?? [];
            $message['read_details'] = $readDetailsMap[$message['id']] ?? [];
            $message['recipient_count'] = $recipientCount;
            $message['delivery_count'] = (int) ($message['delivery_count'] ?? 0);
            $message['read_count'] = (int) ($message['read_count'] ?? 0);
            // Свои сообщения считаем всегда прочитанными; чужие — по message_reads
            $message['read_by_me'] = ($message['user_uuid'] ?? '') === $currentUserUuid
                || !empty($readByMeIds[(int) $message['id']]);
            $rid = isset($message['reply_to_id']) ? (int) $message['reply_to_id'] : 0;
            if ($rid > 0) {
                $message['reply_to'] = $replyToMap[$rid] ?? [
                    'id' => $rid,
                    'content_preview' => '[Сообщение удалено]',
                    'username' => '',
                    'type' => 'text',
                ];
            } else {
                $message['reply_to'] = null;
            }
            $fid = isset($message['forwarded_from_message_id']) ? (int) $message['forwarded_from_message_id'] : 0;
            if ($fid > 0) {
                $message['forwarded_from'] = $forwardedFromMap[$fid] ?? [
                    'message_id' => $fid,
                    'username' => '',
                    'type' => 'text',
                    'content' => '[Сообщение удалено]',
                ];
            } else {
                $message['forwarded_from'] = null;
            }
        }
        unset($message);
        
        jsonSuccess(['messages' => $messages]);
        break;
        
    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $action = $data['action'] ?? null;

        // Пересылка сообщений в другой чат
        if ($action === 'forward') {
            $targetConversationId = (int)($data['target_conversation_id'] ?? 0);
            $messageIds = $data['message_ids'] ?? [];
            if (!is_array($messageIds)) {
                $messageIds = $messageIds ? [ (int) $messageIds ] : [];
            } else {
                $messageIds = array_map('intval', array_values($messageIds));
            }
            $messageIds = array_filter($messageIds);
            $messageIds = array_unique($messageIds);
            if ($targetConversationId <= 0) {
                jsonError('Не указан чат для пересылки', 400);
            }
            if (empty($messageIds)) {
                jsonError('Не выбрано ни одного сообщения', 400);
            }
            if (count($messageIds) > 50) {
                jsonError('Не более 50 сообщений за раз', 400);
            }
            // Проверка участия в целевом чате
            $stmt = $pdo->prepare("
                SELECT 1 FROM conversation_participants cp
                WHERE cp.conversation_id = ? AND cp.user_uuid = ?
            ");
            $stmt->execute([$targetConversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к выбранному чату', 403);
            }
            $stmt = $pdo->prepare("
                SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ?
            ");
            $stmt->execute([$targetConversationId]);
            if ((int) $stmt->fetchColumn() < 2) {
                jsonError(t('chat.cannot_send_contact_deleted'), 403);
            }
            // Получить сообщения: только из бесед, где пользователь участник, не удалённые, не call
            $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
            $stmt = $pdo->prepare("
                SELECT m.id, m.content, m.encrypted, m.encryption_algorithm, m.type, m.file_path, m.file_name, m.file_size, m.user_uuid
                FROM messages m
                INNER JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_uuid = ?
                WHERE m.id IN ($placeholders) AND m.deleted_at IS NULL AND m.type != 'call'
            ");
            $stmt->execute(array_merge([$currentUserUuid], $messageIds));
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $foundIds = array_column($rows, 'id');
            $requestedSet = array_flip($messageIds);
            foreach (array_keys($requestedSet) as $mid) {
                if (!in_array($mid, $foundIds, true)) {
                    jsonError('Нельзя переслать одно или несколько сообщений (возможно, это звонки или удалённые сообщения)', 400);
                }
            }
            // Сортировка по порядку messageIds
            $byId = [];
            foreach ($rows as $r) {
                $byId[(int) $r['id']] = $r;
            }
            $ordered = [];
            foreach ($messageIds as $mid) {
                if (isset($byId[$mid])) {
                    $ordered[] = $byId[$mid];
                }
            }
            // Опционально: клиент присылает уже расшифрованный и при необходимости зашифрованный для целевого чата контент (E2EE: пересланные сообщения должны быть читаемы в целевом чате)
            $clientMessages = $data['messages'] ?? [];
            $useClientContent = is_array($clientMessages) && count($clientMessages) === count($ordered);

            $created = [];
            $insertStmt = $pdo->prepare("
                INSERT INTO messages (conversation_id, user_uuid, content, encrypted, encryption_algorithm, reply_to_id, forwarded_from_message_id, type, file_path, file_name, file_size)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
            ");
            foreach ($ordered as $idx => $row) {
                if ($useClientContent && isset($clientMessages[$idx]) && is_array($clientMessages[$idx])) {
                    $cm = $clientMessages[$idx];
                    $content = isset($cm['content']) ? (string) $cm['content'] : ($row['content'] ?? '');
                    $encrypted = isset($cm['encrypted']) ? (int) (bool) $cm['encrypted'] : (int) ($row['encrypted'] ?? 0);
                    $encAlgo = isset($cm['encryption_algorithm']) ? trim((string) $cm['encryption_algorithm']) : null;
                    if ($encAlgo === '') $encAlgo = null;
                } else {
                    $content = $row['content'] ?? '';
                    $encrypted = (int) ($row['encrypted'] ?? 0);
                    $encAlgo = isset($row['encryption_algorithm']) ? $row['encryption_algorithm'] : null;
                }
                $insertStmt->execute([
                    $targetConversationId,
                    $currentUserUuid,
                    $content,
                    $encrypted,
                    $encAlgo,
                    $row['id'],
                    $row['type'] ?? 'text',
                    $row['file_path'] ?? null,
                    $row['file_name'] ?? null,
                    $row['file_size'] ?? null,
                ]);
                $newId = $pdo->lastInsertId();
                $stmt = $pdo->prepare("
                    SELECT m.*, u.username, u.display_name, u.avatar
                    FROM messages m
                    LEFT JOIN users u ON m.user_uuid = u.uuid
                    WHERE m.id = ?
                ");
                $stmt->execute([$newId]);
                $message = $stmt->fetch(PDO::FETCH_ASSOC);
                $dn = trim($message['display_name'] ?? '');
                $un = trim($message['username'] ?? '');
                $message['username'] = $dn ?: ($un ?: 'неизвестный автор');
                $message['reactions'] = [];
                $message['reply_to'] = null;
                $fid = (int) $row['id'];
                $stmt = $pdo->prepare("
                    SELECT r.id, r.content, r.type, r.file_path, r.file_name, r.deleted_at, u.username, u.display_name
                    FROM messages r
                    LEFT JOIN users u ON r.user_uuid = u.uuid
                    WHERE r.id = ?
                ");
                $stmt->execute([$fid]);
                $origRow = $stmt->fetch(PDO::FETCH_ASSOC);
                $message['forwarded_from'] = $origRow ? buildForwardedFromObject($origRow) : [
                    'message_id' => $fid,
                    'username' => '',
                    'type' => 'text',
                    'content' => '[Сообщение удалено]',
                ];
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ? AND (hidden_at IS NULL OR hidden_at > NOW())");
                $stmt->execute([$targetConversationId]);
                $message['delivery_count'] = 0;
                $message['read_count'] = 0;
                $message['read_details'] = [];
                $message['recipient_count'] = max(0, (int) $stmt->fetchColumn() - 1);
                notifyWebSocketEvent('message.new', $targetConversationId, $message);
                sendPushForNewMessage($targetConversationId, $message, $currentUserUuid);
                $created[] = $message;
            }
            jsonSuccess(['messages' => $created], 'Сообщения пересланы');
            break;
        }

        // Подтверждение доставки сообщений (клиент получил сообщения)
        if ($action === 'mark_delivered') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            $messageIds = $data['message_ids'] ?? [];
            if (!is_array($messageIds)) {
                $messageIds = $messageIds ? [(int) $messageIds] : [];
            } else {
                $messageIds = array_map('intval', array_values($messageIds));
            }
            $messageIds = array_filter($messageIds);
            $messageIds = array_unique($messageIds);
            if (!$conversationId) {
                jsonError('Не указан ID беседы');
            }
            if (empty($messageIds)) {
                jsonSuccess(null, 'OK');
                break;
            }
            $stmt = $pdo->prepare("
                SELECT cp.conversation_id 
                FROM conversation_participants cp 
                WHERE cp.conversation_id = ? AND cp.user_uuid = ?
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к этой беседе', 403);
            }
            $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
            $stmt = $pdo->prepare("
                INSERT IGNORE INTO message_deliveries (message_id, user_uuid)
                SELECT m.id, ?
                FROM messages m
                WHERE m.conversation_id = ?
                  AND m.id IN ($placeholders)
                  AND m.user_uuid != ?
                  AND m.deleted_at IS NULL
            ");
            $params = array_merge([$currentUserUuid, $conversationId], $messageIds, [$currentUserUuid]);
            $stmt->execute($params);
            // Уведомляем авторов о доставке
            if (!empty($messageIds) && function_exists('notifyUserEvent')) {
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ? AND (hidden_at IS NULL OR hidden_at > NOW())");
                $stmt->execute([$conversationId]);
                $recipientCount = max(0, (int) $stmt->fetchColumn() - 1);
                $stmt = $pdo->prepare("
                    SELECT m.id, m.user_uuid
                    FROM messages m
                    WHERE m.conversation_id = ? AND m.id IN ($placeholders) AND m.user_uuid != ?
                ");
                $stmt->execute(array_merge([$conversationId], $messageIds, [$currentUserUuid]));
                $authors = [];
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $authors[(int) $row['id']] = $row['user_uuid'];
                }
                $stmt = $pdo->prepare("
                    SELECT message_id, COUNT(*) as dc FROM message_deliveries WHERE message_id IN ($placeholders) GROUP BY message_id
                ");
                $stmt->execute($messageIds);
                $deliveryCountByMsg = [];
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $deliveryCountByMsg[(int) $row['message_id']] = (int) $row['dc'];
                }
                $stmt = $pdo->prepare("
                    SELECT mr.message_id, mr.read_at, u.display_name, u.username
                    FROM message_reads mr
                    JOIN users u ON mr.user_uuid = u.uuid
                    WHERE mr.message_id IN ($placeholders)
                    ORDER BY mr.read_at ASC
                ");
                $stmt->execute($messageIds);
                $readDetailsByMsg = [];
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $mid = (int) $row['message_id'];
                    if (!isset($readDetailsByMsg[$mid])) $readDetailsByMsg[$mid] = [];
                    $readDetailsByMsg[$mid][] = [
                        'username' => trim($row['display_name'] ?? '') ?: trim($row['username'] ?? '') ?: '—',
                        'read_at' => $row['read_at'],
                    ];
                }
                foreach ($messageIds as $mid) {
                    $authorUuid = $authors[$mid] ?? null;
                    if (!$authorUuid) continue;
                    $deliveryCount = $deliveryCountByMsg[$mid] ?? 0;
                    $readDetails = $readDetailsByMsg[$mid] ?? [];
                    $readCount = count($readDetails);
                    $payload = [
                        'message_id' => (int) $mid,
                        'delivery_count' => $deliveryCount,
                        'read_count' => $readCount,
                        'read_details' => $readDetails,
                        'recipient_count' => $recipientCount,
                    ];
                    notifyUserEvent('message.status_update', $authorUuid, $conversationId, $payload);
                    notifyWebSocketEvent('message.status_update', $conversationId, $payload);
                }
            }
            jsonSuccess(null, 'OK');
            break;
        }

        // Отметка сообщений как прочитанных до указанного id (включительно)
        if ($action === 'mark_read_up_to') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            $messageId = (int)($data['message_id'] ?? 0);
            if (!$conversationId || !$messageId) {
                jsonError('Укажите conversation_id и message_id');
            }
            $stmt = $pdo->prepare("
                SELECT cp.conversation_id 
                FROM conversation_participants cp 
                WHERE cp.conversation_id = ? AND cp.user_uuid = ?
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к этой беседе', 403);
            }
            $stmt = $pdo->prepare("
                INSERT IGNORE INTO message_reads (message_id, user_uuid)
                SELECT m.id, ?
                FROM messages m
                WHERE m.conversation_id = ?
                  AND m.id <= ?
                  AND m.user_uuid != ?
                  AND m.deleted_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM message_reads mr
                      WHERE mr.message_id = m.id AND mr.user_uuid = ?
                  )
            ");
            $stmt->execute([$currentUserUuid, $conversationId, $messageId, $currentUserUuid, $currentUserUuid]);
            $affected = $stmt->rowCount();
            if ($affected > 0 && function_exists('notifyUserEvent')) {
                $stmt = $pdo->prepare("
                    SELECT m.id, m.user_uuid FROM messages m
                    WHERE m.conversation_id = ? AND m.id <= ? AND m.user_uuid != ? AND m.deleted_at IS NULL
                ");
                $stmt->execute([$conversationId, $messageId, $currentUserUuid]);
                $affectedMessages = $stmt->fetchAll(PDO::FETCH_ASSOC);
                $authorByMessage = [];
                foreach ($affectedMessages as $row) {
                    $authorByMessage[(int)$row['id']] = $row['user_uuid'];
                }
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ? AND (hidden_at IS NULL OR hidden_at > NOW())");
                $stmt->execute([$conversationId]);
                $recipientCount = max(0, (int)$stmt->fetchColumn() - 1);
                foreach ($affectedMessages as $row) {
                    $mid = (int)$row['id'];
                    $stmt = $pdo->prepare("
                        SELECT mr.read_at, u.display_name, u.username
                        FROM message_reads mr JOIN users u ON mr.user_uuid = u.uuid
                        WHERE mr.message_id = ?
                        ORDER BY mr.read_at ASC
                    ");
                    $stmt->execute([$mid]);
                    $readDetails = [];
                    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
                        $readDetails[] = [
                            'username' => trim($r['display_name'] ?? '') ?: trim($r['username'] ?? '') ?: '—',
                            'read_at' => $r['read_at'],
                        ];
                    }
                    $payload = [
                        'message_id' => $mid,
                        'conversation_id' => $conversationId,
                        'read_count' => count($readDetails),
                        'read_details' => $readDetails,
                        'recipient_count' => $recipientCount,
                    ];
                    $authorUuid = $authorByMessage[$mid] ?? null;
                    if ($authorUuid) {
                        notifyUserEvent('message.status_update', $authorUuid, $conversationId, $payload);
                    }
                    notifyWebSocketEvent('message.status_update', $conversationId, $payload);
                }
            }
            $stmt = $pdo->prepare("
                SELECT COUNT(*) FROM messages m
                WHERE m.conversation_id = ? AND m.deleted_at IS NULL
                  AND m.user_uuid != ?
                  AND NOT EXISTS (
                      SELECT 1 FROM message_reads mr
                      WHERE mr.message_id = m.id AND mr.user_uuid = ?
                  )
            ");
            $stmt->execute([$conversationId, $currentUserUuid, $currentUserUuid]);
            $unreadCount = (int) $stmt->fetchColumn();
            // Реакции не трогаем — они помечаются только через mark_reactions_seen_for_message при просмотре своих сообщений
            jsonSuccess(['unread_count' => $unreadCount]);
            break;
        }

        // Отметка сообщений как прочитанных (вся беседа)
        if ($action === 'mark_read') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            if (!$conversationId) {
                jsonError('Не указан ID беседы');
            }
            $stmt = $pdo->prepare("
                SELECT cp.conversation_id 
                FROM conversation_participants cp 
                WHERE cp.conversation_id = ? AND cp.user_uuid = ?
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к этой беседе', 403);
            }
            // Получаем message_ids, которые будут отмечены как прочитанные (для уведомления авторов)
            $stmt = $pdo->prepare("
                SELECT m.id, m.user_uuid
                FROM messages m
                WHERE m.conversation_id = ?
                  AND m.user_uuid != ?
                  AND m.deleted_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM message_reads mr
                      WHERE mr.message_id = m.id AND mr.user_uuid = ?
                  )
            ");
            $stmt->execute([$conversationId, $currentUserUuid, $currentUserUuid]);
            $affectedMessages = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $affectedIds = array_column($affectedMessages, 'id');
            $authorByMessage = [];
            foreach ($affectedMessages as $row) {
                $authorByMessage[(int) $row['id']] = $row['user_uuid'];
            }
            // Вставляем запись о прочтении
            $stmt = $pdo->prepare("
                INSERT IGNORE INTO message_reads (message_id, user_uuid)
                SELECT m.id, ?
                FROM messages m
                WHERE m.conversation_id = ?
                  AND m.user_uuid != ?
                  AND m.deleted_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM message_reads mr
                      WHERE mr.message_id = m.id AND mr.user_uuid = ?
                  )
            ");
            $stmt->execute([$currentUserUuid, $conversationId, $currentUserUuid, $currentUserUuid]);
            // Уведомляем авторов о прочтении
            if (!empty($affectedIds) && function_exists('notifyUserEvent')) {
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ? AND (hidden_at IS NULL OR hidden_at > NOW())");
                $stmt->execute([$conversationId]);
                $recipientCount = max(0, (int) $stmt->fetchColumn() - 1);
                $placeholders = implode(',', array_fill(0, count($affectedIds), '?'));
                $stmt = $pdo->prepare("
                    SELECT mr.message_id, mr.read_at, u.display_name, u.username
                    FROM message_reads mr
                    JOIN users u ON mr.user_uuid = u.uuid
                    WHERE mr.message_id IN ($placeholders)
                    ORDER BY mr.read_at ASC
                ");
                $stmt->execute($affectedIds);
                $readDetailsByMsg = [];
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $mid = (int) $row['message_id'];
                    if (!isset($readDetailsByMsg[$mid])) $readDetailsByMsg[$mid] = [];
                    $readDetailsByMsg[$mid][] = [
                        'username' => trim($row['display_name'] ?? '') ?: trim($row['username'] ?? '') ?: '—',
                        'read_at' => $row['read_at'],
                    ];
                }
                $stmt = $pdo->prepare("
                    SELECT message_id, COUNT(*) as dc FROM message_deliveries WHERE message_id IN ($placeholders) GROUP BY message_id
                ");
                $stmt->execute($affectedIds);
                $deliveryCountByMsg = [];
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $deliveryCountByMsg[(int) $row['message_id']] = (int) $row['dc'];
                }
                foreach ($affectedIds as $mid) {
                    $authorUuid = $authorByMessage[$mid] ?? null;
                    if (!$authorUuid) continue;
                    $readDetails = $readDetailsByMsg[$mid] ?? [];
                    $readCount = count($readDetails);
                    $deliveryCount = $deliveryCountByMsg[$mid] ?? 0;
                    $payload = [
                        'message_id' => (int) $mid,
                        'delivery_count' => $deliveryCount,
                        'read_count' => $readCount,
                        'read_details' => $readDetails,
                        'recipient_count' => $recipientCount,
                    ];
                    notifyUserEvent('message.status_update', $authorUuid, $conversationId, $payload);
                    notifyWebSocketEvent('message.status_update', $conversationId, $payload);
                }
            }
            // Реакции не помечаем здесь — только через mark_reactions_seen_for_message при просмотре своих сообщений
            jsonSuccess(null, 'Прочитано');
            break;
        }

        // Отметка реакций на одном сообщении как просмотренных (по мере прокрутки к сообщению)
        if ($action === 'mark_reactions_seen_for_message') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            $messageId = (int)($data['message_id'] ?? 0);
            if (!$conversationId || !$messageId) {
                jsonError('Укажите conversation_id и message_id');
            }
            $stmt = $pdo->prepare("
                SELECT 1 FROM conversation_participants
                WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к этой беседе', 403);
            }
            // Сообщение должно быть своим (реакции считаются только на свои сообщения)
            $stmt = $pdo->prepare("
                SELECT m.id FROM messages m
                WHERE m.id = ? AND m.conversation_id = ? AND m.user_uuid = ? AND m.deleted_at IS NULL
            ");
            $stmt->execute([$messageId, $conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonSuccess(['unseen_reactions_count' => null]);
                break;
            }
            // Максимальное время реакции других на это сообщение
            $stmt = $pdo->prepare("
                SELECT MAX(mr.created_at) FROM message_reactions mr
                WHERE mr.message_id = ? AND mr.user_uuid != ?
            ");
            $stmt->execute([$messageId, $currentUserUuid]);
            $maxReactionAt = $stmt->fetchColumn();
            if ($maxReactionAt) {
                $stmt = $pdo->prepare("
                    UPDATE conversation_participants
                    SET last_reactions_seen_at = GREATEST(COALESCE(last_reactions_seen_at, '1970-01-01 00:00:00'), ?)
                    WHERE conversation_id = ? AND user_uuid = ?
                ");
                $stmt->execute([$maxReactionAt, $conversationId, $currentUserUuid]);
            }
            // Текущее число неувиденных реакций после обновления
            $stmt = $pdo->prepare("
                SELECT COUNT(*)
                FROM message_reactions mr
                INNER JOIN messages m ON m.id = mr.message_id AND m.conversation_id = ? AND m.user_uuid = ? AND m.deleted_at IS NULL
                INNER JOIN conversation_participants cp ON cp.conversation_id = ? AND cp.user_uuid = ?
                WHERE mr.user_uuid != ?
                  AND (cp.last_reactions_seen_at IS NULL OR mr.created_at > cp.last_reactions_seen_at)
            ");
            $stmt->execute([$conversationId, $currentUserUuid, $conversationId, $currentUserUuid, $currentUserUuid]);
            $unseenCount = (int) $stmt->fetchColumn();
            jsonSuccess(['unseen_reactions_count' => $unseenCount]);
            break;
        }

        // Отметка реакций в беседе как просмотренных (неувиденные в списке чатов)
        if ($action === 'mark_reactions_seen') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            if (!$conversationId) {
                jsonError('Не указан ID беседы');
            }
            $stmt = $pdo->prepare("
                UPDATE conversation_participants SET last_reactions_seen_at = NOW()
                WHERE conversation_id = ? AND user_uuid = ?
            ");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if ($stmt->rowCount() === 0) {
                $stmt = $pdo->prepare("
                    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL
                ");
                $stmt->execute([$conversationId, $currentUserUuid]);
                if (!$stmt->fetch()) {
                    jsonError('Нет доступа к этой беседе', 403);
                }
            }
            jsonSuccess(['unseen_reactions_count' => 0]);
            break;
        }

        // Отправка сообщения
        $conversationId = $data['conversation_id'] ?? 0;
        $content = trim($data['content'] ?? '');
        $type = $data['type'] ?? 'text';
        $filePath = $data['file_path'] ?? null;
        $fileName = $data['file_name'] ?? null;
        $fileSize = $data['file_size'] ?? null;
        $replyToId = isset($data['reply_to_id']) ? (int) $data['reply_to_id'] : 0;
        $encrypted = isset($data['encrypted']) ? (int) (bool) $data['encrypted'] : 0;
        $encryptionAlgorithm = isset($data['encryption_algorithm']) ? trim((string) $data['encryption_algorithm']) : null;
        if ($encryptionAlgorithm === '') {
            $encryptionAlgorithm = null;
        }
        
        if (!$conversationId) {
            jsonError('Не указан ID беседы');
        }
        
        if ($type === 'text' && empty($content)) {
            jsonError('Сообщение не может быть пустым');
        }
        if ($type === 'sticker' && empty($content) && empty($filePath)) {
            jsonError('Стикер не указан');
        }
        
        // Проверка участия в беседе
        $stmt = $pdo->prepare("
            SELECT cp.conversation_id 
            FROM conversation_participants cp 
            WHERE cp.conversation_id = ? AND cp.user_uuid = ?
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Нет доступа к этой беседе', 403);
        }

        // Нельзя отправлять в беседу с удалённым пользователем
        // (когда второй участник удалён, остаётся только текущий)
        $stmt = $pdo->prepare("
            SELECT COUNT(*) FROM conversation_participants 
            WHERE conversation_id = ?
        ");
        $stmt->execute([$conversationId]);
        $participantCount = (int) $stmt->fetchColumn();
        if ($participantCount < 2) {
            jsonError(t('chat.cannot_send_contact_deleted'), 403);
        }
        
        // Валидация reply_to_id: то же conversation_id, сообщение не удалено
        if ($replyToId > 0) {
            $stmt = $pdo->prepare("
                SELECT id FROM messages 
                WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL
            ");
            $stmt->execute([$replyToId, $conversationId]);
            if (!$stmt->fetch()) {
                jsonError('Нельзя ответить на указанное сообщение', 400);
            }
        }
        
        // Вставка сообщения (encrypted: 0 = plaintext, 1 = E2EE ciphertext; encryption_algorithm для мультиалгоритма E2EE)
        try {
            $stmt = $pdo->prepare("
                INSERT INTO messages (conversation_id, user_uuid, content, encrypted, encryption_algorithm, reply_to_id, forwarded_from_message_id, type, file_path, file_name, file_size)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
            ");
            $stmt->execute([$conversationId, $currentUserUuid, $content, $encrypted, $encryptionAlgorithm, $replyToId ?: null, $type, $filePath, $fileName, $fileSize]);
        } catch (PDOException $e) {
            $msg = $e->getMessage();
            if (strpos($msg, 'encryption_algorithm') !== false && (strpos($msg, 'Unknown column') !== false || strpos($msg, '1054') !== false)) {
                $stmt = $pdo->prepare("
                    INSERT INTO messages (conversation_id, user_uuid, content, encrypted, reply_to_id, forwarded_from_message_id, type, file_path, file_name, file_size)
                    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
                ");
                $stmt->execute([$conversationId, $currentUserUuid, $content, $encrypted, $replyToId ?: null, $type, $filePath, $fileName, $fileSize]);
            } else {
                throw $e;
            }
        }
        $messageId = $pdo->lastInsertId();
        
        // Получение созданного сообщения с reply_to
        $stmt = $pdo->prepare("
            SELECT m.*, u.username, u.display_name, u.avatar
            FROM messages m
            LEFT JOIN users u ON m.user_uuid = u.uuid
            WHERE m.id = ?
        ");
        $stmt->execute([$messageId]);
        $message = $stmt->fetch(PDO::FETCH_ASSOC);
        $dn = trim($message['display_name'] ?? '');
        $un = trim($message['username'] ?? '');
        $message['username'] = $dn ?: ($un ?: 'неизвестный автор');
        $message['reactions'] = [];
        if (!empty($message['reply_to_id'])) {
            $stmt = $pdo->prepare("
                SELECT r.id, r.content, r.type, r.file_name, r.deleted_at, r.encrypted, u.username, u.display_name
                FROM messages r
                LEFT JOIN users u ON r.user_uuid = u.uuid
                WHERE r.id = ?
            ");
            $stmt->execute([$message['reply_to_id']]);
            $replyRow = $stmt->fetch(PDO::FETCH_ASSOC);
            $message['reply_to'] = $replyRow ? buildReplyToObject($replyRow) : [
                'id' => (int) $message['reply_to_id'],
                'content_preview' => '[Сообщение удалено]',
                'username' => '',
                'type' => 'text',
            ];
        } else {
            $message['reply_to'] = null;
        }
        $message['forwarded_from'] = null;
        $message['delivery_count'] = 0;
        $message['read_count'] = 0;
        $message['read_details'] = [];
        $message['recipient_count'] = $participantCount - 1;
        
        notifyWebSocketEvent('message.new', $conversationId, $message);
        sendPushForNewMessage($conversationId, $message, $currentUserUuid);
        jsonSuccess(['message' => $message], 'Сообщение отправлено');
        break;
        
    case 'PUT':
        // Редактирование сообщения
        $messageId = $_GET['id'] ?? 0;
        $data = json_decode(file_get_contents('php://input'), true);
        $content = trim($data['content'] ?? '');
        
        if (!$messageId || empty($content)) {
            jsonError('Неверные данные');
        }
        
        // Проверка владельца
        $stmt = $pdo->prepare("SELECT user_uuid FROM messages WHERE id = ?");
        $stmt->execute([$messageId]);
        $message = $stmt->fetch();
        
        if (!$message || $message['user_uuid'] !== $currentUserUuid) {
            jsonError('Нет прав на редактирование', 403);
        }
        
        $stmt = $pdo->prepare("UPDATE messages SET content = ?, edited_at = NOW() WHERE id = ?");
        $stmt->execute([$content, $messageId]);
        
        jsonSuccess(null, 'Сообщение отредактировано');
        break;
        
    case 'DELETE':
        // Удаление сообщения
        $messageId = (int)($_GET['id'] ?? 0);
        
        if (!$messageId) {
            jsonError('Не указан ID сообщения');
        }
        
        // Проверка владельца и получение conversation_id
        $stmt = $pdo->prepare("SELECT user_uuid, conversation_id FROM messages WHERE id = ?");
        $stmt->execute([$messageId]);
        $message = $stmt->fetch();
        
        if (!$message || $message['user_uuid'] !== $currentUserUuid) {
            jsonError('Нет прав на удаление', 403);
        }
        
        $conversationId = (int) $message['conversation_id'];
        
        // Проверяем, читал ли кто-то сообщение (кроме автора — автор не создаёт запись в message_reads для своих сообщений)
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM message_reads WHERE message_id = ?");
        $stmt->execute([$messageId]);
        $readCount = (int) $stmt->fetchColumn();
        
        if ($readCount === 0) {
            // Никто не читал — удаляем бесследно (hard delete)
            $stmt = $pdo->prepare("DELETE FROM messages WHERE id = ?");
            $stmt->execute([$messageId]);
            $permanent = true;
        } else {
            // Кто-то прочитал — мягкое удаление (показываем «Сообщение удалено»)
            $stmt = $pdo->prepare("UPDATE messages SET deleted_at = NOW() WHERE id = ?");
            $stmt->execute([$messageId]);
            $permanent = false;
        }
        
        notifyWebSocketEvent('message.deleted', $conversationId, ['message_id' => $messageId, 'permanent' => $permanent]);
        
        jsonSuccess(['permanent' => $permanent], 'Сообщение удалено');
        break;
        
    default:
        jsonError('Метод не поддерживается', 405);
}
} catch (PDOException $e) {
    error_log('api/messages.php PDO: ' . $e->getMessage());
    jsonError('Ошибка базы данных. Если при отправке/пересылке: выполните миграции sql/migrations/ (001–004) и tools/run_message_deliveries_migration.php.', 500);
} catch (Throwable $e) {
    error_log('api/messages.php: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    jsonError('Внутренняя ошибка сервера', 500);
}
