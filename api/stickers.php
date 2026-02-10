<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];
global $pdo;

switch ($method) {
    case 'GET':
        $action = $_GET['action'] ?? 'list';
        
        if ($action === 'categories') {
            $stmt = $pdo->query("
                SELECT DISTINCT category FROM stickers
                WHERE category IS NOT NULL AND category != ''
                ORDER BY category
            ");
            $categories = $stmt->fetchAll(PDO::FETCH_COLUMN);
            jsonSuccess(['categories' => $categories]);
        }
        
        if ($action === 'list' || $action === '') {
            $category = $_GET['category'] ?? null;
            $sql = "SELECT id, name, category, file_path FROM stickers ORDER BY category, name";
            $params = [];
            if ($category !== null && $category !== '') {
                $sql = "SELECT id, name, category, file_path FROM stickers WHERE category = ? ORDER BY name";
                $params[] = $category;
            }
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($stickers as $i => $s) {
                if (strpos($s['file_path'], 'emoji:') === 0) {
                    $stickers[$i]['emoji'] = substr($s['file_path'], 6);
                    $stickers[$i]['url'] = null;
                } else {
                    $stickers[$i]['url'] = BASE_URL . 'api/sticker_file.php?path=' . rawurlencode($s['file_path']);
                    $stickers[$i]['emoji'] = null;
                }
            }
            jsonSuccess(['stickers' => $stickers]);
        }
        
        jsonError('Неизвестное действие');
        break;
        
    case 'POST':
        if (!isLoggedIn()) {
            jsonError('Не авторизован', 401);
        }
        $action = $_GET['action'] ?? '';
        if ($action === 'add' && isAdmin()) {
            // Один запрос: multipart/form-data с file, name, category
            if (empty($_FILES['file']['tmp_name']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                jsonError($_FILES['file']['error'] ?? 0 ? 'Ошибка загрузки файла' : 'Выберите файл');
            }
            $name = trim($_POST['name'] ?? '');
            $category = trim($_POST['category'] ?? '') ?: null;
            if (empty($name)) {
                jsonError('Укажите название стикера');
            }
            $result = uploadFile($_FILES['file'], 'sticker');
            if (!$result['success']) {
                jsonError($result['error'] ?? 'Ошибка загрузки');
            }
            $filePath = 'uploads/stickers/' . $result['filename'];
            try {
                $stmt = $pdo->prepare("INSERT INTO stickers (name, category, file_path) VALUES (?, ?, ?)");
                $stmt->execute([$name, $category, $filePath]);
                $id = (int) $pdo->lastInsertId();
                jsonSuccess(['id' => $id, 'name' => $name, 'category' => $category, 'file_path' => $filePath]);
            } catch (PDOException $e) {
                jsonError('Ошибка при добавлении в БД');
            }
        } elseif ($action === 'add_from_message' && isAdmin()) {
            try {
                $rawInput = file_get_contents('php://input');
                $data = is_string($rawInput) ? (json_decode($rawInput, true) ?? []) : [];
                $messageId = (int)($data['message_id'] ?? 0);
                $filePath = trim($data['file_path'] ?? '');
                if (!$messageId && !$filePath) {
                    jsonError('Укажите message_id или file_path', 400);
                }
                if ($messageId) {
                    $stmt = $pdo->prepare("SELECT type, file_path, file_name FROM messages WHERE id = ? AND deleted_at IS NULL");
                    $stmt->execute([$messageId]);
                    $row = $stmt->fetch(PDO::FETCH_ASSOC);
                    if (!$row) jsonError('Сообщение не найдено', 404);
                    if (!in_array($row['type'], ['image', 'file', 'sticker'])) jsonError('Сообщение должно быть изображением, файлом или стикером');
                    $filePath = $row['file_path'] ?? '';
                    $fileName = $row['file_name'] ?? '';
                } else {
                    $fileName = basename(parse_url($filePath, PHP_URL_PATH) ?: $filePath);
                }
                $isGif = (bool)preg_match('/\.gif(\?|$)/i', $filePath . $fileName);
                if (!$isGif) {
                    jsonError('Можно сохранять только GIF-файлы');
                }
                $path = preg_replace('#^https?://[^/]+/+#', '', $filePath);
                $path = ltrim(preg_replace('#\\?.*$#', '', trim($path)), '/');
                if (preg_match('#sticker_file\.php\?path=([^&\s"\']+)#', $filePath, $qm)) {
                    $path = rawurldecode($qm[1]);
                }
                if (!preg_match('#^uploads/(images|documents|stickers)/.+\\.gif$#i', $path)) {
                    $m = [];
                    if (preg_match('#uploads/(?:images|documents|stickers)/[^\s?"\']+\\.gif#i', $filePath, $m)) {
                        $path = preg_replace('#\\?.*$#', '', $m[0]);
                    } else {
                        if (preg_match('#^https?://#', $filePath) && strpos($filePath, 'uploads/') === false) {
                            jsonError('Можно сохранять только GIF, загруженные в чат. Внешние ссылки (Coub и др.) не поддерживаются.');
                        } else {
                            jsonError('Путь к GIF не распознан. Убедитесь, что файл загружен через «Прикрепить».');
                        }
                    }
                }
                $fullSrc = rtrim(ROOT_PATH, '/\\') . '/' . str_replace('\\', '/', $path);
                if (!is_file($fullSrc)) {
                    jsonError('Файл не найден: ' . $path);
                }
                $ext = pathinfo($fullSrc, PATHINFO_EXTENSION);
                $newName = uniqid() . '_' . time() . '.' . $ext;
                $stickerDir = rtrim(ROOT_PATH, '/\\') . '/uploads/stickers';
                if (!is_dir($stickerDir)) {
                    if (!@mkdir($stickerDir, 0755, true)) {
                        jsonError('Не удалось создать папку uploads/stickers/');
                    }
                }
                $fullDst = $stickerDir . '/' . $newName;
                if (!@copy($fullSrc, $fullDst)) {
                    jsonError('Не удалось скопировать файл. Проверьте права на uploads/stickers/');
                }
                $relPath = 'uploads/stickers/' . $newName;
                $name = pathinfo($fileName ?: $newName, PATHINFO_FILENAME);
                $name = preg_replace('/^[a-f0-9]+_\d+_/', '', $name) ?: 'GIF';
                $stmt = $pdo->prepare("INSERT INTO stickers (name, category, file_path) VALUES (?, 'GIF', ?)");
                $stmt->execute([$name ?: 'GIF', $relPath]);
                $id = (int)$pdo->lastInsertId();
                jsonSuccess(['id' => $id, 'name' => $name, 'category' => 'GIF', 'file_path' => $relPath]);
            } catch (PDOException $e) {
                if (isset($fullDst) && is_file($fullDst)) @unlink($fullDst);
                jsonError('Ошибка при добавлении в БД');
            } catch (Throwable $e) {
                jsonError($e->getMessage());
            }
        } elseif ($action === 'favorite') {
            $data = json_decode(file_get_contents('php://input'), true);
            $stickerId = (int)($data['sticker_id'] ?? 0);
            $userUuid = getCurrentUserUuid();
            if (!$stickerId) {
                jsonError('Не указан sticker_id');
            }
            try {
                $stmt = $pdo->prepare("INSERT IGNORE INTO user_stickers (user_uuid, sticker_id) VALUES (?, ?)");
                $stmt->execute([$userUuid, $stickerId]);
                jsonSuccess(null, 'Добавлено в избранное');
            } catch (PDOException $e) {
                jsonError('Ошибка добавления');
            }
        } else {
            jsonError('Неизвестное действие');
        }
        break;

    case 'PATCH':
        if (!isLoggedIn() || !isAdmin()) {
            jsonError('Только администратор может редактировать стикеры', 403);
        }
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $id = (int)($data['id'] ?? $_GET['id'] ?? 0);
        if (!$id) {
            jsonError('Не указан id стикера');
        }
        $updates = [];
        $params = [];
        if (array_key_exists('name', $data)) {
            $updates[] = 'name = ?';
            $params[] = trim($data['name'] ?? '');
        }
        if (array_key_exists('category', $data)) {
            $updates[] = 'category = ?';
            $params[] = trim($data['category'] ?? '') ?: null;
        }
        if (empty($updates)) {
            jsonError('Нечего обновлять');
        }
        $params[] = $id;
        $stmt = $pdo->prepare("UPDATE stickers SET " . implode(', ', $updates) . " WHERE id = ?");
        $stmt->execute($params);
        jsonSuccess(null, 'Стикер обновлён');
        break;

    case 'DELETE':
        if (!isLoggedIn() || !isAdmin()) {
            jsonError('Только администратор может удалять стикеры', 403);
        }
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) {
            jsonError('Не указан id стикера');
        }
        $stmt = $pdo->prepare("SELECT file_path FROM stickers WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            jsonError('Стикер не найден', 404);
        }
        $stmt = $pdo->prepare("DELETE FROM stickers WHERE id = ?");
        $stmt->execute([$id]);
        // Удаляем файл с сервера, если это не emoji
        $filePath = trim($row['file_path'] ?? '');
        if ($filePath !== '' && strpos($filePath, 'emoji:') !== 0) {
            $path = str_replace('\\', '/', $filePath);
            if (strpos($path, 'uploads/stickers/') === 0) {
                $fullPath = rtrim(ROOT_PATH, '/\\') . '/' . ltrim($path, '/');
                if (is_file($fullPath)) {
                    @unlink($fullPath);
                }
            }
        }
        jsonSuccess(null, 'Стикер удалён');
        break;
        
    default:
        jsonError('Метод не поддерживается', 405);
}
