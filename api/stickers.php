<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/emojis.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$method = $_SERVER['REQUEST_METHOD'];
global $pdo;

switch ($method) {
    case 'GET':
        try {
            ensure_reaction_categories_table($pdo);
        } catch (Throwable $e) {
            // Таблица/колонка могут отсутствовать при ограниченных правах БД — продолжаем без фильтра по видимости категорий
        }
        $action = $_GET['action'] ?? 'list';
        
        if ($action === 'categories') {
            ensure_reaction_categories_from_data($pdo);
            $allFromData = get_all_category_names_from_data($pdo);
            $hiddenSet = array_flip(get_hidden_reaction_category_names($pdo));
            $orderNames = get_reaction_category_order($pdo, false);
            $orderMap = array_flip($orderNames);
            $visible = array_values(array_filter($allFromData, function ($cat) use ($hiddenSet) {
                return !isset($hiddenSet[$cat]);
            }));
            usort($visible, function ($a, $b) use ($orderMap) {
                $ia = isset($orderMap[$a]) ? $orderMap[$a] : PHP_INT_MAX;
                $ib = isset($orderMap[$b]) ? $orderMap[$b] : PHP_INT_MAX;
                if ($ia !== $ib) {
                    return $ia - $ib;
                }
                return strcmp($a, $b);
            });
            jsonSuccess(['categories' => $visible]);
        }
        
        if ($action === 'list' || $action === '') {
            $category = $_GET['category'] ?? null;
            $includeHidden = isAdmin() && isset($_GET['admin']) && $_GET['admin'] === '1';
            // В панели чата не фильтруем по stickers.hidden — показываем все стикеры из видимых категорий (как в админке)
            $hiddenCond = '';
            $orderBy = ' ORDER BY COALESCE(sort_order,0), category, name';
            $sql = "SELECT id, name, category, file_path, COALESCE(sort_order,0) AS sort_order FROM stickers WHERE 1=1";
            $params = [];
            if ($category !== null && $category !== '') {
                $sql .= " AND category = ?";
                $params[] = $category;
            }
            $sql .= $orderBy;
            try {
                $stmt = $params ? $pdo->prepare($sql) : $pdo->query($sql);
                if ($params) {
                    $stmt->execute($params);
                }
                $stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (PDOException $e) {
                if ($includeHidden || strpos($e->getMessage(), 'hidden') === false) {
                    throw $e;
                }
                $hiddenCond = '';
                $sql = "SELECT id, name, category, file_path FROM stickers WHERE 1=1" . ($category !== null && $category !== '' ? " AND category = ?" : "") . " ORDER BY category, name";
                $stmt = $params ? $pdo->prepare($sql) : $pdo->query($sql);
                if ($params) {
                    $stmt->execute($params);
                }
                $stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);
                foreach ($stickers as $i => $s) {
                    if (!array_key_exists('sort_order', $stickers[$i])) {
                        $stickers[$i]['sort_order'] = 0;
                    }
                }
            }
            if (!$includeHidden) {
                $hiddenCat = get_hidden_reaction_category_names($pdo);
                if (!empty($hiddenCat)) {
                    $stickers = array_values(array_filter($stickers, function ($s) use ($hiddenCat) {
                        return !in_array($s['category'] ?? '', $hiddenCat, true);
                    }));
                }
            }
            foreach ($stickers as $i => $s) {
                if (strpos($s['file_path'], 'emoji:') === 0) {
                    $stickers[$i]['emoji'] = substr($s['file_path'], 6);
                    $stickers[$i]['url'] = null;
                } else {
                    $stickers[$i]['url'] = BASE_URL . 'api/sticker_file.php?path=' . rawurlencode($s['file_path']);
                    $stickers[$i]['emoji'] = null;
                }
            }
            $usageCounts = [];
            try {
                $stmtUsage = $pdo->query("SELECT file_path, COUNT(*) AS cnt FROM messages WHERE type = 'sticker' AND file_path IS NOT NULL AND file_path != '' GROUP BY file_path");
                if ($stmtUsage) {
                    while ($row = $stmtUsage->fetch(PDO::FETCH_ASSOC)) {
                        $usageCounts[$row['file_path']] = (int) $row['cnt'];
                    }
                }
            } catch (PDOException $e) {
                // игнорируем при отсутствии таблицы/колонок
            }
            foreach ($stickers as $i => $s) {
                $stickers[$i]['usage_count'] = isset($usageCounts[$s['file_path'] ?? '']) ? $usageCounts[$s['file_path']] : 0;
            }
            $managedOrder = get_reaction_category_order($pdo, true);
            // Порядок категорий как в настройках: сначала из reaction_categories, затем остальные по алфавиту
            $allCatsInData = array_values(array_unique(array_filter(array_column($stickers, 'category'))));
            $otherCats = array_diff($allCatsInData, $managedOrder);
            sort($otherCats, SORT_STRING);
            $categoriesOrder = array_merge($managedOrder, $otherCats);
            $emojisFromMeta = [];
            // Дополняем эмодзи из supported_emojis (видимые категории), которых нет в stickers — чтобы состав совпадал с админкой
            try {
                $visibleCats = array_flip($categoriesOrder);
                $emojisFromMeta = get_supported_emojis_with_meta($pdo, false);
                $emojiHasSticker = [];
                foreach ($stickers as $s) {
                    if (isset($s['emoji']) && $s['emoji'] !== null && $s['emoji'] !== '') {
                        $emojiHasSticker[$s['emoji']] = true;
                    }
                }
                foreach ($emojisFromMeta as $e) {
                    $cat = $e['category'] ?? 'Эмодзи';
                    if (!isset($visibleCats[$cat])) {
                        continue;
                    }
                    $emoji = $e['emoji'] ?? '';
                    if ($emoji === '' || isset($emojiHasSticker[$emoji])) {
                        continue;
                    }
                    $stickers[] = [
                        'id' => 0,
                        'name' => $e['keywords'] !== '' ? $e['keywords'] : $emoji,
                        'category' => $cat,
                        'file_path' => 'emoji:' . $emoji,
                        'emoji' => $emoji,
                        'url' => null,
                        'sort_order' => (int) ($e['sort_order'] ?? 0),
                        'usage_count' => isset($usageCounts['emoji:' . $emoji]) ? $usageCounts['emoji:' . $emoji] : 0,
                    ];
                }
            } catch (Throwable $e) {
                // supported_emojis может отсутствовать
            }
            // Для эмодзи из таблицы stickers использовать sort_order из supported_emojis (как в админке)
            if (!empty($emojisFromMeta)) {
                $emojiSortOrder = [];
                foreach ($emojisFromMeta as $e) {
                    $emojiSortOrder[$e['emoji'] ?? ''] = (int) ($e['sort_order'] ?? 0);
                }
                foreach ($stickers as $i => $s) {
                    $emoji = $s['emoji'] ?? null;
                    if ($emoji !== null && $emoji !== '' && isset($emojiSortOrder[$emoji])) {
                        $stickers[$i]['sort_order'] = $emojiSortOrder[$emoji];
                    }
                }
            }
            // Всегда сортируем как в настройках: порядок категорий из reaction_categories (+ остальные по алфавиту), внутри категории — сначала эмодзи по sort_order, потом стикеры по sort_order, затем по имени
            if ($categoriesOrder === []) {
                $categoriesOrder = array_values(array_unique(array_filter(array_column($stickers, 'category'))));
                sort($categoriesOrder, SORT_STRING);
            }
            $catOrder = array_flip($categoriesOrder);
            usort($stickers, function ($a, $b) use ($catOrder) {
                $ca = $a['category'] ?? '';
                $cb = $b['category'] ?? '';
                $ia = isset($catOrder[$ca]) ? $catOrder[$ca] : 999;
                $ib = isset($catOrder[$cb]) ? $catOrder[$cb] : 999;
                if ($ia !== $ib) return $ia - $ib;
                $emojiA = strpos($a['file_path'] ?? '', 'emoji:') === 0 ? 0 : 1;
                $emojiB = strpos($b['file_path'] ?? '', 'emoji:') === 0 ? 0 : 1;
                if ($emojiA !== $emojiB) return $emojiA - $emojiB;
                $soA = (int) ($a['sort_order'] ?? 0);
                $soB = (int) ($b['sort_order'] ?? 0);
                if ($soA !== $soB) return $soA - $soB;
                return strcmp($a['name'] ?? '', $b['name'] ?? '');
            });
            $fromStickers = array_values(array_unique(array_filter(array_column($stickers, 'category'))));
            $categories = [];
            foreach ($categoriesOrder as $name) {
                if (in_array($name, $fromStickers, true)) {
                    $categories[] = $name;
                }
            }
            foreach ($fromStickers as $c) {
                if ($c !== '' && !in_array($c, $categories, true)) {
                    $categories[] = $c;
                }
            }
            $payload = ['stickers' => $stickers];
            if (!empty($categories)) {
                $payload['categories'] = $categories;
            }
            jsonSuccess($payload);
        }
        
        jsonError('Неизвестное действие');
        break;
        
    case 'POST':
        if (!isLoggedIn()) {
            jsonError('Не авторизован', 401);
        }
        $rawInput = file_get_contents('php://input');
        $postBody = (is_string($rawInput) && trim($rawInput) !== '') ? json_decode($rawInput, true) : null;
        $action = $_GET['action'] ?? $_POST['action'] ?? (is_array($postBody) ? ($postBody['action'] ?? '') : '');

        if ($action === 'bulk' && isAdmin() && is_array($postBody)) {
            $ids = isset($postBody['ids']) && is_array($postBody['ids']) ? array_map('intval', $postBody['ids']) : [];
            $ids = array_filter($ids);
            $bulkAction = $postBody['bulk_action'] ?? '';
            if (empty($ids)) {
                jsonError('Укажите массив ids');
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            if ($bulkAction === 'move_category') {
                $category = trim((string) ($postBody['category'] ?? '')) ?: null;
                $stmt = $pdo->prepare("UPDATE stickers SET category = ? WHERE id IN ({$placeholders})");
                $stmt->execute(array_merge([$category], $ids));
                jsonSuccess(['updated' => $stmt->rowCount()], 'Категория обновлена');
            }
            if ($bulkAction === 'hide') {
                $stmt = $pdo->prepare("UPDATE stickers SET hidden = 1 WHERE id IN ({$placeholders})");
                $stmt->execute($ids);
                jsonSuccess(['updated' => $stmt->rowCount()], 'Скрыто');
            }
            if ($bulkAction === 'show') {
                $stmt = $pdo->prepare("UPDATE stickers SET hidden = 0 WHERE id IN ({$placeholders})");
                $stmt->execute($ids);
                jsonSuccess(['updated' => $stmt->rowCount()], 'Показано');
            }
            if ($bulkAction === 'delete') {
                $stmt = $pdo->prepare("SELECT id, file_path FROM stickers WHERE id IN ({$placeholders})");
                $stmt->execute($ids);
                $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
                $del = $pdo->prepare("DELETE FROM stickers WHERE id = ?");
                foreach ($rows as $row) {
                    $del->execute([$row['id']]);
                    $fp = $row['file_path'] ?? '';
                    if ($fp !== '' && strpos($fp, 'emoji:') !== 0) {
                        $path = str_replace('\\', '/', $fp);
                        if (strpos($path, 'uploads/stickers/') === 0) {
                            $full = rtrim(ROOT_PATH, '/\\') . '/' . ltrim($path, '/');
                            if (is_file($full)) {
                                @unlink($full);
                            }
                        }
                    }
                }
                jsonSuccess(['deleted' => count($rows)], 'Удалено');
            }
            jsonError('Неизвестное действие bulk: move_category, hide, show, delete');
        }

        if ($action === 'reorder' && isAdmin() && is_array($postBody) && !empty($postBody['order'])) {
            $order = $postBody['order'];
            if (!is_array($order)) {
                jsonError('Укажите order: массив { id, sort_order }');
            }
            $stmt = $pdo->prepare("UPDATE stickers SET sort_order = ? WHERE id = ?");
            foreach ($order as $item) {
                if (isset($item['id'], $item['sort_order'])) {
                    $stmt->execute([(int) $item['sort_order'], (int) $item['id']]);
                }
            }
            jsonSuccess(null, 'Порядок сохранён');
        }

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
                $stmt = $pdo->prepare("INSERT INTO stickers (name, category, file_path, sort_order, hidden) VALUES (?, ?, ?, 0, 0)");
                $stmt->execute([$name, $category, $filePath]);
                $id = (int) $pdo->lastInsertId();
                jsonSuccess(['id' => $id, 'name' => $name, 'category' => $category, 'file_path' => $filePath]);
            } catch (PDOException $e) {
                jsonError('Ошибка при добавлении в БД');
            }
        } elseif ($action === 'add_from_message' && isAdmin()) {
            try {
                $data = is_array($postBody) ? $postBody : [];
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
            $data = is_array($postBody) ? $postBody : [];
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
        if (array_key_exists('sort_order', $data)) {
            $updates[] = 'sort_order = ?';
            $params[] = (int) $data['sort_order'];
        }
        if (array_key_exists('hidden', $data)) {
            $updates[] = 'hidden = ?';
            $params[] = (int) (bool) $data['hidden'];
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
