<?php
// Временная отладка
if (isset($_GET['debug'])) {
    ini_set('display_errors', 1);
    error_reporting(E_ALL);
}

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

$oauthErrorKeys = [
    'google_auth_failed', 'google_token_failed', 'google_user_failed', 'google_user_invalid', 'google_create_failed',
    'yandex_auth_failed', 'yandex_token_failed', 'yandex_user_failed', 'yandex_user_invalid', 'yandex_create_failed',
    'csrf_error', 'oauth_not_configured', 'connector_linked_to_other', 'connector_failed', 'auth_failed',
];
if (!empty($_GET['error']) && in_array($_GET['error'], $oauthErrorKeys, true)) {
    $error = t('oauth.' . $_GET['error']);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    $passwordConfirm = $_POST['password_confirm'] ?? '';
    
    // Валидация
    $usernameValidation = validateUsername($username);
    if (!$usernameValidation['valid']) {
        $error = $usernameValidation['error'];
    } elseif ($password !== $passwordConfirm) {
        $error = t('register.passwords_mismatch');
    } else {
        $passwordValidation = validatePassword($password);
        if (!$passwordValidation['valid']) {
            $error = $passwordValidation['error']; // already translated in validatePassword or use key
        } else {
            global $pdo;
            
            // Проверка существования пользователя
            $stmt = $pdo->prepare("SELECT uuid FROM users WHERE username = ?");
            $stmt->execute([$username]);
            if ($stmt->fetch()) {
                $error = t('register.username_exists');
            } else {
                // Создание пользователя
                $uuid = generateUuid();
                $passwordHash = hashPassword($password);
                $stmt = $pdo->prepare("INSERT INTO users (uuid, username, password_hash) VALUES (?, ?, ?)");
                if ($stmt->execute([$uuid, $username, $passwordHash])) {
                    $success = t('register.success');
                } else {
                    $error = t('register.reg_error');
                }
            }
        }
    }
}

$pageTitle = t('register.title');
include __DIR__ . '/includes/header.php';
?>

<div class="auth-container">
    <div class="auth-box">
        <p class="auth-lang-selector">
            <span class="auth-lang-label"><?php echo escape(t('common.language')); ?>:</span>
            <a href="register.php?lang=ru" class="auth-lang-link<?php echo getLocale() === 'ru' ? ' active' : ''; ?>">Русский</a>
            <a href="register.php?lang=en" class="auth-lang-link<?php echo getLocale() === 'en' ? ' active' : ''; ?>">English</a>
            <a href="register.php?lang=sr" class="auth-lang-link<?php echo getLocale() === 'sr' ? ' active' : ''; ?>">Српски</a>
        </p>
        <h1><?php echo escape(t('register.heading')); ?></h1>
        
        <?php if ($error): ?>
            <div class="alert alert-error"><?php echo escape($error); ?></div>
        <?php endif; ?>
        
        <?php if ($success): ?>
            <div class="alert alert-success"><?php echo escape($success); ?></div>
            <p class="auth-link">
                <a href="login.php"><?php echo escape(t('register.go_login')); ?></a>
            </p>
        <?php else: ?>
            <form method="POST" action="register.php">
                <div class="form-group">
                    <label for="username"><?php echo escape(t('register.username')); ?></label>
                    <input 
                        type="text" 
                        id="username" 
                        name="username" 
                        required 
                        autofocus
                        autocomplete="username"
                        title="Буквы (любого языка), цифры и подчеркивание (3-50 символов)"
                        value="<?php echo escape($_POST['username'] ?? ''); ?>"
                    >
                    <small><?php echo escape(t('register.username_hint')); ?></small>
                </div>
                
                <div class="form-group">
                    <label for="password"><?php echo escape(t('register.password')); ?></label>
                    <input 
                        type="password" 
                        id="password" 
                        name="password" 
                        required
                        minlength="6"
                    >
                    <small><?php echo escape(t('register.password_hint')); ?></small>
                </div>
                
                <div class="form-group">
                    <label for="password_confirm"><?php echo escape(t('register.confirm_password')); ?></label>
                    <input 
                        type="password" 
                        id="password_confirm" 
                        name="password_confirm" 
                        required
                        minlength="6"
                    >
                </div>
                
                <button type="submit" class="btn btn-primary"><?php echo escape(t('register.submit')); ?></button>
            </form>
            
            <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
            <div class="auth-oauth">
                <span class="auth-oauth-divider"><?php echo escape(t('register.oauth_or')); ?></span>
                <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
                <a href="<?php echo BASE_URL; ?>auth/google.php" class="btn btn-oauth btn-oauth-google"><img src="<?php echo BASE_URL; ?>assets/img/oauth-google.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?php echo escape(t('register.google')); ?></a>
                <?php endif; ?>
                <?php if (!empty(YANDEX_CLIENT_ID)): ?>
                <a href="<?php echo BASE_URL; ?>auth/yandex.php" class="btn btn-oauth btn-oauth-yandex"><img src="<?php echo BASE_URL; ?>assets/img/oauth-yandex.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?php echo escape(t('register.yandex')); ?></a>
                <?php endif; ?>
            </div>
            <?php endif; ?>
            
            <p class="auth-link">
                <?php echo escape(t('register.have_account')); ?> <a href="login.php"><?php echo escape(t('register.login_link')); ?></a>
            </p>
        <?php endif; ?>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
