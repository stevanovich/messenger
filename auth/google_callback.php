<?php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/oauth_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/includes/http_client.php';
require_once __DIR__ . '/includes/oauth_handler.php';

if (!isset($_GET['code']) || !isset($_GET['state'])) {
    redirect(BASE_URL . 'login.php?error=google_auth_failed');
}

// state может быть "csrf" или "csrf.standalone" (режим webapp)
$state = $_GET['state'];
$csrfPart = (strpos($state, '.') !== false) ? explode('.', $state, 2)[0] : $state;
if (!verifyCSRFToken($csrfPart)) {
    redirect(BASE_URL . 'login.php?error=csrf_error');
}

$code = $_GET['code'];

$tokenUrl = 'https://oauth2.googleapis.com/token';
$tokenData = [
    'client_id' => GOOGLE_CLIENT_ID,
    'client_secret' => GOOGLE_CLIENT_SECRET,
    'code' => $code,
    'grant_type' => 'authorization_code',
    'redirect_uri' => GOOGLE_REDIRECT_URI
];

$response = HttpClient::post($tokenUrl, $tokenData);
if (!$response) {
    redirect(BASE_URL . 'login.php?error=google_token_failed');
}

$tokenResult = json_decode($response['body'], true);
if (!$tokenResult || empty($tokenResult['access_token'])) {
    redirect(BASE_URL . 'login.php?error=google_token_failed');
}

$userInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo?access_token=' . $tokenResult['access_token'];
$userResponse = HttpClient::get($userInfoUrl);
if (!$userResponse) {
    redirect(BASE_URL . 'login.php?error=google_user_failed');
}

$userInfo = json_decode($userResponse['body'], true);
if (!$userInfo || empty($userInfo['id'])) {
    redirect(BASE_URL . 'login.php?error=google_user_invalid');
}

class GoogleOAuthHandler extends OAuthHandler {
    protected $userInfo;

    public function __construct($userInfo) {
        $this->userInfo = $userInfo;
        $this->provider = 'google';
        $this->providerUserId = $userInfo['id'];
        $this->providerEmail = $userInfo['email'] ?? null;
        $this->providerAvatar = $userInfo['picture'] ?? null;
    }

    protected function getUsername() {
        return $this->userInfo['name'] ?? $this->providerEmail ?? 'google_user';
    }
}

$handler = new GoogleOAuthHandler($userInfo);
$result = isLoggedIn() ? $handler->handleLoggedInUser() : $handler->handleNewUser();
redirect($result['redirect']);
