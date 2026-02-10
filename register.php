<?php
// Временная отладка
if (isset($_GET['debug'])) {
    ini_set('display_errors', 1);
    error_reporting(E_ALL);
}

session_start();
require_once __DIR__ . '/includes/functions.php';

if (isLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
$success = '';

// Ошибки OAuth (те же коды, что и на login)
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
];
if (!empty($_GET['error']) && isset($oauthErrors[$_GET['error']])) {
    $error = $oauthErrors[$_GET['error']];
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
        $error = 'Пароли не совпадают';
    } else {
        $passwordValidation = validatePassword($password);
        if (!$passwordValidation['valid']) {
            $error = $passwordValidation['error'];
        } else {
            global $pdo;
            
            // Проверка существования пользователя
            $stmt = $pdo->prepare("SELECT uuid FROM users WHERE username = ?");
            $stmt->execute([$username]);
            if ($stmt->fetch()) {
                $error = 'Пользователь с таким именем уже существует';
            } else {
                // Создание пользователя
                $uuid = generateUuid();
                $passwordHash = hashPassword($password);
                $stmt = $pdo->prepare("INSERT INTO users (uuid, username, password_hash) VALUES (?, ?, ?)");
                if ($stmt->execute([$uuid, $username, $passwordHash])) {
                    $success = 'Регистрация успешна! Теперь вы можете войти.';
                } else {
                    $error = 'Ошибка при регистрации. Попробуйте позже.';
                }
            }
        }
    }
}

$pageTitle = 'Регистрация';
include __DIR__ . '/includes/header.php';
?>

<div class="auth-container">
    <div class="auth-box">
        <h1>Регистрация</h1>
        
        <?php if ($error): ?>
            <div class="alert alert-error"><?php echo escape($error); ?></div>
        <?php endif; ?>
        
        <?php if ($success): ?>
            <div class="alert alert-success"><?php echo escape($success); ?></div>
            <p class="auth-link">
                <a href="login.php">Перейти к входу</a>
            </p>
        <?php else: ?>
            <form method="POST" action="register.php">
                <div class="form-group">
                    <label for="username">Имя пользователя</label>
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
                    <small>Буквы (в т.ч. кириллица), цифры и подчёркивание, 3–50 символов</small>
                </div>
                
                <div class="form-group">
                    <label for="password">Пароль</label>
                    <input 
                        type="password" 
                        id="password" 
                        name="password" 
                        required
                        minlength="6"
                    >
                    <small>Минимум 6 символов</small>
                </div>
                
                <div class="form-group">
                    <label for="password_confirm">Подтвердите пароль</label>
                    <input 
                        type="password" 
                        id="password_confirm" 
                        name="password_confirm" 
                        required
                        minlength="6"
                    >
                </div>
                
                <button type="submit" class="btn btn-primary">Зарегистрироваться</button>
            </form>
            
            <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
            <div class="auth-oauth">
                <span class="auth-oauth-divider">или</span>
                <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
                <a href="<?php echo BASE_URL; ?>auth/google.php" class="btn btn-oauth btn-oauth-google">Зарегистрироваться через Google</a>
                <?php endif; ?>
                <?php if (!empty(YANDEX_CLIENT_ID)): ?>
                <a href="<?php echo BASE_URL; ?>auth/yandex.php" class="btn btn-oauth btn-oauth-yandex">Зарегистрироваться через Яндекс</a>
                <?php endif; ?>
            </div>
            <?php endif; ?>
            
            <p class="auth-link">
                Уже есть аккаунт? <a href="login.php">Войти</a>
            </p>
        <?php endif; ?>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
