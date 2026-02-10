<?php
use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
require __DIR__ . '/../vendor/autoload.php';

$configFile = __DIR__ . '/../config/config.php';
if (is_file($configFile)) {
    require $configFile;
}
require_once __DIR__ . '/../config/database.php';

$wsHost = defined('WEBSOCKET_HOST') ? WEBSOCKET_HOST : '0.0.0.0';
$wsPort = (int) (defined('WEBSOCKET_PORT') ? WEBSOCKET_PORT : 8080);

/**
 * Протокол:
 * - Первое сообщение: авторизация — строка с токеном или JSON {"type":"auth","token":"..."}.
 *   Токен: ws_tokens (пользователь) или ws_guest_tokens (гость звонка).
 * - Дальше: {"type":"subscribe","conversation_id":123} — подписка на беседу (гости уже привязаны к conversation_id по токену).
 * - События от сервера: message.new, reaction.update, conversation.updated, call.* (в т.ч. для гостей по conversation_id).
 */
class Chat implements Ratchet\MessageComponentInterface {
    protected $clients;
    /** @var array int resourceId => ['user_uuid' => string|null, 'pending_token' => bool, 'conversation_id' => int|null, 'is_guest' => bool, 'guest_id' => int|null, 'group_call_id' => int|null] */
    protected $connData = [];

    public function __construct() {
        $this->clients = new \SplObjectStorage;
    }

    public function onOpen(Ratchet\ConnectionInterface $conn) {
        $this->clients->attach($conn);
        $this->connData[$conn->resourceId] = ['user_uuid' => null, 'pending_token' => true, 'conversation_id' => null, 'is_guest' => false, 'guest_id' => null, 'group_call_id' => null];
        echo "Подключение ({$conn->resourceId}), ожидание токена\n";
    }

    public function onMessage(Ratchet\ConnectionInterface $from, $msg) {
        $rid = $from->resourceId;
        $data = $this->connData[$rid] ?? null;
        if (!$data) {
            $from->close();
            return;
        }

        if (!empty($data['pending_token'])) {
            $this->handleAuth($from, $msg, $rid);
            return;
        }

        $decoded = json_decode($msg, true);
        if (is_array($decoded) && isset($decoded['type']) && $decoded['type'] === 'subscribe') {
            if (!empty($this->connData[$rid]['is_guest'])) {
                $from->send(json_encode(['type' => 'subscribed', 'conversation_id' => $this->connData[$rid]['conversation_id']]));
                return;
            }
            $convId = isset($decoded['conversation_id']) ? (int) $decoded['conversation_id'] : null;
            $this->connData[$rid]['conversation_id'] = $convId > 0 ? $convId : null;
            $from->send(json_encode(['type' => 'subscribed', 'conversation_id' => $this->connData[$rid]['conversation_id']]));
            return;
        }
    }

    /**
     * Отправка payload конкретному пользователю (по user_uuid).
     * Для событий message.status_update — только автору сообщения.
     */
    public function sendToUser(string $userUuid, string $payload): void {
        foreach ($this->clients as $client) {
            $cdata = $this->connData[$client->resourceId] ?? null;
            if ($cdata && !empty($cdata['user_uuid']) && $cdata['user_uuid'] === $userUuid) {
                $client->send($payload);
            }
        }
    }

