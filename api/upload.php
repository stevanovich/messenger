<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}
if (($_POST['type'] ?? $_GET['type'] ?? '') === 'sticker' && !isAdmin()) {
    jsonError('Только администратор может загружать стикеры', 403);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Метод не поддерживается', 405);
}

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    jsonError('Файл не загружен');
}

$file = $_FILES['file'];
$requestType = $_POST['type'] ?? $_GET['type'] ?? '';
$isImage = strpos($file['type'], 'image/') === 0;
$isVideo = strpos($file['type'], 'video/') === 0;
$type = ($requestType === 'sticker' && ($isImage || $isVideo)) ? 'sticker' : (($requestType === 'avatar' && $isImage) ? 'avatar' : ($isImage ? 'image' : 'file'));

$result = uploadFile($file, $type);

if ($result['success']) {
    $data = [
        'filename' => $result['filename'],
        'url' => $result['url'],
        'size' => $result['size'],
        'type' => $type
    ];
    if ($type === 'sticker') {
        $data['file_path'] = 'uploads/stickers/' . $result['filename'];
    }
    jsonSuccess($data);
} else {
    jsonError($result['error'] ?? 'Ошибка при загрузке файла');
}
