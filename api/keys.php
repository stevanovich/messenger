<?php
/**
 * API публичных ключей пользователей (E2EE — этап 1).
 * GET: получить публичный ключ пользователя (своего или по user_uuid).
 * POST: сохранить свой публичный ключ.
 * Этап 4: key_backup (GET/POST), decryption_failed (POST), limits (GET).
 */
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}

updateLastSeenIfNeeded();

$method = $_SERVER['REQUEST_METHOD'];
global $pdo;

/** Загрузка настроек защиты ключей (этап 4) */
function getKeyBackupConfig() {
    $path = __DIR__ . '/../config/e2ee_key_backup.php';
    if (!is_file($path)) {
        $path = __DIR__ . '/../config/e2ee_key_backup.example.php';
    }
    if (!is_file($path)) {
        return [
            'rate_limit_per_hour' => 10,
            'failures_before_lockout' => 5,
            'lockout_hours' => 24,
            'client_delay_base_sec' => 2,
            'client_delay_max_sec' => 300,
            'kdf_iterations' => 100000,
        ];
    }
    $cfg = include $path;
    return is_array($cfg) ? array_merge([
        'rate_limit_per_hour' => 10,
        'failures_before_lockout' => 5,
        'lockout_hours' => 24,
        'client_delay_base_sec' => 2,
        'client_delay_max_sec' => 300,
        'kdf_iterations' => 100000,
    ], $cfg) : [];
}

