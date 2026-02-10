<?php
/**
 * Подключение к базе данных MySQL
 * Скопируйте в database.php и укажите свои данные
 */

$db_config = [
    'host' => 'localhost',
    'dbname' => 'messenger_db',
    'username' => 'messenger_user',
    'password' => 'your_password',
    'charset' => 'utf8mb4'
];
$GLOBALS['db_config'] = $db_config; // для ensurePdoConnection() в длительных процессах (WebSocket)

$pdoOptions = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $dsn = "mysql:host={$db_config['host']};dbname={$db_config['dbname']};charset={$db_config['charset']}";
    $pdo = new PDO($dsn, $db_config['username'], $db_config['password'], $pdoOptions);
} catch (PDOException $e) {
    $errorMsg = "Database connection error: " . $e->getMessage();
    error_log($errorMsg);
    
    if (ini_get('display_errors')) {
        if (isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false) {
            header('Content-Type: application/json; charset=utf-8');
            die(json_encode(['error' => $errorMsg], JSON_UNESCAPED_UNICODE));
        }
        header('Content-Type: text/html; charset=utf-8');
        die("
        <html>
        <head><title>Database Error</title></head>
        <body style='font-family: Arial; padding: 20px;'>
            <h2>Ошибка подключения к базе данных</h2>
            <p><strong>Ошибка:</strong> " . htmlspecialchars($e->getMessage()) . "</p>
            <h3>Инструкции:</h3>
            <ol>
                <li>Создайте БД: <code>messenger_db</code></li>
                <li>Создайте пользователя с правами на БД</li>
                <li>Скопируйте <code>config/database.example.php</code> в <code>config/database.php</code></li>
                <li>Укажите host, dbname, username, password в config/database.php</li>
                <li>Импортируйте схему: <code>mysql -u user -p messenger_db &lt; sql/schema.sql</code></li>
            </ol>
        </body>
        </html>
        ");
    }
    die("Database connection failed. Please try again later.");
}

function ensurePdoConnection() {
    global $pdo;
    if (!isset($pdo)) return;
    $db_config = $GLOBALS['db_config'] ?? null;
    if (!$db_config) return;
    try {
        $pdo->query('SELECT 1');
    } catch (PDOException $e) {
        $goneAway = ($e->getCode() === 'HY000' && strpos($e->getMessage(), '2006') !== false)
            || stripos($e->getMessage(), 'gone away') !== false;
        if (!$goneAway) throw $e;
        $dsn = "mysql:host={$db_config['host']};dbname={$db_config['dbname']};charset={$db_config['charset']}";
        $pdo = new PDO($dsn, $db_config['username'], $db_config['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
}
