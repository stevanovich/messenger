<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

if (!isLoggedIn()) {
    header('Location: ' . (defined('BASE_URL') ? BASE_URL : '/') . 'login.php?redirect=' . urlencode($_SERVER['REQUEST_URI']));
    exit;
}
if (!isAdmin()) {
    http_response_code(403);
    echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Доступ запрещён</title></head><body><h1>403</h1><p>Доступ к админ-панели только для администраторов.</p><p><a href="' . (defined('BASE_URL') ? BASE_URL : '/') . '">На главную</a></p></body></html>';
    exit;
}

$adminNav = [
    'index.php' => 'Дашборд',
    'users.php' => 'Учётные записи',
    'stickers.php' => 'Стикеры',
    'stats.php' => 'Статистика',
    'analytics.php' => 'События',
    'heatmaps.php' => 'Тепловые карты',
    'calls.php' => 'Звонки',
    'websocket.php' => 'WebSocket',
    'key_backup.php' => 'Защита ключей',
];
