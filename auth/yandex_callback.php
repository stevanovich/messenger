<?php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/oauth_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/includes/http_client.php';
require_once __DIR__ . '/includes/oauth_handler.php';

if (!isset($_GET['code']) || !isset($_GET['state'])) {
    redirect(BASE_URL . 'login.php?error=yandex_auth_failed');
}

// state может быть "csrf" или "csrf.standalone" (режим webapp)
$state = $_GET['state'];
$csrfPart = (strpos($state, '.') !== false) ? explode('.', $state, 2)[0] : $state;
if (!verifyCSRFToken($csrfPart)) {
    redirect(BASE_URL . 'login.php?error=csrf_error');
}

$code = $_GET['code'];

$tokenUrl = 'https://oauth.yandex.ru/token';
$tokenData = [
    'grant_type' => 'authorization_code',
    'code' => $code,
    'client_id' => YANDEX_CLIENT_ID,
    'client_secret' => YANDEX_CLIENT_SECRET,
    'redirect_uri' => YANDEX_REDIRECT_URI
];

$response = HttpClient::post($tokenUrl, $tokenData);
if (!$response) {
    redirect(BASE_URL . 'login.php?error=yandex_token_failed');
}

$tokenResult = json_decode($response['body'], true);
if (!$tokenResult || empty($tokenResult['access_token'])) {
    redirect(BASE_URL . 'login.php?error=yandex_token_failed');
}

$userInfoUrl = 'https://login.yandex.ru/info?format=json';
$userResponse = HttpClient::get($userInfoUrl, [
    'Authorization: OAuth ' . $tokenResult['access_token'],
    'Content-Type: application/json'
]);
if (!$userResponse) {
    redirect(BASE_URL . 'login.php?error=yandex_user_failed');
}

$userInfo = json_decode($userResponse['body'], true);
$yandexUserId = $userInfo['id'] ?? $userInfo['client_id'] ?? null;
if (!$yandexUserId) {
    redirect(BASE_URL . 'login.php?error=yandex_user_invalid');
}

$userEmail = $userInfo['default_email'] ?? ($userInfo['emails'][0] ?? null);
$avatarId = $userInfo['default_avatar_id'] ?? $userInfo['avatar_id'] ?? null;
$avatarUrl = $avatarId ? "https://avatars.yandex.net/get-yapic/{$avatarId}/islands-200" : null;

class YandexOAuthHandler extends OAuthHandler {
    protected $userInfo;

    public function __construct($userInfo, $providerUserId, $providerEmail, $providerAvatar) {
        $this->userInfo = $userInfo;
        $this->provider = 'yandex';
        $this->providerUserId = $providerUserId;
        $this->providerEmail = $providerEmail;
        $this->providerAvatar = $providerAvatar;
    }

    protected function getUsername() {
        return $this->userInfo['display_name'] ?? $this->userInfo['real_name'] ?? $this->providerEmail ?? 'yandex_user';
    }
}

$handler = new YandexOAuthHandler($userInfo, $yandexUserId, $userEmail, $avatarUrl);
$result = isLoggedIn() ? $handler->handleLoggedInUser() : $handler->handleNewUser();
redirect($result['redirect']);
