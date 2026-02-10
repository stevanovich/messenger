<?php
/**
 * Общие настройки приложения
 * Скопируйте в config.php и заполните значения
 */

// Базовый URL (измените на ваш домен). Если веб-сервер на нестандартных портах (напр. 8080/4433), укажите порт в URL.
define('BASE_URL', 'https://example.com/messenger/');

// OAuth: Google и Яндекс. Переменные окружения имеют приоритет; иначе используются значения ниже.
// В консолях OAuth добавьте Redirect URI с тем же хостом и портом, что в BASE_URL (напр. .../messenger/auth/google_callback.php).
define('GOOGLE_CLIENT_ID', getenv('GOOGLE_CLIENT_ID') ?: 'your_google_client_id.apps.googleusercontent.com');
define('GOOGLE_CLIENT_SECRET', getenv('GOOGLE_CLIENT_SECRET') ?: 'your_google_client_secret');
define('GOOGLE_REDIRECT_URI', BASE_URL . 'auth/google_callback.php');

define('YANDEX_CLIENT_ID', getenv('YANDEX_CLIENT_ID') ?: 'your_yandex_client_id');
define('YANDEX_CLIENT_SECRET', getenv('YANDEX_CLIENT_SECRET') ?: 'your_yandex_client_secret');
define('YANDEX_REDIRECT_URI', BASE_URL . 'auth/yandex_callback.php');

// Админ-панель (поддиректория). Должен совпадать с хостом/портом BASE_URL.
define('ADMIN_URL', 'https://example.com/messenger/admin/');

// Пути
define('ROOT_PATH', __DIR__ . '/../');
define('UPLOAD_PATH', ROOT_PATH . 'uploads/');
define('UPLOAD_URL', BASE_URL . 'uploads/');

// Настройки загрузки файлов
define('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10 MB
define('MAX_AVATAR_SIZE', 2 * 1024 * 1024); // 2 MB для аватаров
define('ALLOWED_IMAGE_TYPES', ['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
// Стикеры: PNG, GIF, WebP, SVG, MP4 (анимированные стикеры)
define('ALLOWED_STICKER_TYPES', ['image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4']);
// Видео для вложений
define('ALLOWED_VIDEO_TYPES', ['video/mp4', 'video/webm']);
define('ALLOWED_DOCUMENT_TYPES', [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
]);
// Документы + видео для вложений в чат
define('ALLOWED_ATTACH_TYPES', array_merge(ALLOWED_DOCUMENT_TYPES, ALLOWED_VIDEO_TYPES));

// Настройки сессий
define('SESSION_LIFETIME', 86400); // 24 часа
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Polling интервал (в миллисекундах)
define('POLLING_INTERVAL', 2000); // 2 секунды

// WebSocket-сервер (websocket/server.php)
define('WEBSOCKET_HOST', '0.0.0.0');
define('WEBSOCKET_PORT', 8081);
// Порт для HTTP-хука: PHP отправляет сюда события (message.new, reaction.update) — только localhost
define('WEBSOCKET_EVENT_PORT', 8082);
// URL для клиента (прокси должен направлять /ws на WEBSOCKET_PORT)
define('WEBSOCKET_WS_URL', 'wss://example.com:8443/');
// Путь к PHP с pdo_mysql для запуска WebSocket. Пусто = попытка через websocket/start.sh без явного пути.
define('WEBSOCKET_PHP_PATH', '');
// Пользователь, под которым запускаются start/stop/restart (http, www-data, sc-web). Пусто = без переключения.
define('WEBSOCKET_RUN_AS_USER', '');

// Админы (UUID через запятую). Узнать UUID: войдите в аккаунт и откройте /api/auth.php?action=me
define('ADMIN_UUIDS', '');

// Web Push (браузерные уведомления). Ключи VAPID — сгенерировать через tools/generate_vapid_keys.php
define('PUSH_VAPID_PUBLIC_KEY', getenv('PUSH_VAPID_PUBLIC_KEY') ?: '');
define('PUSH_VAPID_PRIVATE_KEY', getenv('PUSH_VAPID_PRIVATE_KEY') ?: '');
define('PUSH_DEBUG', getenv('PUSH_DEBUG') ? (bool) getenv('PUSH_DEBUG') : false);

// --- Звонки (SIP / WebRTC). При пустом SIP_WS_URL используется режим «только WebRTC». ---
define('SIP_WS_URL', getenv('SIP_WS_URL') ?: '');
define('SIP_DOMAIN', getenv('SIP_DOMAIN') ?: '');
define('SIP_STUN_URL', getenv('SIP_STUN_URL') ?: 'stun:stun.l.google.com:19302');
define('SIP_TURN_URL', getenv('SIP_TURN_URL') ?: '');
define('SIP_TURN_USER', getenv('SIP_TURN_USER') ?: '');
define('SIP_TURN_CREDENTIAL', getenv('SIP_TURN_CREDENTIAL') ?: '');

// Таймзона
date_default_timezone_set('Europe/Moscow');

// Включение отображения ошибок (отключить в продакшене)
$isApiRequest = !empty($_SERVER['REQUEST_URI']) && strpos($_SERVER['REQUEST_URI'], '/api/') !== false;
ini_set('display_errors', $isApiRequest ? 0 : 1);
error_reporting(E_ALL);
