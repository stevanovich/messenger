<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../config/oauth_helpers.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'me':
        if ($method === 'GET') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            updateLastSeenIfNeeded();
            global $pdo;
            $uuid = getCurrentUserUuid();
            $stmt = $pdo->prepare("SELECT uuid, username, display_name, status, avatar, created_at, last_seen, password_hash, visible_in_contacts FROM users WHERE uuid = ?");
            $stmt->execute([$uuid]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$user) {
                jsonError('Пользователь не найден', 404);
            }
            $hasPassword = !empty($user['password_hash']);
            unset($user['password_hash']);
            $user['has_password'] = $hasPassword;
            $user['connectors'] = array_map(function ($c) {
                return [
                    'id' => (int) $c['id'],
                    'provider' => $c['provider'],
                    'provider_email' => $c['provider_email'] ?? null
                ];
            }, getUserOAuthConnectors($uuid));
            jsonSuccess($user);
        }
        break;

    case 'connectors':
        if ($method === 'GET') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            $list = getUserOAuthConnectors(getCurrentUserUuid());
            $list = array_map(function ($c) {
                return ['id' => (int) $c['id'], 'provider' => $c['provider'], 'provider_email' => $c['provider_email'] ?? null];
            }, $list);
            jsonSuccess(['connectors' => $list]);
        }
        break;

    case 'unlink_connector':
        if ($method === 'POST' || $method === 'DELETE') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            $data = $method === 'POST' ? (json_decode(file_get_contents('php://input'), true) ?? []) : [];
            $id = (int) ($data['id'] ?? $_GET['id'] ?? 0);
            if ($id <= 0) {
                jsonError('Не указан коннектор', 400);
            }
            $ok = removeOAuthConnector($id, getCurrentUserUuid());
            if (!$ok) {
                jsonError('Не удалось отвязать. Убедитесь, что у вас задан пароль или привязан другой способ входа.', 400);
            }
            jsonSuccess(null, 'Аккаунт отвязан');
        }
        break;

    case 'set_password':
        if ($method === 'POST') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            $data = json_decode(file_get_contents('php://input'), true) ?? [];
            $currentPassword = $data['current_password'] ?? '';
            $newPassword = $data['new_password'] ?? '';
            $uuid = getCurrentUserUuid();
            global $pdo;
            $stmt = $pdo->prepare("SELECT password_hash FROM users WHERE uuid = ?");
            $stmt->execute([$uuid]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$user) {
                jsonError('Пользователь не найден', 404);
            }
            $hasPassword = !empty($user['password_hash']);
            if ($hasPassword) {
                if (empty($currentPassword)) {
                    jsonError('Введите текущий пароль');
                }
                if (!verifyPassword($currentPassword, $user['password_hash'])) {
                    jsonError('Неверный текущий пароль', 401);
                }
            }
            $pv = validatePassword($newPassword);
            if (!$pv['valid']) {
                jsonError($pv['error']);
            }
            $hash = hashPassword($newPassword);
            $stmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE uuid = ?");
            if ($stmt->execute([$hash, $uuid])) {
                jsonSuccess(null, $hasPassword ? 'Пароль изменён' : 'Пароль задан');
            } else {
                jsonError('Ошибка при сохранении пароля');
            }
        }
        break;
        
    case 'register':
        if ($method === 'POST') {
            $data = json_decode(file_get_contents('php://input'), true);
            $username = trim($data['username'] ?? '');
            $password = $data['password'] ?? '';
            
            $usernameValidation = validateUsername($username);
            if (!$usernameValidation['valid']) {
                jsonError($usernameValidation['error']);
            }
            
            $passwordValidation = validatePassword($password);
            if (!$passwordValidation['valid']) {
                jsonError($passwordValidation['error']);
            }
            
            global $pdo;
            $stmt = $pdo->prepare("SELECT uuid FROM users WHERE username = ?");
            $stmt->execute([$username]);
            if ($stmt->fetch()) {
                jsonError('Пользователь с таким именем уже существует');
            }
            
            $uuid = generateUuid();
            $passwordHash = hashPassword($password);
            $stmt = $pdo->prepare("INSERT INTO users (uuid, username, password_hash) VALUES (?, ?, ?)");
            if ($stmt->execute([$uuid, $username, $passwordHash])) {
                jsonSuccess(['user_uuid' => $uuid], 'Регистрация успешна');
            } else {
                jsonError('Ошибка при регистрации');
            }
        }
        break;
        
    case 'login':
        if ($method === 'POST') {
            $data = json_decode(file_get_contents('php://input'), true);
            $username = trim($data['username'] ?? '');
            $password = $data['password'] ?? '';
            
            if (empty($username) || empty($password)) {
                jsonError('Заполните все поля');
            }
            
            global $pdo;
            $stmt = $pdo->prepare("SELECT uuid, username, password_hash FROM users WHERE username = ?");
            $stmt->execute([$username]);
            $user = $stmt->fetch();
            
            if ($user) {
                if (empty($user['password_hash'])) {
                    jsonError('Этот аккаунт доступен только через вход Google или Яндекс', 401);
                } elseif (verifyPassword($password, $user['password_hash'])) {
                    $_SESSION['user_uuid'] = $user['uuid'];
                    $_SESSION['username'] = $user['username'];
                    $stmt = $pdo->prepare("UPDATE users SET last_seen = NOW() WHERE uuid = ?");
                    $stmt->execute([$user['uuid']]);
                    jsonSuccess(['user' => ['uuid' => $user['uuid'], 'username' => $user['username']]], 'Вход выполнен');
                } else {
                    jsonError('Неверное имя пользователя или пароль', 401);
                }
            } else {
                jsonError('Неверное имя пользователя или пароль', 401);
            }
        }
        break;
        
    case 'logout':
        if ($method === 'POST') {
            session_destroy();
            jsonSuccess(null, 'Выход выполнен');
        }
        break;

    case 'ws_token':
        if ($method === 'GET') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            global $pdo;
            $userUuid = getCurrentUserUuid();
            $token = bin2hex(random_bytes(32));
            $expiresAt = date('Y-m-d H:i:s', time() + 900); // 15 минут
            $stmt = $pdo->prepare("INSERT INTO ws_tokens (token, user_uuid, expires_at) VALUES (?, ?, ?)");
            $stmt->execute([$token, $userUuid, $expiresAt]);
            jsonSuccess(['token' => $token, 'expires_at' => $expiresAt]);
        }
        break;

    case 'delete_account':
        if ($method === 'POST') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            $uuid = getCurrentUserUuid();
            global $pdo;
            $stmt = $pdo->prepare("SELECT password_hash FROM users WHERE uuid = ?");
            $stmt->execute([$uuid]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$user) {
                jsonError('Пользователь не найден', 404);
            }
            $hasPassword = !empty($user['password_hash']);
            if ($hasPassword) {
                $data = json_decode(file_get_contents('php://input'), true) ?? [];
                $password = $data['password'] ?? '';
                if (empty($password)) {
                    jsonError('Введите пароль для подтверждения удаления аккаунта', 400);
                }
                if (!verifyPassword($password, $user['password_hash'])) {
                    jsonError('Неверный пароль', 401);
                }
            }
            try {
                $pdo->beginTransaction();
                try {
                    $stmtConn = $pdo->prepare("DELETE FROM user_oauth_connectors WHERE user_uuid = ?");
                    $stmtConn->execute([$uuid]);
                } catch (PDOException $e) {
                    if (strpos($e->getMessage(), 'user_oauth_connectors') === false) {
                        throw $e;
                    }
                }
                $stmt = $pdo->prepare("DELETE FROM users WHERE uuid = ?");
                $stmt->execute([$uuid]);
                if ($stmt->rowCount() === 0) {
                    $pdo->rollBack();
                    jsonError('Ошибка при удалении аккаунта', 500);
                }
                $pdo->commit();
            } catch (PDOException $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                error_log("delete_account: " . $e->getMessage());
                jsonError('Ошибка при удалении аккаунта', 500);
            }
            session_destroy();
            jsonSuccess(null, 'Аккаунт удалён');
        }
        break;

    case 'delete_history':
        if ($method === 'POST') {
            if (!isLoggedIn()) {
                jsonError('Не авторизован', 401);
            }
            $uuid = getCurrentUserUuid();
            global $pdo;
            $stmt = $pdo->prepare("UPDATE messages SET user_uuid = NULL WHERE user_uuid = ?");
            $stmt->execute([$uuid]);
            jsonSuccess(null, 'История анонимизирована');
        }
        break;
        
    default:
        jsonError('Неизвестное действие', 404);
}
