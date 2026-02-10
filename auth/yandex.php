<?php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

if (empty(YANDEX_CLIENT_ID)) {
    header('Location: ' . BASE_URL . 'login.php?error=oauth_not_configured');
    exit;
}

$isStandalone = isset($_GET['display']) && $_GET['display'] === 'standalone';
$csrfToken = generateCSRFToken();
$state = $isStandalone ? $csrfToken . '.standalone' : $csrfToken;

$authUrl = 'https://oauth.yandex.ru/authorize?' . http_build_query([
    'response_type' => 'code',
    'client_id' => YANDEX_CLIENT_ID,
    'redirect_uri' => YANDEX_REDIRECT_URI,
    'scope' => 'login:email login:info',
    'state' => $state
]);

if ($isStandalone) {
    // Редирект через JS, чтобы цепочка OAuth оставалась в webapp (тот же webview)
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Переход к Яндексу</title></head><body>';
    echo '<script>window.location.replace(' . json_encode($authUrl) . ');</script>';
    echo '<p>Переход к входу через Яндекс…</p></body></html>';
    exit;
}

header('Location: ' . $authUrl);
exit;
