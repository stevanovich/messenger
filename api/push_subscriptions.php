<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}

updateLastSeenIfNeeded();

$method = $_SERVER['REQUEST_METHOD'];
global $pdo;
$userUuid = getCurrentUserUuid();

// Публичный ключ VAPID и (опционально) статус подписки по endpoint
if ($method === 'GET') {
    $publicKey = defined('PUSH_VAPID_PUBLIC_KEY') ? PUSH_VAPID_PUBLIC_KEY : '';
    $data = ['public_key' => $publicKey];
    $endpoint = trim((string) ($_GET['endpoint'] ?? ''));
    if ($endpoint !== '') {
        $stmt = $pdo->prepare("SELECT 1 FROM push_subscriptions WHERE user_uuid = ? AND endpoint = ? LIMIT 1");
        $stmt->execute([$userUuid, $endpoint]);
        $data['subscribed'] = (bool) $stmt->fetch();
    }
    if ($publicKey === '' && $endpoint === '') {
        jsonError('Push-уведомления не настроены', 503);
    }
    jsonSuccess($data);
    exit;
}

// Сохранить подписку
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body) || empty($body['subscription']) || !is_array($body['subscription'])) {
        jsonError('Неверное тело запроса: ожидается { "subscription": { "endpoint", "keys": { "p256dh", "auth" } } }');
    }
    $sub = $body['subscription'];
    $endpoint = is_string($sub['endpoint'] ?? null) ? trim($sub['endpoint']) : '';
    $keys = $sub['keys'] ?? [];
    $p256dh = is_string($keys['p256dh'] ?? null) ? trim($keys['p256dh']) : '';
    $auth = is_string($keys['auth'] ?? null) ? trim($keys['auth']) : '';
    if ($endpoint === '' || $p256dh === '' || $auth === '') {
        jsonError('В подписке должны быть endpoint, keys.p256dh и keys.auth');
    }
    if (strlen($endpoint) > 512) {
        jsonError('endpoint слишком длинный');
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO push_subscriptions (user_uuid, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), updated_at = CURRENT_TIMESTAMP
        ");
        $stmt->execute([$userUuid, $endpoint, $p256dh, $auth]);
    } catch (PDOException $e) {
        error_log('push_subscriptions POST: ' . $e->getMessage());
        jsonError('Ошибка сохранения подписки', 500);
    }
    jsonSuccess(null, 'Подписка сохранена');
    exit;
}

// Удалить подписку (для тумблера «выкл» в профиле)
if ($method === 'DELETE') {
    $body = json_decode(file_get_contents('php://input'), true);
    $endpoint = null;
    if (is_array($body) && isset($body['endpoint'])) {
        $endpoint = trim((string) $body['endpoint']);
    }
    if ($endpoint === '' || $endpoint === null) {
        $endpoint = trim((string) ($_GET['endpoint'] ?? ''));
    }
    if ($endpoint === '') {
        jsonError('Укажите endpoint подписки в теле запроса или в query: endpoint');
    }

    try {
        $stmt = $pdo->prepare("DELETE FROM push_subscriptions WHERE user_uuid = ? AND endpoint = ?");
        $stmt->execute([$userUuid, $endpoint]);
    } catch (PDOException $e) {
        error_log('push_subscriptions DELETE: ' . $e->getMessage());
        jsonError('Ошибка удаления подписки', 500);
    }
    jsonSuccess(null, 'Подписка удалена');
    exit;
}

jsonError('Метод не поддерживается', 405);
