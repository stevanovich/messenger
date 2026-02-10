# Чеклист для отладки проблем

## 1. Проверка базы данных

### Создание базы данных (если не создана):
```sql
CREATE DATABASE IF NOT EXISTS messenger_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Создание пользователя (если не создан):
```sql
CREATE USER 'messenger_mngr'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON messenger_db.* TO 'messenger_mngr'@'localhost';
FLUSH PRIVILEGES;
```

### Импорт схемы:
```bash
mysql -u messenger_mngr -p messenger_db < sql/schema.sql
```

### Проверка таблиц:
```sql
USE messenger_db;
SHOW TABLES;
-- Должно быть 11 таблиц:
-- users, conversations, conversation_participants, messages, 
-- message_reactions, stickers, user_stickers, analytics_events, 
-- analytics_clicks, sessions, message_reads
```

### Тест подключения:
```php
<?php
// test_db.php
require_once 'config/database.php';
echo "Connected successfully!";
$stmt = $pdo->query("SELECT 1");
var_dump($stmt->fetch());
?>
```

## 2. Проверка прав доступа

### Права на папки:
```bash
chmod 755 uploads uploads/images uploads/documents
chmod 644 config/*.php includes/*.php api/*.php *.php
```

### Права на файлы конфигурации:
```bash
# Убедиться, что файлы читаемы веб-сервером
ls -la config/
ls -la includes/
```

## 3. Проверка логов

### Логи PHP:
```bash
# Проверить, где находятся логи
php -i | grep error_log

# Или в php.ini:
# error_log = /var/log/php_errors.log
```

### Логи веб-сервера:

#### Apache:
```bash
tail -f /var/log/apache2/error.log
# или
tail -f /var/log/httpd/error_log
```

#### Nginx:
```bash
tail -f /var/log/nginx/error.log
```

### Временный файл для отладки:
```php
// В начало register.php:
file_put_contents('/tmp/messenger_debug.log', 
    date('Y-m-d H:i:s') . " - Register page\n", 
    FILE_APPEND
);
```

## 4. Проверка PHP настроек

### Создать файл phpinfo.php:
```php
<?php
phpinfo();
?>
```

### Проверить:
- `display_errors` - должно быть On для разработки
- `error_reporting` - должно быть E_ALL
- `session.save_path` - должна быть доступна для записи
- PDO extension - должна быть включена
- MySQL extension - должна быть включена

## 5. Тестирование API вручную

### Тест auth.php:
```bash
# GET запрос (должен вернуть ошибку авторизации):
curl https://your-domain.example/messenger/api/auth.php?action=me

# Ожидаемый ответ:
# {"error":"Не авторизован"}
```

### Тест с сессией:
```php
<?php
// test_api.php
session_start();
$_SESSION['user_id'] = 1;
$_SESSION['username'] = 'test';
require_once 'api/auth.php';
?>
```

## 6. Проверка JavaScript

### Открыть консоль браузера (F12):
- Проверить наличие ошибок
- Проверить загрузку файлов:
  - `assets/css/main.css`
  - `assets/css/chat.css`
  - `assets/js/app.js`
  - `assets/js/chat.js`
  - `assets/js/polling.js`

### Проверить сетевые запросы:
- Вкладка Network в DevTools
- Проверить статус всех запросов
- Проверить содержимое ответов

## 7. Улучшение обработки ошибок

### В database.php:
```php
catch (PDOException $e) {
    $errorMsg = "Database connection error: " . $e->getMessage();
    error_log($errorMsg);
    
    // Для разработки - показывать ошибку
    if (ini_get('display_errors')) {
        header('Content-Type: application/json');
        die(json_encode(['error' => $errorMsg]));
    }
    
    die("Database connection failed. Please try again later.");
}
```

### В register.php (добавить в начало):
```php
// Временная отладка
if (isset($_GET['debug'])) {
    ini_set('display_errors', 1);
    error_reporting(E_ALL);
}

// Логирование
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    error_log("Register POST: " . print_r($_POST, true));
}
```

## 8. Проверка путей

### Убедиться, что пути правильные:
```php
// В config/config.php проверить:
echo ROOT_PATH; // Должен быть абсолютный путь
echo BASE_URL;  // Должен быть правильный URL
```

### Проверить загрузку файлов:
```php
// В includes/functions.php проверить:
if (!is_dir(UPLOAD_PATH)) {
    mkdir(UPLOAD_PATH, 0755, true);
}
```

## 9. Тестирование регистрации пошагово

1. Открыть `/register.php?debug=1`
2. Заполнить форму
3. Отправить
4. Проверить:
   - Логи сервера
   - Логи PHP
   - Временный файл отладки
   - Содержимое `$_POST`
   - Результат SQL запроса

## 10. Проверка сессий

### Убедиться, что сессии работают:
```php
<?php
// test_session.php
session_start();
$_SESSION['test'] = 'value';
echo "Session ID: " . session_id() . "\n";
echo "Session test: " . ($_SESSION['test'] ?? 'not set') . "\n";
?>
```

### Проверить права на папку сессий:
```bash
ls -la /var/lib/php/sessions/
# или где указано в session.save_path
```
