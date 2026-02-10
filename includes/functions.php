<?php
/**
 * Вспомогательные функции
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

/**
 * Проверка авторизации пользователя
 */
function isLoggedIn() {
    return isset($_SESSION['user_uuid']) && !empty($_SESSION['user_uuid']);
}

/**
 * Проверка, является ли текущий пользователь админом (по UUID)
 */
function isAdmin() {
    if (!isLoggedIn()) {
        return false;
    }
    $userUuid = $_SESSION['user_uuid'] ?? '';
    if (empty($userUuid)) {
        return false;
    }
    $adminUuids = array_map('trim', explode(',', defined('ADMIN_UUIDS') ? ADMIN_UUIDS : ''));
    $adminUuids = array_filter($adminUuids);
    return in_array($userUuid, $adminUuids);
}

/**
 * Путь к файлу настройки отображения индикатора режима обновления (для всех пользователей)
 */
function getConnectionStatusDisplayConfigPath() {
    $root = rtrim(defined('ROOT_PATH') ? ROOT_PATH : __DIR__ . '/../', '/\\');
    return $root . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'connection_status_display.json';
}

/**
 * Показывать ли индикатор режима обновления (реальное время / по запросу) в шапке чата для всех пользователей.
 * Значение хранится в config/connection_status_display.json. По умолчанию — показывать (true).
 */
function getShowConnectionStatusIndicator() {
    $path = getConnectionStatusDisplayConfigPath();
    if (!is_file($path) || !is_readable($path)) {
        return true;
    }
    $json = @file_get_contents($path);
    if ($json === false) {
        return true;
    }
    $data = @json_decode($json, true);
    if (!is_array($data) || !array_key_exists('show', $data)) {
        return true;
    }
    return (bool) $data['show'];
}

/**
 * Сохранить настройку отображения индикатора (только для админки). Записывает config/connection_status_display.json.
 * @param bool $show
 * @return bool успех записи
 */
function saveShowConnectionStatusIndicator($show) {
    $path = getConnectionStatusDisplayConfigPath();
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) {
        return false;
    }
    $content = json_encode(['show' => (bool) $show], JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $content) !== false;
}

/**
 * Получить текущего пользователя
 */
function getCurrentUser() {
    if (!isLoggedIn()) {
        return null;
    }
    
    try {
        global $pdo;
        $stmt = $pdo->prepare("SELECT uuid, username, display_name, status, avatar, last_seen FROM users WHERE uuid = ?");
        $stmt->execute([$_SESSION['user_uuid']]);
        return $stmt->fetch();
    } catch (PDOException $e) {
        error_log("Error getting current user: " . $e->getMessage());
        return null;
    }
}

/**
 * Получить UUID текущего пользователя (для запросов к БД)
 */
function getCurrentUserUuid() {
    return $_SESSION['user_uuid'] ?? null;
}

/**
 * Обновить last_seen текущего пользователя при активности (с ограничением раз в 60 сек)
 */
function updateLastSeenIfNeeded() {
    if (!isLoggedIn()) {
        return;
    }
    $throttleKey = 'last_seen_updated_at';
    $now = time();
    if (isset($_SESSION[$throttleKey]) && ($now - (int)$_SESSION[$throttleKey]) < 60) {
        return;
    }
    try {
        global $pdo;
        $stmt = $pdo->prepare("UPDATE users SET last_seen = NOW() WHERE uuid = ?");
        $stmt->execute([getCurrentUserUuid()]);
        $_SESSION[$throttleKey] = $now;
    } catch (PDOException $e) {
        error_log("updateLastSeenIfNeeded: " . $e->getMessage());
    }
}

/**
 * Хеширование пароля
 */
function hashPassword($password) {
    return password_hash($password, PASSWORD_DEFAULT);
}

/**
 * Проверка пароля
 */
function verifyPassword($password, $hash) {
    return password_verify($password, $hash);
}

/**
 * Генерация UUID v4
 */
