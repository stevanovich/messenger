<?php
session_start();
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/locale.php';
initLocale();

if (isLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
$success = '';

// Сообщения об ошибках OAuth (ключи для t())
$oauthErrorKeys = [
    'google_auth_failed', 'google_token_failed', 'google_user_failed', 'google_user_invalid', 'google_create_failed',
    'yandex_auth_failed', 'yandex_token_failed', 'yandex_user_failed', 'yandex_user_invalid', 'yandex_create_failed',
    'csrf_error', 'oauth_not_configured', 'connector_linked_to_other', 'connector_failed', 'auth_failed',
    'google_user_not_found', 'yandex_user_not_found',
];
if (!empty($_GET['error']) && in_array($_GET['error'], $oauthErrorKeys, true)) {
    $error = t('oauth.' . $_GET['error']);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    
    if (empty($username) || empty($password)) {
        $error = t('login.fill_all');
    } else {
        global $pdo;
        $stmt = $pdo->prepare("SELECT uuid, username, password_hash FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        
        if ($user) {
            if (empty($user['password_hash'])) {
                $error = t('login.oauth_only');
            } elseif (verifyPassword($password, $user['password_hash'])) {
                $_SESSION['user_uuid'] = $user['uuid'];
                $_SESSION['username'] = $user['username'];
                $stmt = $pdo->prepare("UPDATE users SET last_seen = NOW() WHERE uuid = ?");
                $stmt->execute([$user['uuid']]);
                $redirect = isset($_GET['redirect']) ? trim((string) $_GET['redirect']) : '';
                if ($redirect !== '') {
                    if (strpos($redirect, 'http') !== 0) {
                        $redirect = rtrim(BASE_URL, '/') . '/' . ltrim($redirect, '/');
                    }
                    $base = rtrim(BASE_URL, '/');
                    if (strpos($redirect, $base) === 0) {
                        header('Location: ' . $redirect);
                        exit;
                    }
                }
                header('Location: index.php');
                exit;
            } else {
                $error = t('login.bad_credentials');
            }
        } else {
            $error = t('login.bad_credentials');
        }
    }
}

$pageTitle = t('login.title');
include __DIR__ . '/includes/header.php';
?>

<div class="auth-container">
    <div class="auth-box">
        <p class="auth-lang-selector">
            <span class="auth-lang-label"><?php echo escape(t('common.language')); ?>:</span>
            <a href="login.php?lang=ru<?php echo !empty($_GET['redirect']) ? '&redirect=' . escape(urlencode($_GET['redirect'])) : ''; ?>" class="auth-lang-link<?php echo getLocale() === 'ru' ? ' active' : ''; ?>">Русский</a>
            <a href="login.php?lang=en<?php echo !empty($_GET['redirect']) ? '&redirect=' . escape(urlencode($_GET['redirect'])) : ''; ?>" class="auth-lang-link<?php echo getLocale() === 'en' ? ' active' : ''; ?>">English</a>
            <a href="login.php?lang=sr<?php echo !empty($_GET['redirect']) ? '&redirect=' . escape(urlencode($_GET['redirect'])) : ''; ?>" class="auth-lang-link<?php echo getLocale() === 'sr' ? ' active' : ''; ?>">Српски</a>
        </p>
        <h1><?php echo escape(t('login.heading')); ?></h1>
        
        <?php if ($error): ?>
            <div class="alert alert-error"><?php echo escape($error); ?></div>
        <?php endif; ?>
        
        <?php if ($success): ?>
            <div class="alert alert-success"><?php echo escape($success); ?></div>
        <?php endif; ?>
        
        <form method="POST" action="login.php<?php if (!empty($_GET['redirect'])) echo '?redirect=' . escape(urlencode($_GET['redirect'])); ?>">
            <div class="form-group">
                <label for="username"><?php echo escape(t('login.username')); ?></label>
                <input 
                    type="text" 
                    id="username" 
                    name="username" 
                    required 
                    autofocus
                    value="<?php echo escape($_POST['username'] ?? ''); ?>"
                >
            </div>
            
            <div class="form-group">
                <label for="password"><?php echo escape(t('login.password')); ?></label>
                <input 
                    type="password" 
                    id="password" 
                    name="password" 
                    required
                >
            </div>
            
            <button type="submit" class="btn btn-primary"><?php echo escape(t('login.submit')); ?></button>
        </form>
        
        <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
        <div class="auth-oauth">
            <span class="auth-oauth-divider"><?php echo escape(t('login.oauth_or')); ?></span>
            <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
            <a href="<?php echo BASE_URL; ?>auth/google.php" class="btn btn-oauth btn-oauth-google"><img src="<?php echo BASE_URL; ?>assets/img/oauth-google.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?php echo escape(t('login.google')); ?></a>
            <?php endif; ?>
            <?php if (!empty(YANDEX_CLIENT_ID)): ?>
            <a href="<?php echo BASE_URL; ?>auth/yandex.php" class="btn btn-oauth btn-oauth-yandex"><img src="<?php echo BASE_URL; ?>assets/img/oauth-yandex.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?php echo escape(t('login.yandex')); ?></a>
            <?php endif; ?>
        </div>
        <?php endif; ?>
        
        <p class="auth-link">
            <?php echo escape(t('login.no_account')); ?> <a href="register.php"><?php echo escape(t('login.register_link')); ?></a>
        </p>
        <p class="auth-link auth-doc-link">
            <a href="<?php echo escape(BASE_URL); ?>documentation.php"><?php echo escape(t('common.documentation')); ?></a>
        </p>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
