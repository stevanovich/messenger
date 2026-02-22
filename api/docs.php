<?php
/**
 * Отдаёт содержимое .md файлов из docs/ для страницы документации.
 * Параметр file: только из белого списка (USER_GUIDE_INDEX.md, user-guide-*.md).
 */
header('Content-Type: application/json; charset=utf-8');

$allowed = [
    'USER_GUIDE_INDEX.md',
    'USER_DOCUMENTATION_PLAN.md',
    'user-guide-account.md',
    'user-guide-chat.md',
    'user-guide-calls.md',
    'user-guide-privacy-e2ee.md',
    'user-guide-notifications.md',
    'user-guide-interface.md',
];

$file = isset($_GET['file']) ? trim($_GET['file']) : '';
if ($file === '' || !in_array($file, $allowed, true)) {
    echo json_encode(['error' => 'Invalid or missing file']);
    exit;
}

$path = __DIR__ . '/../docs/' . $file;
if (!is_file($path) || !is_readable($path)) {
    echo json_encode(['error' => 'File not found']);
    exit;
}

$content = file_get_contents($path);
if ($content === false) {
    echo json_encode(['error' => 'Read error']);
    exit;
}

echo json_encode(['content' => $content]);
