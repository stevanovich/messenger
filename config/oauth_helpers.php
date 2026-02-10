<?php
/**
 * OAuth-хелперы для мессенджера (PDO, user_uuid)
 * Требует: config.php, database.php (глобальный $pdo)
 */

if (!isset($pdo)) {
    require_once __DIR__ . '/config.php';
    require_once __DIR__ . '/database.php';
}

function oauthFetchOne($query, $params = []) {
    global $pdo;
    $stmt = $pdo->prepare($query);
    $stmt->execute(array_values($params));
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function oauthExecute($query, $params = []) {
    global $pdo;
    $stmt = $pdo->prepare($query);
    return $stmt->execute(array_values($params));
}

function oauthFetchAll($query, $params = []) {
    global $pdo;
    $stmt = $pdo->prepare($query);
    $stmt->execute(array_values($params));
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Найти пользователя по коннектору (provider + provider_user_id)
 */
function getOAuthConnector($provider, $providerUserId) {
    return oauthFetchOne(
        "SELECT uoc.*, u.uuid, u.username, u.avatar, u.password_hash 
         FROM user_oauth_connectors uoc 
         JOIN users u ON u.uuid = uoc.user_uuid 
         WHERE uoc.provider = ? AND uoc.provider_user_id = ?",
        [$provider, $providerUserId]
    );
}

/**
 * Все OAuth-коннекторы пользователя
 */
function getUserOAuthConnectors($userUuid) {
    return oauthFetchAll(
        "SELECT * FROM user_oauth_connectors WHERE user_uuid = ? ORDER BY created_at ASC",
        [$userUuid]
    );
}

/**
 * Создать или обновить коннектор
 */
function createOrUpdateOAuthConnector($userUuid, $provider, $providerUserId, $providerEmail = null, $providerAvatarUrl = null, $isPrimaryAvatar = false) {
    $existing = oauthFetchOne(
        "SELECT * FROM user_oauth_connectors WHERE provider = ? AND provider_user_id = ?",
        [$provider, $providerUserId]
    );

    $isPrimaryInt = $isPrimaryAvatar ? 1 : 0;

    if ($existing) {
        if ($existing['user_uuid'] === $userUuid) {
            return oauthExecute(
                "UPDATE user_oauth_connectors SET provider_email = ?, provider_avatar_url = ?, is_primary_avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_user_id = ?",
                [$providerEmail, $providerAvatarUrl, $isPrimaryInt, $provider, $providerUserId]
            );
        }
        return false;
    }

    $connectors = getUserOAuthConnectors($userUuid);
    if (empty($connectors)) {
        $isPrimaryInt = 1;
    }

    return oauthExecute(
        "INSERT INTO user_oauth_connectors (user_uuid, provider, provider_user_id, provider_email, provider_avatar_url, is_primary_avatar) VALUES (?, ?, ?, ?, ?, ?)",
        [$userUuid, $provider, $providerUserId, $providerEmail, $providerAvatarUrl, $isPrimaryInt]
    );
}

/**
 * Привязать OAuth к существующему пользователю
 */
function linkOAuthConnectorToUser($userUuid, $provider, $providerUserId, $providerEmail = null, $providerAvatarUrl = null, $setAsPrimary = false) {
    $connectors = getUserOAuthConnectors($userUuid);
    if (empty($connectors)) {
        $setAsPrimary = true;
    }
    $result = createOrUpdateOAuthConnector($userUuid, $provider, $providerUserId, $providerEmail, $providerAvatarUrl, $setAsPrimary);
    if ($setAsPrimary && $providerAvatarUrl) {
        oauthExecute("UPDATE users SET avatar = ? WHERE uuid = ?", [$providerAvatarUrl, $userUuid]);
    }
    return $result;
}

/**
 * Удалить OAuth-коннектор по id (только если принадлежит пользователю)
 * Нельзя отвязать последний способ входа: должен остаться пароль или хотя бы один коннектор.
 */
function removeOAuthConnector($connectorId, $userUuid) {
    $row = oauthFetchOne("SELECT id, user_uuid FROM user_oauth_connectors WHERE id = ? AND user_uuid = ?", [$connectorId, $userUuid]);
    if (!$row) {
        return false;
    }
    $connectors = getUserOAuthConnectors($userUuid);
    if (count($connectors) <= 1) {
        $user = oauthFetchOne("SELECT password_hash FROM users WHERE uuid = ?", [$userUuid]);
        if (!$user || empty($user['password_hash'])) {
            return false; // последний способ входа — отвязка запрещена
        }
    }
    return oauthExecute("DELETE FROM user_oauth_connectors WHERE id = ? AND user_uuid = ?", [$connectorId, $userUuid]);
}

/**
 * Основной коннектор для аватарки
 */
function getPrimaryAvatarConnector($userUuid) {
    return oauthFetchOne(
        "SELECT * FROM user_oauth_connectors WHERE user_uuid = ? AND is_primary_avatar = 1 LIMIT 1",
        [$userUuid]
    );
}

/**
 * Найти пользователя по email (по коннекторам или по username из email)
 */
function findUserByEmail($email) {
    if (empty($email) || strpos($email, '@') === false) {
        return null;
    }
    $part = explode('@', $email)[0];
    $user = oauthFetchOne("SELECT * FROM users WHERE username = ?", [$part]);
    if ($user) {
        return $user;
    }
    return oauthFetchOne(
        "SELECT u.* FROM users u JOIN user_oauth_connectors uoc ON u.uuid = uoc.user_uuid WHERE uoc.provider_email = ?",
        [$email]
    );
}

function generateLoginFromEmail($email) {
    if (empty($email) || strpos($email, '@') === false) {
        return null;
    }
    return explode('@', $email)[0];
}

/**
 * Уникальное имя пользователя (username в мессенджере, поддержка UTF-8)
 */
function generateUniqueUsername($base, $provider, $providerUserId) {
    $username = preg_replace('/[^\p{L}\p{N}_]/u', '_', $base);
    $username = preg_replace('/_+/', '_', trim($username, '_'));
    if (mb_strlen($username, 'UTF-8') < 3) {
        $username = $provider . '_' . substr($providerUserId, 0, 8);
    }
    $baseSanitized = $username;
    $counter = 1;
    while (oauthFetchOne("SELECT uuid FROM users WHERE username = ?", [$username])) {
        $username = $baseSanitized . '_' . $counter;
        $counter++;
    }
    return $username;
}

/**
 * Создать пользователя и привязать OAuth-коннектор
 * $displayName — имя из провайдера (name/display_name), будет использовано для генерации уникального username
 */
function createUserWithOAuthConnector($displayName, $email, $provider, $providerUserId, $providerAvatarUrl = null) {
    global $pdo;
    require_once __DIR__ . '/../includes/functions.php';

    $username = generateUniqueUsername($displayName, $provider, $providerUserId);
    $uuid = generateUuid();
    $avatar = $providerAvatarUrl ?: null;

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("INSERT INTO users (uuid, username, password_hash, avatar) VALUES (?, ?, NULL, ?)");
        $stmt->execute([$uuid, $username, $avatar]);

        $stmt = $pdo->prepare(
            "INSERT INTO user_oauth_connectors (user_uuid, provider, provider_user_id, provider_email, provider_avatar_url, is_primary_avatar) VALUES (?, ?, ?, ?, ?, 1)"
        );
        $stmt->execute([$uuid, $provider, $providerUserId, $email, $providerAvatarUrl]);

        $pdo->commit();
        return $uuid;
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}