function generateUuid() {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

/**
 * Генерация токена сессии
 */
function generateToken() {
    return bin2hex(random_bytes(32));
}

/**
 * Превью контента сообщения для блока «Ответ на» (reply_to)
 * @param array $row строка сообщения: content, type, file_name, deleted_at
 * @return string
 */
function messageReplyContentPreview(array $row) {
    if (!empty($row['deleted_at'])) {
        return '[Сообщение удалено]';
    }
    $type = $row['type'] ?? 'text';
    switch ($type) {
        case 'image':
            return '[Изображение]';
        case 'file':
            $name = $row['file_name'] ?? '';
            return $name !== '' ? '[Файл: ' . $name . ']' : '[Файл]';
        case 'sticker':
            return '[Стикер]';
        default:
            $content = $row['content'] ?? '';
            if ($content === '') {
                return '[Сообщение]';
            }
            $len = 100;
            return mb_strlen($content) > $len ? mb_substr($content, 0, $len) . '…' : $content;
    }
}

/**
 * Построить объект reply_to для API из строки сообщения (с полями id, username от JOIN)
 * @param array $row id, content, type, file_name, deleted_at, username
 * @return array { id, content_preview, username, type }
 */
function buildReplyToObject(array $row) {
    $username = trim($row['display_name'] ?? '') ?: trim($row['username'] ?? '') ?: 'неизвестный автор';
    return [
        'id' => (int) $row['id'],
        'content_preview' => messageReplyContentPreview($row),
        'username' => $username,
        'type' => $row['type'] ?? 'text',
    ];
}

/**
 * Построить объект forwarded_from для API из строки исходного сообщения (полный контент для отображения)
 * @param array $row id, content, type, file_path, file_name, deleted_at, username, display_name
 * @return array { message_id, username, type, content, file_path, file_name }
 */
function buildForwardedFromObject(array $row) {
    $username = trim($row['display_name'] ?? '') ?: trim($row['username'] ?? '') ?: 'неизвестный автор';
    return [
        'message_id' => (int) $row['id'],
        'username' => $username,
        'type' => $row['type'] ?? 'text',
        'content' => $row['content'] ?? null,
        'file_path' => $row['file_path'] ?? null,
        'file_name' => $row['file_name'] ?? null,
    ];
}

/**
 * CSRF-токен для OAuth и форм
 */
function generateCSRFToken() {
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verifyCSRFToken($token) {
    return isset($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

/**
 * Уведомить WebSocket-сервер о событии (рассылка участникам беседы).
 * Вызов не блокирует: при недоступности WS ошибка только логируется.
 *
 * @param string $event Тип события: message.new, reaction.update, conversation.updated
 * @param int $conversationId ID беседы
 * @param array $data Данные события (будут в data в payload для клиентов)
 */
function notifyWebSocketEvent($event, $conversationId, array $data = []) {
    if (!defined('WEBSOCKET_EVENT_PORT')) {
        return;
    }
    $url = 'http://127.0.0.1:' . WEBSOCKET_EVENT_PORT . '/event';
    $body = json_encode([
        'event' => $event,
        'conversation_id' => (int) $conversationId,
        'data' => $data,
    ]);
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nContent-Length: " . strlen($body),
            'content' => $body,
            'timeout' => 1.0,
            'ignore_errors' => true,
        ],
    ]);
    @file_get_contents($url, false, $ctx);
}

/**
 * Уведомить конкретного пользователя о событии (message.status_update и т.п.).
 * Отправляет payload только соединениям этого user_uuid.
 *
 * @param string $event Тип события
 * @param string $targetUserUuid UUID получателя
 * @param int $conversationId ID беседы
 * @param array $data Данные события
 */
function notifyUserEvent($event, $targetUserUuid, $conversationId, array $data = []) {
    if (!defined('WEBSOCKET_EVENT_PORT') || !$targetUserUuid || strlen($targetUserUuid) !== 36) {
        return;
    }
    $url = 'http://127.0.0.1:' . WEBSOCKET_EVENT_PORT . '/event';
    $body = json_encode([
        'event' => $event,
        'target_user_uuid' => $targetUserUuid,
        'conversation_id' => (int) $conversationId,
        'data' => $data,
    ]);
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nContent-Length: " . strlen($body),
            'content' => $body,
            'timeout' => 1.0,
            'ignore_errors' => true,
        ],
    ]);
    @file_get_contents($url, false, $ctx);
}

/**
 * Запись в отладочный журнал push (если PUSH_DEBUG).
 *
 * @param string $message
 * @param array $context дополнительные данные (будут json_encode, обрезано по размеру)
 */