    /**
     * Рассылка payload всем подключённым участникам беседы (conversation_participants) и гостям звонка (по conversation_id).
     */
    public function broadcastToConversation(int $conversationId, string $payload): void {
        global $pdo;
        if (function_exists('ensurePdoConnection')) ensurePdoConnection();
        $stmt = $pdo->prepare("SELECT user_uuid FROM conversation_participants WHERE conversation_id = ? AND (hidden_at IS NULL OR hidden_at > NOW())");
        $stmt->execute([$conversationId]);
        $userUuids = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $userUuids[$row['user_uuid']] = true;
        }
        foreach ($this->clients as $client) {
            $crid = $client->resourceId;
            $cdata = $this->connData[$crid] ?? null;
            if (!$cdata) continue;
            if (!empty($cdata['user_uuid']) && isset($userUuids[$cdata['user_uuid']])) {
                $client->send($payload);
            } elseif (!empty($cdata['is_guest']) && isset($cdata['conversation_id']) && (int) $cdata['conversation_id'] === $conversationId) {
                $client->send($payload);
            }
        }
    }

    private function handleAuth(Ratchet\ConnectionInterface $from, string $msg, int $rid): void {
        $token = $this->parseTokenFromMessage($msg);
        if ($token === null) {
            echo "Неверный формат токена от {$rid}\n";
            $from->send(json_encode(['type' => 'auth_error', 'message' => 'Требуется токен']));
            $from->close();
            return;
        }
        $token = trim($token);
        if ($token === '') {
            $from->send(json_encode(['type' => 'auth_error', 'message' => 'Требуется токен']));
            $from->close();
            return;
        }
        global $pdo;
        if (function_exists('ensurePdoConnection')) ensurePdoConnection();
        $stmt = $pdo->prepare("SELECT user_uuid FROM ws_tokens WHERE token = ? AND expires_at > NOW()");
        $stmt->execute([$token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $userUuid = $row['user_uuid'];
            $pdo->prepare("DELETE FROM ws_tokens WHERE token = ?")->execute([$token]);
            $this->connData[$rid]['user_uuid'] = $userUuid;
            $this->connData[$rid]['pending_token'] = false;
            $from->send(json_encode(['type' => 'auth_ok', 'user_uuid' => $userUuid]));
            echo "Авторизован {$rid} -> {$userUuid}\n";
            return;
        }
        // Гостевой токен: проверяем только наличие и что гость ещё в звонке (без проверки expires_at — избегаем проблем с таймзоной/часами)
        $stmt = $pdo->prepare("
            SELECT wgt.group_call_guest_id
            FROM ws_guest_tokens wgt
            WHERE wgt.token = ?
        ");
        $stmt->execute([$token]);
        $guestTokenRow = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($guestTokenRow) {
            $guestId = (int) $guestTokenRow['group_call_guest_id'];
            $stmt = $pdo->prepare("
                SELECT gcg.id, gcg.group_call_id, gcg.display_name, gc.conversation_id
                FROM group_call_guests gcg
                INNER JOIN group_calls gc ON gc.id = gcg.group_call_id AND gc.ended_at IS NULL
                WHERE gcg.id = ? AND gcg.left_at IS NULL
            ");
            $stmt->execute([$guestId]);
            $guestRow = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($guestRow) {
                $this->connData[$rid]['user_uuid'] = null;
                $this->connData[$rid]['pending_token'] = false;
                $this->connData[$rid]['is_guest'] = true;
                $this->connData[$rid]['guest_id'] = (int) $guestRow['id'];
                $this->connData[$rid]['group_call_id'] = (int) $guestRow['group_call_id'];
                $this->connData[$rid]['conversation_id'] = (int) $guestRow['conversation_id'];
                $from->send(json_encode([
                    'type' => 'auth_ok',
                    'guest_id' => (int) $guestRow['id'],
                    'group_call_id' => (int) $guestRow['group_call_id'],
                    'conversation_id' => (int) $guestRow['conversation_id'],
                    'display_name' => $guestRow['display_name'],
                ]));
                echo "Гость авторизован {$rid} -> guest_id={$guestRow['id']}\n";
                return;
            }
        }
        echo "Невалидный/истёкший токен от {$rid}\n";
        $from->send(json_encode(['type' => 'auth_error', 'message' => 'Токен недействителен или истёк']));
        $from->close();
    }

    private function parseTokenFromMessage($msg) {
        $msg = trim($msg);
        if ($msg === '') return null;
        if ($msg[0] === '{') {
            $decoded = json_decode($msg, true);
            if (is_array($decoded) && !empty($decoded['token'])) {
                return $decoded['token'];
            }
            if (is_array($decoded) && isset($decoded['type']) && $decoded['type'] === 'auth' && !empty($decoded['token'])) {
                return $decoded['token'];
            }
            return null;
        }
        return strlen($msg) <= 128 ? $msg : null;
    }

    public function onClose(Ratchet\ConnectionInterface $conn) {
        unset($this->connData[$conn->resourceId]);
        $this->clients->detach($conn);
    }

    public function onError(Ratchet\ConnectionInterface $conn, \Exception $e) {
        echo "Ошибка: {$e->getMessage()}\n";
        unset($this->connData[$conn->resourceId]);
        $conn->close();
    }
}

$chat = new Chat();
$wsServer = new WsServer($chat);
$server = IoServer::factory(
    new HttpServer($wsServer),
    $wsPort,
    $wsHost
);
// Ping каждые 25 сек — предотвращает 1006 от reverse proxy (таймаут неактивных соединений)
$wsServer->enableKeepAlive($server->loop, 25);

$eventPort = (int) (defined('WEBSOCKET_EVENT_PORT') ? WEBSOCKET_EVENT_PORT : 8082);
$eventSocket = new \React\Socket\SocketServer('127.0.0.1:' . $eventPort, [], $server->loop);
$eventSocket->on('connection', function (\React\Socket\ConnectionInterface $conn) use ($chat) {
    $buffer = '';
    $conn->on('data', function ($data) use ($conn, $chat, &$buffer) {
        $buffer .= $data;
        if (strpos($buffer, "\r\n\r\n") === false) return;
        $parts = explode("\r\n\r\n", $buffer, 2);
        $headers = $parts[0];
        $body = $parts[1] ?? '';
        if (preg_match('/Content-Length:\s*(\d+)/i', $headers, $m)) {
            $len = (int) $m[1];
            if (strlen($body) < $len) return;
            $body = substr($body, 0, $len);
        }
        $buffer = '';
        $method = (strpos($headers, 'POST') === 0) ? 'POST' : '';
        $path = '';
        if (preg_match('/^[A-Z]+\s+(\S+)/', $headers, $m)) $path = $m[1];
        $response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        if ($method === 'POST' && (strpos($path, '/event') === 0 || $path === '/')) {
            $json = json_decode($body, true);
            if (is_array($json) && isset($json['event'])) {
                $event = $json['event'];
                $payloadData = $json['data'] ?? [];
                $targetUserUuid = $json['target_user_uuid'] ?? null;
                $convId = isset($json['conversation_id']) ? (int) $json['conversation_id'] : 0;
                if ($targetUserUuid && strlen($targetUserUuid) === 36) {
                    $payloadData['conversation_id'] = $convId;
                    $payload = json_encode(['type' => $event, 'data' => $payloadData]);
                    $chat->sendToUser($targetUserUuid, $payload);
                } elseif ($convId > 0) {
                    $payloadData['conversation_id'] = $convId;
                    $payload = json_encode(['type' => $event, 'data' => $payloadData]);
                    $chat->broadcastToConversation($convId, $payload);
                }
                $response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK";
            }
        }
        $conn->write($response);
        $conn->end();
    });
});

try {
    echo "WebSocket server listening on {$wsHost}:{$wsPort}\n";
    echo "Event hook on 127.0.0.1:{$eventPort}\n";
    $server->run();
} catch (\RuntimeException $e) {
    if (strpos($e->getMessage(), 'Address already in use') !== false || strpos($e->getMessage(), 'EADDRINUSE') !== false) {
        fwrite(STDERR, "Порт {$wsPort} занят. Остановите другой процесс (websocket/server.php) или задайте другой WEBSOCKET_PORT в config/config.php.\n");
    }
    throw $e;
}
