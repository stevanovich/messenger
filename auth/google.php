<?php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

if (empty(GOOGLE_CLIENT_ID)) {
    header('Location: ' . BASE_URL . 'login.php?error=oauth_not_configured');
    exit;
}

$isStandalone = isset($_GET['display']) && $_GET['display'] === 'standalone';
$csrfToken = generateCSRFToken();
$state = $isStandalone ? $csrfToken . '.standalone' : $csrfToken;

$authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
    'client_id' => GOOGLE_CLIENT_ID,
    'redirect_uri' => GOOGLE_REDIRECT_URI,
    'scope' => 'openid email profile',
    'response_type' => 'code',
    'state' => $state
]);

if ($isStandalone) {
    // Редирект через JS, чтобы цепочка OAuth оставалась в webapp (тот же webview)
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Переход к Google</title></head><body>';
    echo '<script>window.location.replace(' . json_encode($authUrl) . ');</script>';
    echo '<p>Переход к входу через Google…</p></body></html>';
    exit;
}

header('Location: ' . $authUrl);
exit;