function pushDebugLog($message, array $context = []) {
    if (!defined('PUSH_DEBUG') || !PUSH_DEBUG) {
        return;
    }
    $root = defined('ROOT_PATH') ? rtrim(ROOT_PATH, '/\\') : dirname(__DIR__);
    $file = $root . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'push_debug.log';
    $ts = date('Y-m-d H:i:s');
    $line = '[' . $ts . '] ' . $message;
    if (!empty($context)) {
        $line .= ' ' . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if (strlen($line) > 2000) {
            $line = substr($line, 0, 1997) . '...';
        }
    }
    $line .= "\n";
    @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
}

/**
 * Отправить push-уведомления получателям при новом сообщении.
 * Вызов не блокирует: при ошибках только логируем; 410/404 — удаляем подписку из БД.
 *
 * @param int $conversationId ID беседы
 * @param array $message Данные сообщения (id, content, type, username, …)
 * @param string $senderUserUuid UUID отправителя (ему не шлём push)
 */
function sendPushForNewMessage($conversationId, array $message, $senderUserUuid) {
    $runId = substr(md5(uniqid((string) mt_rand(), true)), 0, 8);
    pushDebugLog("[{$runId}] START", ['conv' => $conversationId, 'msg_id' => $message['id'] ?? null, 'sender' => substr($senderUserUuid, 0, 8) . '...']);

    if (!defined('PUSH_VAPID_PUBLIC_KEY') || PUSH_VAPID_PUBLIC_KEY === '' ||
        !defined('PUSH_VAPID_PRIVATE_KEY') || PUSH_VAPID_PRIVATE_KEY === '') {
        pushDebugLog("[{$runId}] SKIP: VAPID keys not set", []);
        error_log('sendPushForNewMessage: VAPID keys not set, skip');
        return;
    }
    if (!class_exists('Minishlink\WebPush\WebPush')) {
        $autoload = defined('ROOT_PATH') ? (rtrim(ROOT_PATH, '/\\') . '/vendor/autoload.php') : __DIR__ . '/../vendor/autoload.php';
        if (!is_file($autoload)) {
            pushDebugLog("[{$runId}] SKIP: vendor/autoload.php not found", []);
            error_log('sendPushForNewMessage: vendor/autoload.php not found');
            return;
        }
        require_once $autoload;
    }
    if (!class_exists('Minishlink\WebPush\WebPush')) {
        $root = defined('ROOT_PATH') ? rtrim(ROOT_PATH, '/\\') : dirname(__DIR__);
        $autoloadPath = $root . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
        $minishlinkDir = $root . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'minishlink' . DIRECTORY_SEPARATOR . 'web-push';
        $vendorDir = $root . DIRECTORY_SEPARATOR . 'vendor';
        $minishlinkVisible = is_dir($minishlinkDir);
        $vendorList = (is_dir($vendorDir) && is_readable($vendorDir)) ? @scandir($vendorDir) : false;
        $minishlinkInVendor = $vendorList && in_array('minishlink', $vendorList, true);
        if ($minishlinkVisible) {
            $hint = 'Путь к vendor у веб-сервера другой. ROOT_PATH=' . $root;
        } elseif ($minishlinkInVendor) {
            $hint = 'vendor/minishlink есть, но веб-сервер не может в него зайти. Выполните на сервере: chmod -R a+rX vendor/minishlink';
        } else {
            $hint = 'Run "composer install" in project root (where PHP runs for the site).';
        }
        pushDebugLog("[{$runId}] SKIP: WebPush class not found", [
            'autoload_loaded' => is_file($autoloadPath),
            'vendor_minishlink_exists' => $minishlinkVisible,
            'minishlink_in_vendor_list' => $minishlinkInVendor,
            'ROOT_PATH' => $root,
            'ROOT_PATH_realpath' => @realpath($root) ?: null,
            'hint' => $hint
        ]);
        error_log('sendPushForNewMessage: WebPush class not found. ' . $hint);
        return;
    }

    global $pdo;
    $conversationId = (int) $conversationId;
    $senderUserUuid = (string) $senderUserUuid;

    $stmt = $pdo->prepare("
        SELECT user_uuid FROM conversation_participants
        WHERE conversation_id = ? AND user_uuid != ? AND hidden_at IS NULL
          AND COALESCE(notifications_enabled, 1) = 1
    ");
    $stmt->execute([$conversationId, $senderUserUuid]);
    $recipients = $stmt->fetchAll(PDO::FETCH_COLUMN);
    if (empty($recipients)) {
        pushDebugLog("[{$runId}] SKIP: no recipients", []);
        error_log('sendPushForNewMessage: conv=' . $conversationId . ' no recipients (or all disabled)');
        return;
    }
    pushDebugLog("[{$runId}] Recipients", ['count' => count($recipients), 'uuids' => array_map(function ($u) { return substr($u, 0, 8) . '...'; }, $recipients)]);

    $placeholders = implode(',', array_fill(0, count($recipients), '?'));
    $stmt = $pdo->prepare("
        SELECT id, user_uuid, endpoint, p256dh, auth
        FROM push_subscriptions
        WHERE user_uuid IN ($placeholders)
    ");
    $stmt->execute($recipients);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (empty($rows)) {
        pushDebugLog("[{$runId}] SKIP: no push_subscriptions in DB", ['recipients_count' => count($recipients)]);
        error_log('sendPushForNewMessage: conv=' . $conversationId . ' recipients=' . count($recipients) . ' but no push_subscriptions in DB');
        return;
    }
    pushDebugLog("[{$runId}] Subscriptions to send", ['count' => count($rows), 'ids' => array_column($rows, 'id'), 'endpoints_preview' => array_map(function ($r) { return substr($r['endpoint'], 0, 50) . '...'; }, $rows)]);

    $title = isset($message['username']) ? (string) $message['username'] : 'Новое сообщение';
    $type = $message['type'] ?? 'text';
    $isEncrypted = !empty($message['encrypted']);
    if ($isEncrypted) {
        $body = 'Новое сообщение';
    } elseif ($type === 'image') {
        $body = 'Фото';
    } elseif ($type === 'file') {
        $body = isset($message['file_name']) ? ('Файл: ' . $message['file_name']) : 'Файл';
    } elseif ($type === 'sticker') {
        $body = 'Стикер';
    } else {
        $content = isset($message['content']) ? trim((string) $message['content']) : '';
        $body = $content !== '' ? mb_substr($content, 0, 100, 'UTF-8') : 'Сообщение';
        if (mb_strlen($content, 'UTF-8') > 100) {
            $body .= '…';
        }
    }
    $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
    $url = $baseUrl . '/#/c/' . $conversationId;
    $payload = json_encode([
        'title' => $title,
        'body' => $body,
        'url' => $url,
        'conversation_id' => $conversationId,
        'message_id' => (int) ($message['id'] ?? 0),
    ], JSON_UNESCAPED_UNICODE);
    pushDebugLog("[{$runId}] Payload", ['title' => $title, 'body_len' => strlen($body), 'url' => $url, 'payload_len' => strlen($payload)]);

    $vapid = [
        'subject' => 'mailto:support@' . (parse_url($baseUrl, PHP_URL_HOST) ?: 'localhost'),
        'publicKey' => PUSH_VAPID_PUBLIC_KEY,
        'privateKey' => PUSH_VAPID_PRIVATE_KEY,
    ];
    try {
        $webPush = new \Minishlink\WebPush\WebPush(['VAPID' => $vapid]);
        pushDebugLog("[{$runId}] WebPush instance created", []);
    } catch (Throwable $e) {
        pushDebugLog("[{$runId}] WebPush init FAIL", ['error' => $e->getMessage()]);
        error_log('sendPushForNewMessage WebPush init: ' . $e->getMessage());
        return;
    }

    foreach ($rows as $row) {
        $subId = $row['id'];
        pushDebugLog("[{$runId}] Sending to subscription", ['id' => $subId, 'endpoint' => substr($row['endpoint'], 0, 80) . '...']);
        try {
            $subscription = \Minishlink\WebPush\Subscription::create([
                'endpoint' => $row['endpoint'],
                'keys' => [
                    'p256dh' => $row['p256dh'],
                    'auth' => $row['auth'],
                ],
            ]);
            $report = $webPush->sendOneNotification($subscription, $payload, ['TTL' => 3600]);
            $success = $report->isSuccess();
            $reason = method_exists($report, 'getReason') ? (string) $report->getReason() : '';
            $code = 0;
            $responseBody = '';
            if (method_exists($report, 'getResponse') && $report->getResponse() !== null) {
                $resp = $report->getResponse();
                if (method_exists($resp, 'getStatusCode')) {
                    $code = (int) $resp->getStatusCode();
                }
                if (method_exists($resp, 'getBody')) {
                    $responseBody = (string) $resp->getBody();
                }
            }
            if ($success) {
                pushDebugLog("[{$runId}] SENT OK", ['subscription_id' => $subId]);
                error_log('sendPushForNewMessage: sent ok id=' . $subId);
            } else {
                $isGone = ($code === 410 || $code === 404) || (strpos($reason, '410') !== false || strpos($reason, '404') !== false || stripos($reason, 'Gone') !== false);
                if ($isGone) {
                    $del = $pdo->prepare("DELETE FROM push_subscriptions WHERE id = ?");
                    $del->execute([$subId]);
                    pushDebugLog("[{$runId}] Subscription deleted (410/404)", ['id' => $subId]);
                }
                pushDebugLog("[{$runId}] SEND FAIL", ['subscription_id' => $subId, 'code' => $code, 'reason' => $reason, 'response_body' => substr($responseBody, 0, 200)]);
                error_log('sendPushForNewMessage failed: ' . $reason . ' [code=' . $code . ' endpoint=' . substr($row['endpoint'], 0, 60) . '...]');
            }
        } catch (Throwable $e) {
            pushDebugLog("[{$runId}] EXCEPTION", ['subscription_id' => $subId, 'error' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
            error_log('sendPushForNewMessage exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        }
    }
    pushDebugLog("[{$runId}] END", []);
}

/**
 * Отправить push по списку подписок (общий код для сообщений и звонков).
 * Используется из sendPushForNewMessage и sendPushToUser.
 *
 * @param array $rows Массив подписок: id, endpoint, p256dh, auth
 * @param string $payload JSON-строка payload для push
 */
function sendPushToSubscriptions(array $rows, $payload) {
    global $pdo;
    if (empty($rows)) return;
    if (!defined('PUSH_VAPID_PUBLIC_KEY') || !PUSH_VAPID_PUBLIC_KEY || !defined('PUSH_VAPID_PRIVATE_KEY') || !PUSH_VAPID_PRIVATE_KEY) {
        return;
    }
    $autoload = defined('ROOT_PATH') ? (rtrim(ROOT_PATH, '/\\') . '/vendor/autoload.php') : __DIR__ . '/../vendor/autoload.php';
    if (!is_file($autoload)) return;
    if (!class_exists('Minishlink\WebPush\WebPush')) {
        require_once $autoload;
    }
    if (!class_exists('Minishlink\WebPush\WebPush')) return;
    $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
    $vapid = [
        'subject' => 'mailto:support@' . (parse_url($baseUrl, PHP_URL_HOST) ?: 'localhost'),
        'publicKey' => PUSH_VAPID_PUBLIC_KEY,
        'privateKey' => PUSH_VAPID_PRIVATE_KEY,
    ];
    try {
        $webPush = new \Minishlink\WebPush\WebPush(['VAPID' => $vapid]);
    } catch (Throwable $e) {
        return;
    }
    foreach ($rows as $row) {
        $subId = $row['id'];
        try {
            $subscription = \Minishlink\WebPush\Subscription::create([
                'endpoint' => $row['endpoint'],
                'keys' => ['p256dh' => $row['p256dh'], 'auth' => $row['auth']],
            ]);
            $report = $webPush->sendOneNotification($subscription, $payload, ['TTL' => 3600]);
            if (!$report->isSuccess() && method_exists($report, 'getResponse') && $report->getResponse()) {
                $code = (int) $report->getResponse()->getStatusCode();
                if ($code === 410 || $code === 404) {
                    $pdo->prepare("DELETE FROM push_subscriptions WHERE id = ?")->execute([$subId]);
                }
            }
        } catch (Throwable $e) {
            error_log('sendPushToSubscriptions: ' . $e->getMessage());
        }
    }
}

/**
 * Отправить push-уведомление одному пользователю (например, приглашение в звонок).
 * Использует тот же механизм отправки, что и push для сообщений.
 */
function sendPushToUser($userUuid, $title, $body, $url = '', array $extra = []) {
    global $pdo;
    $stmt = $pdo->prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_uuid = ?");
    $stmt->execute([$userUuid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (empty($rows)) return;
    $baseUrl = defined('BASE_URL') ? rtrim(BASE_URL, '/') : '';
    $payload = json_encode(array_merge([
        'title' => $title,
        'body' => $body,
        'url' => $url ?: $baseUrl,
        'conversation_id' => $extra['conversation_id'] ?? null,
    ], $extra), JSON_UNESCAPED_UNICODE);
    sendPushToSubscriptions($rows, $payload);
}

/**
 * Редирект и выход (для OAuth и др.)
 */
function redirect($url) {
    header('Location: ' . $url);
    exit;
}

/**
 * Санитизация строки для вывода в HTML
 */
function escape($string) {
    return htmlspecialchars($string, ENT_QUOTES, 'UTF-8');
}

/**
 * Валидация имени пользователя (поддержка UTF-8: кириллица, латиница и др.)
 */
function validateUsername($username) {
    if (empty($username)) {
        return ['valid' => false, 'error' => 'Имя пользователя не может быть пустым'];
    }
    $len = mb_strlen($username, 'UTF-8');
    if ($len < 3) {
        return ['valid' => false, 'error' => 'Имя пользователя должно быть не менее 3 символов'];
    }
    if ($len > 50) {
        return ['valid' => false, 'error' => 'Имя пользователя должно быть не более 50 символов'];
    }
    if (!preg_match('/^[\p{L}\p{N}_]+$/u', $username)) {
        return ['valid' => false, 'error' => 'Имя пользователя может содержать только буквы (любого языка), цифры и подчеркивание'];
    }
    return ['valid' => true];
}

/**
 * Валидация пароля
 */
function validatePassword($password) {
    if (empty($password)) {
        return ['valid' => false, 'error' => 'Пароль не может быть пустым'];
    }
    if (strlen($password) < 6) {
        return ['valid' => false, 'error' => 'Пароль должен быть не менее 6 символов'];
    }
    return ['valid' => true];
}

/**
 * Форматирование времени для отображения
 */
function formatTime($datetime) {
    if (empty($datetime)) {
        return '';
    }
    
    $timestamp = strtotime($datetime);
    $now = time();
    $diff = $now - $timestamp;
    
    if ($diff < 60) {
        return 'только что';
    } elseif ($diff < 3600) {
        $minutes = floor($diff / 60);
        return $minutes . ' ' . pluralize($minutes, ['минуту', 'минуты', 'минут']) . ' назад';
    } elseif ($diff < 86400) {
        $hours = floor($diff / 3600);
        return $hours . ' ' . pluralize($hours, ['час', 'часа', 'часов']) . ' назад';
    } elseif ($diff < 604800) {
        $days = floor($diff / 86400);
        return $days . ' ' . pluralize($days, ['день', 'дня', 'дней']) . ' назад';
    } else {
        return date('d.m.Y H:i', $timestamp);
    }
}

/**
 * Склонение слов
 */
function pluralize($number, $forms) {
    $cases = [2, 0, 1, 1, 1, 2];
    return $forms[($number % 100 > 4 && $number % 100 < 20) ? 2 : $cases[min($number % 10, 5)]];
}

/**
 * JSON ответ
 */
function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * JSON ответ с ошибкой
 */
function jsonError($message, $statusCode = 400) {
    jsonResponse(['error' => $message], $statusCode);
}

/**
 * JSON ответ с успехом
 */
function jsonSuccess($data = null, $message = null) {
    $response = ['success' => true];
    if ($message) {
        $response['message'] = $message;
    }
    if ($data !== null) {
        $response['data'] = $data;
    }
    jsonResponse($response);
}

/**
 * Загрузка файла
 * @param array $file массив $_FILES['field']
 * @param string $type тип: 'image', 'file', 'avatar', 'sticker'
 */
function uploadFile($file, $type = 'image') {
    if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
        return ['success' => false, 'error' => 'Ошибка загрузки файла'];
    }
    
    $maxSize = ($type === 'avatar') ? (defined('MAX_AVATAR_SIZE') ? MAX_AVATAR_SIZE : 2 * 1024 * 1024) : MAX_FILE_SIZE;
    if ($type === 'sticker') {
        $maxSize = 5 * 1024 * 1024; // 5 MB для стикеров (в т.ч. GIF/MP4)
    }
    if ($file['size'] > $maxSize) {
        return ['success' => false, 'error' => $type === 'avatar' ? 'Размер аватара не более 2 МБ' : ($type === 'sticker' ? 'Стикер не более 512 КБ' : 'Файл слишком большой')];
    }
    
    $allowedTypes = ($type === 'image' || $type === 'avatar') ? ALLOWED_IMAGE_TYPES : (($type === 'sticker') ? ALLOWED_STICKER_TYPES : (defined('ALLOWED_ATTACH_TYPES') ? ALLOWED_ATTACH_TYPES : ALLOWED_DOCUMENT_TYPES));
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    
    if (!in_array($mimeType, $allowedTypes)) {
        return ['success' => false, 'error' => $type === 'sticker' ? 'Допустимы PNG, GIF, WebP, SVG, MP4' : 'Недопустимый тип файла'];
    }
    
    $extension = pathinfo($file['name'], PATHINFO_EXTENSION);
    $filename = uniqid() . '_' . time() . '.' . $extension;
    $uploadDir = UPLOAD_PATH . ($type === 'avatar' ? 'avatars/' : ($type === 'image' ? 'images/' : 'documents/'));
    $uploadDirName = 'uploads/' . ($type === 'avatar' ? 'avatars/' : ($type === 'image' ? 'images/' : 'documents/'));

    if (!is_dir($uploadDir)) {
        if (!@mkdir($uploadDir, 0755, true)) {
            return ['success' => false, 'error' => 'Не удалось создать папку ' . $uploadDirName . '. Проверьте права на запись (chmod) для папки uploads.'];
        }
    }

    if (!is_writable($uploadDir)) {
        return ['success' => false, 'error' => 'Нет прав на запись в папку ' . $uploadDirName . '. Убедитесь, что веб-сервер может писать в неё (chmod 755 или 775, владелец — пользователь веб-сервера).'];
    }

    $filepath = $uploadDir . $filename;

    if (!move_uploaded_file($file['tmp_name'], $filepath)) {
        return ['success' => false, 'error' => 'Не удалось сохранить файл. Проверьте права на запись в папку ' . $uploadDirName . ' (chmod, владелец папки).'];
    }
    
    $baseUrl = $type === 'avatar' ? UPLOAD_URL . 'avatars/' : ($type === 'image' ? UPLOAD_URL . 'images/' : ($type === 'sticker' ? UPLOAD_URL . 'stickers/' : UPLOAD_URL . 'documents/'));
    return [
        'success' => true,
        'filename' => $filename,
        'filepath' => $filepath,
        'url' => $baseUrl . $filename,
        'size' => $file['size'],
        'mime_type' => $mimeType
    ];
}

/**
 * Группировка списка реакций по emoji: count, has_own и при count=1 — аватар/имя автора.
 * Вход: массив [ ['emoji' => ..., 'user_uuid' => ..., 'avatar' => ?, 'username' => ?], ... ]
 * Выход: [ ['emoji' => ..., 'count' => N, 'has_own' => bool, 'single_avatar' => ?, 'single_username' => ?], ... ]
 */
function groupReactionsByEmoji(array $list, $currentUserUuid) {
    $byEmoji = [];
    foreach ($list as $r) {
        $emoji = $r['emoji'] ?? '';
        if (!isset($byEmoji[$emoji])) {
            $byEmoji[$emoji] = ['count' => 0, 'has_own' => false, 'first_avatar' => null, 'first_username' => null, 'first_user_uuid' => null];
        }
        $byEmoji[$emoji]['count']++;
        if (($r['user_uuid'] ?? '') === $currentUserUuid) {
            $byEmoji[$emoji]['has_own'] = true;
        }
        if ($byEmoji[$emoji]['count'] === 1) {
            $byEmoji[$emoji]['first_avatar'] = $r['avatar'] ?? null;
            $dn = trim($r['display_name'] ?? '');
            $un = trim($r['username'] ?? '');
            $byEmoji[$emoji]['first_username'] = $dn ?: ($un ?: null);
            $byEmoji[$emoji]['first_user_uuid'] = $r['user_uuid'] ?? null;
        }
    }
    $result = [];
    foreach ($byEmoji as $emoji => $data) {
        $item = ['emoji' => $emoji, 'count' => (int)$data['count'], 'has_own' => $data['has_own']];
        if ($data['count'] === 1) {
            if ($data['first_avatar'] !== null && $data['first_avatar'] !== '') {
                $item['single_avatar'] = $data['first_avatar'];
            }
            if ($data['first_username'] !== null && $data['first_username'] !== '') {
                $item['single_username'] = $data['first_username'];
            }
            if ($data['first_user_uuid'] !== null && $data['first_user_uuid'] !== '') {
                $item['single_user_uuid'] = $data['first_user_uuid'];
            }
        }
        $result[] = $item;
    }
    return $result;
}
