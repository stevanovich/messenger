<?php
session_start();
require_once __DIR__ . '/includes/functions.php';

if (isLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
$success = '';

// Сообщения об ошибках OAuth
$oauthErrors = [
    'google_auth_failed' => 'Вход через Google был отменён или завершился с ошибкой.',
    'google_token_failed' => 'Не удалось получить токен Google. Попробуйте снова.',
    'google_user_failed' => 'Не удалось получить данные профиля Google.',
    'google_user_invalid' => 'Некорректный ответ от Google.',
    'google_create_failed' => 'Не удалось создать аккаунт. Попробуйте позже.',
    'yandex_auth_failed' => 'Вход через Яндекс был отменён или завершился с ошибкой.',
    'yandex_token_failed' => 'Не удалось получить токен Яндекс. Попробуйте снова.',
    'yandex_user_failed' => 'Не удалось получить данные профиля Яндекс.',
    'yandex_user_invalid' => 'Некорректный ответ от Яндекса.',
    'yandex_create_failed' => 'Не удалось создать аккаунт. Попробуйте позже.',
    'csrf_error' => 'Ошибка проверки безопасности. Обновите страницу и попробуйте снова.',
    'oauth_not_configured' => 'OAuth не настроен на сервере.',
    'connector_linked_to_other' => 'Этот аккаунт Google/Яндекс уже привязан к другому пользователю.',
    'connector_failed' => 'Не удалось привязать аккаунт.',
    'auth_failed' => 'Ошибка авторизации.',
    'google_user_not_found' => 'Пользователь не найден после входа через Google.',
    'yandex_user_not_found' => 'Пользователь не найден после входа через Яндекс.',
];
if (!empty($_GET['error']) && isset($oauthErrors[$_GET['error']])) {
    $error = $oauthErrors[$_GET['error']];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    
    if (empty($username) || empty($password)) {
        $error = 'Заполните все поля';
    } else {
        global $pdo;
        $stmt = $pdo->prepare("SELECT uuid, username, password_hash FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        
        if ($user) {
            if (empty($user['password_hash'])) {
                $error = 'Этот аккаунт доступен только через вход Google или Яндекс. Используйте кнопки ниже.';
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
                $error = 'Неверное имя пользователя или пароль';
            }
        } else {
            $error = 'Неверное имя пользователя или пароль';
        }
    }
}

$pageTitle = 'Вход';
include __DIR__ . '/includes/header.php';
?>

<div class="auth-container">
    <div class="auth-box">
        <h1>Вход в мессенджер</h1>
        
        <?php if ($error): ?>
            <div class="alert alert-error"><?php echo escape($error); ?></div>
        <?php endif; ?>
        
        <?php if ($success): ?>
            <div class="alert alert-success"><?php echo escape($success); ?></div>
        <?php endif; ?>
        
        <form method="POST" action="login.php<?php if (!empty($_GET['redirect'])) echo '?redirect=' . escape(urlencode($_GET['redirect'])); ?>">
            <div class="form-group">
                <label for="username">Имя пользователя</label>
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
                <label for="password">Пароль</label>
                <input 
                    type="password" 
                    id="password" 
                    name="password" 
                    required
                >
            </div>
            
            <button type="submit" class="btn btn-primary">Войти</button>
        </form>
        
        <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
        <div class="auth-oauth">
            <span class="auth-oauth-divider">или</span>
            <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
            <a href="<?php echo BASE_URL; ?>auth/google.php" class="btn btn-oauth btn-oauth-google">Войти через Google</a>
            <?php endif; ?>
            <?php if (!empty(YANDEX_CLIENT_ID)): ?>
            <a href="<?php echo BASE_URL; ?>auth/yandex.php" class="btn btn-oauth btn-oauth-yandex">Войти через Яндекс</a>
            <?php endif; ?>
        </div>
        <?php endif; ?>
        
        <p class="auth-link">
            Нет аккаунта? <a href="register.php">Зарегистрироваться</a>
        </p>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
