<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}

$method = $_SERVER['REQUEST_METHOD'];
$currentUserUuid = getCurrentUserUuid();
global $pdo;

switch ($method) {
    case 'GET':
        $action = $_GET['action'] ?? '';
        
        if ($action === 'search') {
            // Поиск пользователей
            $query = trim($_GET['q'] ?? '');
            
            if (empty($query) || strlen($query) < 2) {
                jsonSuccess(['users' => []]);
            }
            
            $searchTerm = '%' . $query . '%';
            $stmt = $pdo->prepare("
                SELECT uuid, username, display_name, status, avatar, last_seen
                FROM users
                WHERE username LIKE ? AND uuid != ? AND (visible_in_contacts = 1 OR visible_in_contacts IS NULL)
                ORDER BY username
                LIMIT 20
            ");
            $stmt->execute([$searchTerm, $currentUserUuid]);
            $users = $stmt->fetchAll();
            // Для API возвращаем uuid, не id
            $users = array_map(function ($u) {
                return ['uuid' => $u['uuid'], 'username' => $u['username'], 'display_name' => $u['display_name'] ?? null, 'status' => $u['status'] ?? null, 'avatar' => $u['avatar'], 'last_seen' => $u['last_seen']];
            }, $users);
            
            jsonSuccess(['users' => $users]);
        } elseif ($action === 'contacts') {
            // Список контактов — все пользователи кроме текущего
            $limit = min(100, (int)($_GET['limit'] ?? 100));
            $stmt = $pdo->prepare("
                SELECT uuid, username, display_name, status, avatar, last_seen
                FROM users
                WHERE uuid != ? AND (visible_in_contacts = 1 OR visible_in_contacts IS NULL)
                ORDER BY username
                LIMIT ?
            ");
            $stmt->execute([$currentUserUuid, $limit]);
            $users = $stmt->fetchAll();
            $users = array_map(function ($u) {
                return ['uuid' => $u['uuid'], 'username' => $u['username'], 'display_name' => $u['display_name'] ?? null, 'status' => $u['status'] ?? null, 'avatar' => $u['avatar'], 'last_seen' => $u['last_seen']];
            }, $users);
            jsonSuccess(['users' => $users]);
        } else {
            // Получение информации о пользователе (по uuid или текущий)
            $userUuid = $_GET['uuid'] ?? $currentUserUuid;
            if (empty($userUuid)) {
                jsonError('Не указан пользователь', 400);
            }
            $stmt = $pdo->prepare("
                SELECT uuid, username, display_name, status, avatar, created_at, last_seen
                FROM users
                WHERE uuid = ?
            ");
            $stmt->execute([$userUuid]);
            $user = $stmt->fetch();
            
            if (!$user) {
                jsonError('Пользователь не найден', 404);
            }
            
            jsonSuccess(['user' => $user]);
        }
        break;

    case 'PATCH':
    case 'PUT':
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $updates = [];
        $params = [];
        $targetUuid = trim($_GET['uuid'] ?? $data['uuid'] ?? '');
        $isAdminEdit = isAdmin() && $targetUuid !== '' && $targetUuid !== $currentUserUuid;
        if ($isAdminEdit) {
            $stmt = $pdo->prepare("SELECT uuid FROM users WHERE uuid = ?");
            $stmt->execute([$targetUuid]);
            if (!$stmt->fetch()) {
                jsonError('Пользователь не найден', 404);
            }
        } else {
            $targetUuid = $currentUserUuid;
        }
        
        // Обновление аватара (только свой профиль)
        if (!$isAdminEdit && array_key_exists('avatar', $data)) {
            $avatar = $data['avatar'];
            if ($avatar === null || $avatar === '') {
                $updates[] = 'avatar = NULL';
            } else {
                $avatar = trim((string) $avatar);
                $validUrl = strlen($avatar) <= 255 && (
                    strpos($avatar, UPLOAD_URL) === 0 ||
                    strpos($avatar, '/uploads/avatars/') !== false ||
                    preg_match('#^https?://[^/]+/.*uploads/avatars/#', $avatar)
                );
                if ($validUrl) {
                    $updates[] = 'avatar = ?';
                    $params[] = $avatar;
                }
            }
        }
        
        // display_name и status (только свой профиль)
        if (!$isAdminEdit && array_key_exists('display_name', $data)) {
            $displayName = trim((string) ($data['display_name'] ?? ''));
            $displayName = strlen($displayName) > 255 ? substr($displayName, 0, 255) : $displayName;
            $updates[] = 'display_name = ?';
            $params[] = $displayName === '' ? null : $displayName;
        }
        if (!$isAdminEdit && array_key_exists('status', $data)) {
            $status = trim((string) ($data['status'] ?? ''));
            $status = strlen($status) > 255 ? substr($status, 0, 255) : $status;
            $updates[] = 'status = ?';
            $params[] = $status === '' ? null : $status;
        }

        // Видимость в общем списке контактов (свой профиль или админ — чужой)
        if (array_key_exists('visible_in_contacts', $data)) {
            $visible = (bool) $data['visible_in_contacts'];
            $updates[] = 'visible_in_contacts = ?';
            $params[] = $visible ? 1 : 0;
        }

        // Смена логина (username) — только свой профиль
        $newUsername = '';
        if (!$isAdminEdit) {
            $newUsername = trim($data['username'] ?? '');
            if (!empty($newUsername)) {
                $usernameValidation = validateUsername($newUsername);
                if (!$usernameValidation['valid']) {
                    jsonError($usernameValidation['error']);
                }
                $stmt = $pdo->prepare("SELECT uuid FROM users WHERE username = ? AND uuid != ?");
                $stmt->execute([$newUsername, $currentUserUuid]);
                if ($stmt->fetch()) {
                    jsonError('Этот логин уже занят');
                }
                $updates[] = 'username = ?';
                $params[] = $newUsername;
            }
        }
        
        if (empty($updates)) {
            jsonError('Не указаны данные для обновления');
        }
        
        $params[] = $targetUuid;
        $sql = "UPDATE users SET " . implode(', ', $updates) . " WHERE uuid = ?";
        $stmt = $pdo->prepare($sql);
        if ($stmt->execute($params)) {
            if (!$isAdminEdit && !empty($newUsername)) {
                $_SESSION['username'] = $newUsername;
            }
            $msg = !empty($updates) ? ($isAdminEdit ? 'Настройка обновлена' : 'Профиль обновлён') : '';
            jsonSuccess(['username' => $newUsername ?: null, 'avatar' => $data['avatar'] ?? null, 'display_name' => $data['display_name'] ?? null, 'status' => $data['status'] ?? null, 'visible_in_contacts' => array_key_exists('visible_in_contacts', $data) ? (bool)$data['visible_in_contacts'] : null], $msg);
        } else {
            jsonError('Ошибка при обновлении');
        }
        break;

    case 'DELETE':
        // Удаление пользователя (только для администраторов)
        if (!isAdmin()) {
            jsonError('Доступ запрещён', 403);
        }
        $targetUuid = trim($_GET['uuid'] ?? '');
        if (empty($targetUuid)) {
            jsonError('Не указан UUID пользователя', 400);
        }
        if ($targetUuid === $currentUserUuid) {
            jsonError('Нельзя удалить свою учётную запись', 400);
        }
        $stmt = $pdo->prepare("SELECT uuid FROM users WHERE uuid = ?");
        $stmt->execute([$targetUuid]);
        $user = $stmt->fetch();
        if (!$user) {
            jsonError('Пользователь не найден', 404);
        }
        $stmt = $pdo->prepare("DELETE FROM users WHERE uuid = ?");
        $stmt->execute([$targetUuid]);
        jsonSuccess(null, 'Пользователь удалён');
        break;

    default:
        jsonError('Метод не поддерживается', 405);
}
