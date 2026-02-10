<?php
/**
 * Прокси для отдачи файлов стикеров.
 * Решает проблему 404, когда путь PHP (ROOT_PATH) отличается от DocumentRoot веб-сервера.
 */
require_once __DIR__ . '/../includes/functions.php';

$path = $_GET['path'] ?? '';
$path = preg_replace('#^/++#', '', $path);

if (empty($path) || strpos($path, 'uploads/stickers/') !== 0 || strpos($path, '..') !== false) {
    http_response_code(400);
    exit('Invalid path');
}

$fullPath = rtrim(ROOT_PATH, '/\\') . '/' . str_replace('\\', '/', $path);

if (!is_file($fullPath)) {
    http_response_code(404);
    exit('Not found');
}

$ext = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));
$mimes = [
    'gif' => 'image/gif',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'svg' => 'image/svg+xml',
    'mp4' => 'video/mp4',
];
$mime = $mimes[$ext] ?? 'application/octet-stream';

header('Content-Type: ' . $mime);
header('Cache-Control: public, max-age=86400');
readfile($fullPath);
