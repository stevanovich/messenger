<?php
// Реакции: на одном сообщении пользователь может оставить все типы эмодзи (👍 ❤️ 😂 😮 😢 🙏 и др.).
// Требуется UNIQUE(message_id, user_uuid, emoji) — без UNIQUE(message_id, user_uuid).
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');
$method = $_SERVER['REQUEST_METHOD'];

/** Список поддерживаемых эмодзи для реакций (один источник правды для API и валидации). */
$REACTION_SUPPORTED_EMOJI_STRING = '👍❤️😂😮😢🙏😀😃😄😁😅🤣😊😇🙂😉😍🥰😘😋😛😜🤪😝🤔😐😑😏😒🙄😬😌😔😪🤤😴😷🤒🤕🤢🤮😵🤠😎😕😟😯😲😳🥺😦😧😨😥😭😱😖😞😤😡🤬💀💩👎👊✊🤛🤜👏🙌👐🤲🤝✌️🤞🤟🤘🤙🤌🤏❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟✅❌⭕❗❕❓❔‼️⁉️';

function reaction_get_supported_emojis_list() {
    global $REACTION_SUPPORTED_EMOJI_STRING;
    if (preg_match_all('/\X/u', $REACTION_SUPPORTED_EMOJI_STRING, $m)) {
        return array_values(array_unique($m[0]));
    }
    return ['👍', '❤️', '😂', '😮', '😢', '🙏'];
}

/** Нормализация эмодзи для сравнения (NFC + убираем только variation selector U+FE0F, чтобы ❤ и ❤️ совпадали). */
function reaction_normalize_emoji($emoji) {
    $s = trim($emoji);
    if (class_exists('Normalizer') && method_exists('Normalizer', 'normalize')) {
        $s = Normalizer::normalize($s, Normalizer::FORM_C);
    }
    $s = preg_replace('/\x{FE0F}/u', '', $s);
    return $s === '' ? $emoji : $s;
}

$REACTION_SUPPORTED_EMOJIS = reaction_get_supported_emojis_list();

// Публичный endpoint: список эмодзи для реакций (без авторизации), чтобы пикер работал до готовности сессии
if ($method === 'GET' && !empty($_GET['list_emojis'])) {
    global $pdo;
    $stmt = $pdo->query("
        SELECT emoji, COUNT(*) AS cnt
        FROM message_reactions
        GROUP BY emoji
    ");
    $counts = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $counts[$row['emoji']] = (int) $row['cnt'];
    }
    $result = [];
    foreach ($REACTION_SUPPORTED_EMOJIS as $e) {
        $result[] = ['emoji' => $e, 'count' => isset($counts[$e]) ? $counts[$e] : 0];
    }
    usort($result, function ($a, $b) {
        if ($a['count'] !== $b['count']) {
            return $b['count'] - $a['count'];
        }
        return strcmp($a['emoji'], $b['emoji']);
    });
    jsonSuccess(['emojis' => $result]);
    exit;
}

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}
$currentUserUuid = getCurrentUserUuid();
global $pdo;

