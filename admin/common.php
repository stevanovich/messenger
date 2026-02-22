<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/locale.php';
initLocale();

if (!isLoggedIn()) {
    $redirectUri = isset($_SERVER['REQUEST_URI']) ? normalize_request_uri_path($_SERVER['REQUEST_URI']) : '';
    header('Location: ' . (defined('BASE_URL') ? BASE_URL : '/') . 'login.php?redirect=' . urlencode($redirectUri));
    exit;
}
if (!isAdmin()) {
    http_response_code(403);
    echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' . htmlspecialchars(t('admin.access_denied')) . '</title></head><body><h1>403</h1><p>' . htmlspecialchars(t('admin.admin_only')) . '</p><p><a href="' . (defined('BASE_URL') ? BASE_URL : '/') . '">' . htmlspecialchars(t('admin.go_home')) . '</a></p></body></html>';
    exit;
}

$adminNav = [
    t('admin.accounts') => [
        'users.php' => t('admin.accounts'),
    ],
    t('admin.statistics') => [
        'index.php' => t('admin.dashboard'),
        'stats.php' => t('admin.statistics'),
        'heatmaps.php' => t('admin.heatmaps'),
    ],
    t('admin.communication') => [
        'reaction_categories.php' => t('admin.reaction_categories'),
        'calls.php' => t('admin.calls'),
    ],
    t('admin.server') => [
        'analytics.php' => t('admin.events'),
        'websocket.php' => t('admin.websocket'),
    ],
    t('admin.security') => [
        'e2ee_algorithms.php' => t('admin.cryptography'),
        'key_backup.php' => t('admin.key_backup'),
    ],
];
