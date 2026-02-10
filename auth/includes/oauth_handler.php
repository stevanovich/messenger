<?php
/**
 * Общая логика OAuth для мессенджера (user_uuid, PDO)
 */
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/oauth_helpers.php';
require_once __DIR__ . '/../../includes/functions.php';

class OAuthHandler {
    protected $provider;
    protected $providerUserId;
    protected $providerEmail;
    protected $providerAvatar;

    /**
     * Уже авторизованный пользователь — привязываем коннектор
     */
    public function handleLoggedInUser() {
        $user = getCurrentUser();
        if (!$user || empty($user['uuid'])) {
            return ['success' => false, 'redirect' => '../login.php?error=auth_failed'];
        }

        $existing = getOAuthConnector($this->provider, $this->providerUserId);

        if ($existing && $existing['user_uuid'] === $user['uuid']) {
            linkOAuthConnectorToUser(
                $user['uuid'],
                $this->provider,
                $this->providerUserId,
                $this->providerEmail,
                $this->providerAvatar
            );
            return ['success' => true, 'redirect' => '../index.php'];
        }

        if ($existing) {
            return ['success' => false, 'redirect' => '../login.php?error=connector_linked_to_other'];
        }

        $linkResult = linkOAuthConnectorToUser(
            $user['uuid'],
            $this->provider,
            $this->providerUserId,
            $this->providerEmail,
            $this->providerAvatar
        );

        return [
            'success' => (bool) $linkResult,
            'redirect' => $linkResult ? '../index.php' : '../login.php?error=connector_failed'
        ];
    }

    /**
     * Новый пользователь — вход по коннектору или регистрация
     */
    public function handleNewUser() {
        $user = getOAuthConnector($this->provider, $this->providerUserId);

        if (!$user && !empty($this->providerEmail)) {
            $existingUser = findUserByEmail($this->providerEmail);
            if ($existingUser) {
                linkOAuthConnectorToUser(
                    $existingUser['uuid'],
                    $this->provider,
                    $this->providerUserId,
                    $this->providerEmail,
                    $this->providerAvatar
                );
                $user = $existingUser;
            }
        }

        if (!$user) {
            $displayName = $this->getUsername();
            try {
                $uuid = createUserWithOAuthConnector(
                    $displayName,
                    $this->providerEmail,
                    $this->provider,
                    $this->providerUserId,
                    $this->providerAvatar
                );
                $user = oauthFetchOne("SELECT * FROM users WHERE uuid = ?", [$uuid]);
            } catch (Exception $e) {
                error_log("OAuth create user: " . $e->getMessage());
                return [
                    'success' => false,
                    'redirect' => '../login.php?error=' . $this->provider . '_create_failed'
                ];
            }
        }

        $this->updateAvatarIfPrimary($user);

        if ($user && !empty($user['uuid'])) {
            $_SESSION['user_uuid'] = $user['uuid'];
            $_SESSION['username'] = $user['username'];
            oauthExecute("UPDATE users SET last_seen = NOW() WHERE uuid = ?", [$user['uuid']]);
            if (function_exists('redirect')) {
                return ['success' => true, 'redirect' => '../index.php'];
            }
            return ['success' => true, 'redirect' => '../index.php'];
        }

        return [
            'success' => false,
            'redirect' => '../login.php?error=' . $this->provider . '_user_not_found'
        ];
    }

    protected function getUsername() {
        return $this->providerEmail ?? $this->provider . '_user';
    }

    protected function updateAvatarIfPrimary($user) {
        $primary = getPrimaryAvatarConnector($user['uuid']);
        if (!$primary || $primary['provider'] !== $this->provider || $primary['provider_user_id'] !== $this->providerUserId) {
            return;
        }
        if ($this->providerAvatar && ($user['avatar'] ?? '') !== $this->providerAvatar) {
            oauthExecute("UPDATE users SET avatar = ? WHERE uuid = ?", [$this->providerAvatar, $user['uuid']]);
        }
    }
}