switch ($method) {
    case 'POST':
        // Добавить реакцию на сообщение (тело JSON; запасной вариант — form data)
        $rawInput = file_get_contents('php://input');
        $data = is_string($rawInput) ? json_decode($rawInput, true) : null;
        if (!is_array($data) && !empty($_POST)) {
            $data = ['message_id' => $_POST['message_id'] ?? null, 'emoji' => $_POST['emoji'] ?? null];
        }
        if (!is_array($data)) {
            jsonError('Неверный формат запроса (ожидается JSON с message_id и emoji)');
        }
        $messageId = (int)($data['message_id'] ?? 0);
        $emoji = isset($data['emoji']) ? trim((string)$data['emoji']) : '';

        if (!$messageId || $emoji === '') {
            jsonError('Не указаны message_id или emoji');
        }
        
        // Ограничение длины эмодзи (поддержка составных эмодзи). Список поддерживаемых используется только для list_emojis (сортировка по использованию).
        if (mb_strlen($emoji) > 10) {
            jsonError('Недопустимый emoji');
        }
        
        // Проверка доступа к сообщению (участие в беседе)
        $stmt = $pdo->prepare("
            SELECT m.id FROM messages m
            JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
            WHERE m.id = ? AND m.deleted_at IS NULL AND cp.user_uuid = ?
        ");
        $stmt->execute([$messageId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Нет доступа к сообщению', 403);
        }
        
        try {
            $stmt = $pdo->prepare("
                INSERT INTO message_reactions (message_id, user_uuid, emoji)
                VALUES (?, ?, ?)
            ");
            $stmt->execute([$messageId, $currentUserUuid, $emoji]);
            $reactionId = (int)$pdo->lastInsertId();
        } catch (PDOException $e) {
            if ($e->getCode() == 23000) {
                // Дубликат: при UNIQUE(message_id, user_uuid, emoji) — только повтор того же emoji (toggle)
                // Проверяем, есть ли уже такая реакция у пользователя
                // Получаем все реакции и сравниваем в PHP для точного сравнения эмодзи
                $stmt = $pdo->prepare("
                    SELECT id, emoji, HEX(emoji) as emoji_hex FROM message_reactions
                    WHERE message_id = ? AND user_uuid = ?
                ");
                $stmt->execute([$messageId, $currentUserUuid]);
                $allUserReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                $existing = null;
                $emojiHex = strtoupper(bin2hex($emoji));
                foreach ($allUserReactions as $r) {
                    // Сравниваем по HEX для точного сравнения
                    if (strtoupper($r['emoji_hex']) === $emojiHex || $r['emoji'] === $emoji) {
                        $existing = $r;
                        break;
                    }
                }
                
                if ($existing) {
                    // Toggle: удаляем существующую реакцию с этим emoji (используем ID для точности)
                    $stmt = $pdo->prepare("
                        DELETE FROM message_reactions
                        WHERE id = ?
                    ");
                    $stmt->execute([$existing['id']]);
                    $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                    $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                    $stmt->execute([$messageId]);
                    $row = $stmt->fetch();
                    if ($row) {
                        notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                    }
                    jsonSuccess(['action' => 'removed', 'reactions' => $reactions], 'Реакция снята');
                } else {
                    // Реакция не найдена, но ошибка дубликата - возможно проблема с кодировкой или старый UNIQUE индекс
                    // Проверяем, есть ли другие реакции у пользователя на это сообщение
                    $stmt = $pdo->prepare("
                        SELECT emoji FROM message_reactions
                        WHERE message_id = ? AND user_uuid = ?
                    ");
                    $stmt->execute([$messageId, $currentUserUuid]);
                    $otherReactions = $stmt->fetchAll(PDO::FETCH_COLUMN);
                    $hasOtherReactions = !empty($otherReactions);
                    
                    if ($hasOtherReactions) {
                        // У пользователя уже есть другие реакции - значит схема правильная (UNIQUE(message_id, user_uuid, emoji))
                        // Но ошибка дубликата означает, что MySQL считает этот emoji дубликатом
                        // Возможно, проблема с кодировкой эмодзи или нормализацией (например, ❤️ vs ❤)
                        // Проверяем, есть ли точно такой же эмодзи в других реакциях
                        $foundExact = false;
                        $foundSimilar = false;
                        foreach ($otherReactions as $otherEmoji) {
                            if ($otherEmoji === $emoji) {
                                $foundExact = true;
                                break;
                            }
                            // Проверяем нормализованные версии (убираем variation selectors и zero-width joiners)
                            $normalizedOther = preg_replace('/[\x{FE00}-\x{FE0F}\x{200D}]/u', '', $otherEmoji);
                            $normalizedNew = preg_replace('/[\x{FE00}-\x{FE0F}\x{200D}]/u', '', $emoji);
                            if ($normalizedOther === $normalizedNew && $normalizedOther !== '') {
                                $foundSimilar = true;
                                break;
                            }
                        }
                        
                        if ($foundExact || $foundSimilar) {
                            // Найден точно такой же или похожий эмодзи - это toggle, удаляем его
                            // Используем точное сравнение для удаления
                            $stmt = $pdo->prepare("
                                DELETE FROM message_reactions
                                WHERE message_id = ? AND user_uuid = ? AND emoji = ?
                            ");
                            $stmt->execute([$messageId, $currentUserUuid, $emoji]);
                            $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                            $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                            $stmt->execute([$messageId]);
                            $row = $stmt->fetch();
                            if ($row) {
                                notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                            }
                            jsonSuccess(['action' => 'removed', 'reactions' => $reactions], 'Реакция снята');
                        } else {
                            // Другие реакции есть, но эта эмодзи отличается - это странно
                            // Возможно, проблема с collation в MySQL или кодировкой
                            // Логируем детали для отладки
                            error_log("Reaction error: duplicate key violation but emoji differs. " .
                                "Trying to add: " . bin2hex($emoji) . " (" . $emoji . ") " .
                                "Existing: " . json_encode(array_map(function($e) { return bin2hex($e) . " (" . $e . ")"; }, $otherReactions)) . " " .
                                "Error: " . $e->getMessage());
                            
                            // Пытаемся добавить реакцию еще раз - возможно, была временная проблема или race condition
                            // Но сначала проверяем, может быть в БД уже есть эта реакция с другой кодировкой
                            $stmt = $pdo->prepare("
                                SELECT id, emoji, HEX(emoji) as emoji_hex FROM message_reactions
                                WHERE message_id = ? AND user_uuid = ?
                            ");
                            $stmt->execute([$messageId, $currentUserUuid]);
                            $allReactions = $stmt->fetchAll(PDO::FETCH_ASSOC);
                            
                            // Проверяем по HEX, может быть проблема с кодировкой
                            $emojiHex = bin2hex($emoji);
                            $foundByHex = false;
                            foreach ($allReactions as $r) {
                                if ($r['emoji_hex'] === $emojiHex || $r['emoji'] === $emoji) {
                                    $foundByHex = true;
                                    // Удаляем найденную реакцию (toggle)
                                    $stmt = $pdo->prepare("DELETE FROM message_reactions WHERE id = ?");
                                    $stmt->execute([$r['id']]);
                                    $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                                    $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                                    $stmt->execute([$messageId]);
                                    $row = $stmt->fetch();
                                    if ($row) {
                                        notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                                    }
                                    jsonSuccess(['action' => 'removed', 'reactions' => $reactions], 'Реакция снята');
                                    return;
                                }
                            }
                            
                            if (!$foundByHex) {
                                // Реакции нет по HEX, но ошибка дубликата - это означает, что MySQL считает эмодзи дубликатом
                                // из-за collation utf8mb4_unicode_ci, но в PHP они различаются
                                // В этом случае нужно просто получить текущие реакции и вернуть их
                                // так как MySQL уже добавил реакцию (или считает её дубликатом существующей)
                                
                                // Получаем все реакции после попытки добавления
                                $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                                
                                // Проверяем, есть ли наша реакция в списке (может быть с другой кодировкой)
                                $reactionFound = false;
                                foreach ($reactions as $r) {
                                    // Сравниваем нормализованные версии
                                    $normalizedR = preg_replace('/[\x{FE00}-\x{FE0F}\x{200D}]/u', '', $r['emoji']);
                                    $normalizedNew = preg_replace('/[\x{FE00}-\x{FE0F}\x{200D}]/u', '', $emoji);
                                    if ($normalizedR === $normalizedNew || $r['emoji'] === $emoji) {
                                        $reactionFound = true;
                                        break;
                                    }
                                }
                                
                                if ($reactionFound) {
                                    // Реакция найдена - возвращаем успех
                                    $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                                    $stmt->execute([$messageId]);
                                    $row = $stmt->fetch();
                                    if ($row) {
                                        notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                                    }
                                    jsonSuccess(['action' => 'added', 'reactions' => $reactions], 'Реакция добавлена');
                                } else {
                                    // Реакция не найдена - возможно, MySQL не добавил её из-за collation
                                    // Пытаемся использовать INSERT IGNORE
                                    try {
                                        $stmt = $pdo->prepare("
                                            INSERT IGNORE INTO message_reactions (message_id, user_uuid, emoji)
                                            VALUES (?, ?, ?)
                                        ");
                                        $stmt->execute([$messageId, $currentUserUuid, $emoji]);
                                        
                                        // Получаем обновленные реакции
                                        $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                                        $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                                        $stmt->execute([$messageId]);
                                        $row = $stmt->fetch();
                                        if ($row) {
                                            notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                                        }
                                        jsonSuccess(['action' => 'added', 'reactions' => $reactions], 'Реакция добавлена');
                                    } catch (PDOException $e2) {
                                        // Если INSERT IGNORE тоже не помог, возвращаем ошибку
                                        error_log("Reaction error (INSERT IGNORE failed): " . $e2->getMessage());
                                        jsonError('Не удалось добавить реакцию. Возможно, проблема с кодировкой эмодзи. Попробуйте еще раз.', 500);
                                    }
                                }
                            }
                        }
                    } else {
                        // Legacy: в БД есть UNIQUE(message_id, user_uuid) без emoji — одна реакция на пользователя.
                        // Замена: удаляем все свои реакции на сообщение и вставляем новую.
                        $stmt = $pdo->prepare("
                            DELETE FROM message_reactions
                            WHERE message_id = ? AND user_uuid = ?
                        ");
                        $stmt->execute([$messageId, $currentUserUuid]);
                        $stmt = $pdo->prepare("
                            INSERT INTO message_reactions (message_id, user_uuid, emoji)
                            VALUES (?, ?, ?)
                        ");
                        $stmt->execute([$messageId, $currentUserUuid, $emoji]);
                        $reactionId = (int)$pdo->lastInsertId();
                        $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                        $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                        $stmt->execute([$messageId]);
                        $row = $stmt->fetch();
                        if ($row) {
                            notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                        }
                        header('X-Reactions-Replaced: 1'); // ветка «замена» — для проверки, что выполняется актуальный код
                        jsonSuccess(['action' => 'added', 'id' => $reactionId, 'reactions' => $reactions], 'Реакция добавлена');
                    }
                }
                return;
            }
            throw $e;
        }
        
        $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
        $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
        $stmt->execute([$messageId]);
        $row = $stmt->fetch();
        if ($row) {
            notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
        }
        jsonSuccess(['action' => 'added', 'id' => $reactionId, 'reactions' => $reactions], 'Реакция добавлена');
        break;
        
    case 'GET':
        // Обход для Synology: POST возвращает 400, поэтому поддерживаем toggle через GET (action=toggle&message_id=&emoji=)
        if (!empty($_GET['action']) && $_GET['action'] === 'toggle' && isset($_GET['message_id']) && isset($_GET['emoji'])) {
            $messageId = (int)($_GET['message_id'] ?? 0);
            $emoji = trim((string)($_GET['emoji'] ?? ''));
            if (!$messageId || $emoji === '' || mb_strlen($emoji) > 10) {
                jsonError('Не указаны message_id или emoji');
            }
            $stmt = $pdo->prepare("
                SELECT m.id FROM messages m
                JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
                WHERE m.id = ? AND m.deleted_at IS NULL AND cp.user_uuid = ?
            ");
            $stmt->execute([$messageId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к сообщению', 403);
            }
            try {
                $stmt = $pdo->prepare("
                    INSERT INTO message_reactions (message_id, user_uuid, emoji)
                    VALUES (?, ?, ?)
                ");
                $stmt->execute([$messageId, $currentUserUuid, $emoji]);
                $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                $stmt->execute([$messageId]);
                $row = $stmt->fetch();
                if ($row) {
                    notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                }
                jsonSuccess(['action' => 'added', 'reactions' => $reactions], 'Реакция добавлена');
            } catch (PDOException $e) {
                if ($e->getCode() == 23000) {
                    $stmt = $pdo->prepare("
                        DELETE FROM message_reactions
                        WHERE message_id = ? AND user_uuid = ? AND emoji = ?
                    ");
                    $stmt->execute([$messageId, $currentUserUuid, $emoji]);
                    $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
                    $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
                    $stmt->execute([$messageId]);
                    $row = $stmt->fetch();
                    if ($row) {
                        notifyWebSocketEvent('reaction.update', (int) $row['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
                    }
                    jsonSuccess(['action' => 'removed', 'reactions' => $reactions], 'Реакция снята');
                } else {
                    throw $e;
                }
            }
            break;
        }
        // Получение реакций по списку сообщений (для передачи участникам через polling)
        $conversationId = (int)($_GET['conversation_id'] ?? 0);
        $messageIdsRaw = $_GET['message_ids'] ?? '';
        if (!$conversationId || $messageIdsRaw === '') {
            jsonError('Не указаны conversation_id или message_ids');
        }
        $messageIds = array_filter(array_map('intval', explode(',', $messageIdsRaw)));
        $messageIds = array_slice(array_unique($messageIds), 0, 100);
        if (empty($messageIds)) {
            jsonSuccess(['reactions' => []]);
            break;
        }
        // Проверка участия в беседе
        $stmt = $pdo->prepare("
            SELECT conversation_id FROM conversation_participants
            WHERE conversation_id = ? AND user_uuid = ?
        ");
        $stmt->execute([$conversationId, $currentUserUuid]);
        if (!$stmt->fetch()) {
            jsonError('Нет доступа к беседе', 403);
        }
        $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
        $stmt = $pdo->prepare("
            SELECT mr.message_id, mr.emoji, mr.user_uuid, u.avatar, u.display_name, u.username
            FROM message_reactions mr
            JOIN messages m ON m.id = mr.message_id
            LEFT JOIN users u ON u.uuid = mr.user_uuid
            WHERE mr.message_id IN ($placeholders) AND m.conversation_id = ? AND m.deleted_at IS NULL
        ");
        $stmt->execute(array_merge($messageIds, [$conversationId]));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $byMessage = [];
        foreach ($rows as $r) {
            $mid = (int)$r['message_id'];
            if (!isset($byMessage[$mid])) {
                $byMessage[$mid] = [];
            }
            $byMessage[$mid][] = $r;
        }
        $grouped = [];
        foreach ($byMessage as $messageId => $list) {
            $grouped[$messageId] = groupReactionsByEmoji($list, $currentUserUuid);
        }
        jsonSuccess(['reactions' => $grouped]);
        break;

    case 'DELETE':
        // Удалить реакцию
        $reactionId = (int)($_GET['id'] ?? 0);
        if (!$reactionId) {
            jsonError('Не указан ID реакции');
        }
        
        $stmt = $pdo->prepare("SELECT message_id FROM message_reactions WHERE id = ? AND user_uuid = ?");
        $stmt->execute([$reactionId, $currentUserUuid]);
        $row = $stmt->fetch();
        if (!$row) {
            jsonError('Реакция не найдена или нет прав', 403);
        }
        
        $stmt = $pdo->prepare("DELETE FROM message_reactions WHERE id = ?");
        $stmt->execute([$reactionId]);
        $messageId = (int) $row['message_id'];
        $reactions = getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid);
        $stmt = $pdo->prepare("SELECT conversation_id FROM messages WHERE id = ?");
        $stmt->execute([$messageId]);
        $convRow = $stmt->fetch();
        if ($convRow) {
            notifyWebSocketEvent('reaction.update', (int) $convRow['conversation_id'], ['message_id' => $messageId, 'reactions' => $reactions]);
        }
        jsonSuccess(['reactions' => $reactions], 'Реакция удалена');
        break;
        
    default:
        jsonError('Метод не поддерживается', 405);
}

/** Реакции сообщения, сгруппированные по emoji: анонимно, с количеством и флагом «своя»; при count=1 — single_avatar/single_username. */
function getMessageReactionsGrouped($pdo, $messageId, $currentUserUuid) {
    $stmt = $pdo->prepare("
        SELECT mr.emoji, mr.user_uuid, u.avatar, u.display_name, u.username
        FROM message_reactions mr
        LEFT JOIN users u ON u.uuid = mr.user_uuid
        WHERE mr.message_id = ?
    ");
    $stmt->execute([$messageId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    return groupReactionsByEmoji($rows, $currentUserUuid);
}
