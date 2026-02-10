<?php
/**
 * API приглашений в беседу по ссылке (внешние беседы).
 * conv_invite_info — без авторизации; conv_invite_join — с авторизацией.
 */
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'conv_invite_info') {
    if ($method !== 'GET') {
        jsonError('Метод не разрешён', 405);
    }
    $token = trim((string)($_GET['token'] ?? ''));
    if ($token === '') {
        jsonError('Укажите token', 400);
    }
    global $pdo;
    $stmt = $pdo->prepare("
        SELECT cil.id, cil.conversation_id, cil.expires_at, c.name AS conversation_name, c.type
        FROM conversation_invite_links cil
        INNER JOIN conversations c ON c.id = cil.conversation_id
        WHERE cil.token = ? AND cil.expires_at > NOW()
    ");
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        jsonError('Ссылка недействительна или истекла', 404);
    }
    jsonSuccess([
        'conversation_id' => (int) $row['conversation_id'],
        'conversation_name' => $row['conversation_name'] ?: 'Беседа',
        'expires_at' => $row['expires_at'],
    ]);
    exit;
}

if ($action === 'conv_invite_join') {
    if ($method !== 'POST') {
        jsonError('Метод не разрешён', 405);
    }
    if (!isLoggedIn()) {
        jsonError('Войдите в аккаунт, чтобы присоединиться к беседе', 401);
    }
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $token = trim((string)($input['token'] ?? $input['link_token'] ?? ''));
    if ($token === '') {
        jsonError('Укажите token', 400);
    }
    global $pdo;
    $currentUserUuid = getCurrentUserUuid();
    $stmt = $pdo->prepare("
        SELECT cil.conversation_id
        FROM conversation_invite_links cil
        WHERE cil.token = ? AND cil.expires_at > NOW()
    ");
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        jsonError('Ссылка недействительна или истекла', 404);
    }
    $conversationId = (int) $row['conversation_id'];
    $stmt = $pdo->prepare("SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_uuid = ?");
    $stmt->execute([$conversationId, $currentUserUuid]);
    if ($stmt->fetch()) {
        jsonSuccess(['conversation_id' => $conversationId], 'Вы уже в этой беседе');
        exit;
    }
    $stmt = $pdo->prepare("
        INSERT INTO conversation_participants (conversation_id, user_uuid, role)
        VALUES (?, ?, 'member')
    ");
    $stmt->execute([$conversationId, $currentUserUuid]);
    updateLastSeenIfNeeded();
    jsonSuccess(['conversation_id' => $conversationId], 'Вы присоединились к беседе');
    exit;
}

jsonError('Неизвестное действие', 400);