try {
    if ($method === 'GET') {
        $action = $_GET['action'] ?? '';
        if ($action === 'limits') {
            $cfg = getKeyBackupConfig();
            jsonSuccess([
                'client_delay_base_sec' => (int) ($cfg['client_delay_base_sec'] ?? 2),
                'client_delay_max_sec' => (int) ($cfg['client_delay_max_sec'] ?? 300),
                'kdf_iterations' => (int) ($cfg['kdf_iterations'] ?? 100000),
            ]);
            exit;
        }
        if ($action === 'key_backup') {
            $cfg = getKeyBackupConfig();
            $currentUserUuid = getCurrentUserUuid();
            $stmt = $pdo->prepare("SELECT key_blob, fail_count, locked_until, get_count, get_count_reset_at FROM user_key_backup WHERE user_uuid = ?");
            $stmt->execute([$currentUserUuid]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row && $row['locked_until'] !== null && strtotime($row['locked_until']) > time()) {
                jsonError('Попытки восстановления временно заблокированы. Попробуйте позже.', 429);
            }
            $rateLimit = (int) ($cfg['rate_limit_per_hour'] ?? 10);
            $now = date('Y-m-d H:i:s');
            $windowStart = date('Y-m-d H:i:s', time() - 3600);
            if ($row) {
                $resetAt = $row['get_count_reset_at'];
                $getCount = (int) $row['get_count'];
                if ($resetAt === null || $resetAt < $windowStart) {
                    $getCount = 1;
                    $resetAt = $now;
                } else {
                    $getCount++;
                }
                if ($getCount > $rateLimit) {
                    jsonError('Превышен лимит запросов восстановления в час. Попробуйте позже.', 429);
                }
                $stmt = $pdo->prepare("UPDATE user_key_backup SET get_count = ?, get_count_reset_at = ? WHERE user_uuid = ?");
                $stmt->execute([$getCount, $resetAt, $currentUserUuid]);
            } else {
                $stmt = $pdo->prepare("INSERT INTO user_key_backup (user_uuid, get_count, get_count_reset_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE get_count = LEAST(get_count + 1, 999), get_count_reset_at = CASE WHEN get_count_reset_at IS NULL OR get_count_reset_at < ? THEN ? ELSE get_count_reset_at END");
                $stmt->execute([$currentUserUuid, $now, $windowStart, $now]);
            }
            $blob = $row && $row['key_blob'] !== null && $row['key_blob'] !== '' ? $row['key_blob'] : null;
            jsonSuccess(['key_blob' => $blob, 'has_backup' => $blob !== null]);
            exit;
        }
        if ($action === 'group_key') {
            $conversationId = (int)($_GET['conversation_id'] ?? 0);
            if ($conversationId <= 0) {
                jsonError('Укажите conversation_id', 400);
            }
            $currentUserUuid = getCurrentUserUuid();
            $stmt = $pdo->prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к беседе', 403);
            }
            $stmt = $pdo->prepare("SELECT key_blob, encrypted_by_uuid FROM conversation_member_keys WHERE conversation_id = ? AND user_uuid = ?");
            $stmt->execute([$conversationId, $currentUserUuid]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                jsonSuccess(['key_blob' => null, 'encrypted_by_uuid' => null]);
                exit;
            }
            jsonSuccess(['key_blob' => $row['key_blob'], 'encrypted_by_uuid' => $row['encrypted_by_uuid']]);
            exit;
        }
        $userUuid = trim($_GET['user_uuid'] ?? '');
        if ($userUuid === '') {
            $userUuid = getCurrentUserUuid();
        }
        $stmt = $pdo->prepare("
            SELECT user_uuid, public_key_jwk, algorithm, updated_at
            FROM user_public_keys
            WHERE user_uuid = ?
        ");
        $stmt->execute([$userUuid]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            jsonSuccess(['public_key' => null, 'algorithm' => null, 'updated_at' => null]);
            exit;
        }
        $jwk = @json_decode($row['public_key_jwk'], true);
        if ($jwk === null && $row['public_key_jwk'] !== '') {
            $jwk = $row['public_key_jwk'];
        }
        jsonSuccess([
            'user_uuid' => $row['user_uuid'],
            'public_key' => $jwk,
            'algorithm' => $row['algorithm'],
            'updated_at' => $row['updated_at'],
        ]);
        exit;
    }

    if ($method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $action = $data['action'] ?? $_GET['action'] ?? '';

        if ($action === 'save_key_backup') {
            $keyBlob = $data['key_blob'] ?? '';
            if (strlen($keyBlob) > 65535) {
                jsonError('key_blob слишком большой', 400);
            }
            $currentUserUuid = getCurrentUserUuid();
            $stmt = $pdo->prepare("INSERT INTO user_key_backup (user_uuid, key_blob, updated_at, fail_count, locked_until) VALUES (?, ?, NOW(), 0, NULL) ON DUPLICATE KEY UPDATE key_blob = VALUES(key_blob), updated_at = NOW(), fail_count = 0, locked_until = NULL");
            $stmt->execute([$currentUserUuid, $keyBlob === '' ? null : $keyBlob]);
            jsonSuccess(['ok' => true], 'Резервная копия ключей сохранена');
            exit;
        }
        if ($action === 'decryption_failed') {
            $cfg = getKeyBackupConfig();
            $currentUserUuid = getCurrentUserUuid();
            $stmt = $pdo->prepare("SELECT fail_count, locked_until FROM user_key_backup WHERE user_uuid = ?");
            $stmt->execute([$currentUserUuid]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $failCount = $row ? (int) $row['fail_count'] : 0;
            $failCount++;
            $lockoutHours = (int) ($cfg['lockout_hours'] ?? 24);
            $k = (int) ($cfg['failures_before_lockout'] ?? 5);
            $lockedUntil = null;
            if ($failCount >= $k) {
                $lockedUntil = date('Y-m-d H:i:s', time() + $lockoutHours * 3600);
            }
            $stmt = $pdo->prepare("INSERT INTO user_key_backup (user_uuid, fail_count, locked_until) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE fail_count = ?, locked_until = ?");
            $stmt->execute([$currentUserUuid, $failCount, $lockedUntil, $failCount, $lockedUntil]);
            jsonSuccess(['ok' => true, 'locked_until' => $lockedUntil]);
            exit;
        }
        if ($action === 'set_group_key') {
            $conversationId = (int)($data['conversation_id'] ?? 0);
            $targetUserUuid = trim((string)($data['user_uuid'] ?? ''));
            $keyBlob = $data['key_blob'] ?? '';
            if ($conversationId <= 0 || $targetUserUuid === '' || $keyBlob === '') {
                jsonError('Укажите conversation_id, user_uuid и key_blob', 400);
            }
            if (strlen($keyBlob) > 8192) {
                jsonError('key_blob слишком большой', 400);
            }
            $currentUserUuid = getCurrentUserUuid();
            $stmt = $pdo->prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_uuid = ? AND hidden_at IS NULL");
            $stmt->execute([$conversationId, $currentUserUuid]);
            if (!$stmt->fetch()) {
                jsonError('Нет доступа к беседе', 403);
            }
            $stmt = $pdo->prepare("
                INSERT INTO conversation_member_keys (conversation_id, user_uuid, encrypted_by_uuid, key_blob)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE encrypted_by_uuid = VALUES(encrypted_by_uuid), key_blob = VALUES(key_blob)
            ");
            $stmt->execute([$conversationId, $targetUserUuid, $currentUserUuid, $keyBlob]);
            jsonSuccess(['ok' => true], 'Ключ группы сохранён');
            exit;
        }

        $publicKey = $data['public_key'] ?? null;
        $algorithm = trim($data['algorithm'] ?? 'ECDH-P256');
        if ($algorithm === '') {
            $algorithm = 'ECDH-P256';
        }
        if ($publicKey === null) {
            jsonError('Не указан public_key', 400);
        }
        if (is_array($publicKey)) {
            $publicKeyJson = json_encode($publicKey, JSON_UNESCAPED_SLASHES);
        } else {
            $publicKeyJson = (string) $publicKey;
        }
        if (strlen($publicKeyJson) > 16384) {
            jsonError('public_key слишком большой', 400);
        }
        $currentUserUuid = getCurrentUserUuid();
        $stmt = $pdo->prepare("
            INSERT INTO user_public_keys (user_uuid, public_key_jwk, algorithm)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE public_key_jwk = VALUES(public_key_jwk), algorithm = VALUES(algorithm)
        ");
        $stmt->execute([$currentUserUuid, $publicKeyJson, $algorithm]);
        jsonSuccess(['ok' => true, 'algorithm' => $algorithm], 'Публичный ключ сохранён');
        exit;
    }

    jsonError('Метод не поддерживается', 405);
} catch (PDOException $e) {
    if ($e->getCode() === '42S02') {
        $msg = $e->getMessage();
        if (strpos($msg, 'user_key_backup') !== false) {
            jsonError('Таблица user_key_backup не найдена. Выполните миграцию: sql/migrations/003_add_user_key_backup.sql', 503);
        }
        if (strpos($msg, 'conversation_member_keys') !== false) {
            jsonError('Таблица conversation_member_keys не найдена. Выполните миграцию: sql/migrations/002_add_conversation_member_keys.sql', 503);
        }
        jsonError('Таблица user_public_keys не найдена. Выполните миграцию: sql/migrations/001_add_messages_encrypted_and_user_public_keys.sql', 503);
    }
    error_log('api/keys.php: ' . $e->getMessage());
    jsonError('Ошибка базы данных', 500);
}
