<?php
/**
 * API единого перечня эмодзи (для inline-панели и панели стикеров).
 * Возвращает список с keywords и category; опционально — синхронизация в БД (только для админа).
 */
session_start();
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/emojis.php';

header('Content-Type: application/json; charset=utf-8');
$method = $_SERVER['REQUEST_METHOD'];
global $pdo;

if ($method !== 'GET' && $method !== 'POST' && $method !== 'PATCH') {
    jsonError('Метод не поддерживается', 405);
}

// PATCH: обновить keywords/category для одного эмодзи (только админ)
if ($method === 'PATCH') {
    if (!isLoggedIn() || !isAdmin()) {
        jsonError('Только администратор может редактировать эмодзи', 403);
    }
    $raw = file_get_contents('php://input');
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($data) || empty($data['emoji'])) {
        jsonError('Укажите emoji в теле запроса');
    }
    $emoji = trim((string) $data['emoji']);
    if (mb_strlen($emoji) > 32) {
        jsonError('Недопустимый emoji');
    }
    ensure_supported_emojis_table($pdo);
    $updates = [];
    $params = [];
    if (array_key_exists('keywords', $data)) {
        $updates[] = 'keywords = ?';
        $params[] = mb_substr(trim((string) $data['keywords']), 0, 500);
    }
    if (array_key_exists('category', $data)) {
        $updates[] = 'category = ?';
        $params[] = mb_substr(trim((string) $data['category']), 0, 64) ?: 'Эмодзи';
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
        jsonError('Укажите keywords, category, sort_order или hidden для обновления');
    }
    $params[] = $emoji;
    $stmt = $pdo->prepare("UPDATE supported_emojis SET " . implode(', ', $updates) . " WHERE emoji = ?");
    $stmt->execute($params);
    if ($stmt->rowCount() === 0) {
        $configList = load_supported_emojis_from_config();
        $found = null;
        foreach ($configList as $r) {
            if ($r['emoji'] === $emoji) {
                $found = $r;
                break;
            }
        }
        $keywords = array_key_exists('keywords', $data) ? mb_substr(trim((string) $data['keywords']), 0, 500) : ($found['keywords'] ?? '');
        $category = array_key_exists('category', $data) ? (mb_substr(trim((string) $data['category']), 0, 64) ?: 'Эмодзи') : ($found['category'] ?? 'Эмодзи');
        $sortOrder = array_key_exists('sort_order', $data) ? (int) $data['sort_order'] : 0;
        $hidden = array_key_exists('hidden', $data) ? (int) (bool) $data['hidden'] : 0;
        $ins = $pdo->prepare("INSERT INTO supported_emojis (emoji, keywords, category, sort_order, hidden) VALUES (?, ?, ?, ?, ?)");
        $ins->execute([$emoji, $keywords, $category, $sortOrder, $hidden]);
    }
    if (array_key_exists('category', $data)) {
        $newCategory = mb_substr(trim((string) $data['category']), 0, 64) ?: 'Эмодзи';
        try {
            $pdo->prepare("UPDATE stickers SET category = ? WHERE file_path = ?")->execute([$newCategory, 'emoji:' . $emoji]);
        } catch (PDOException $e) {
            // таблица stickers может не иметь колонки category или не существовать
        }
    }
    jsonSuccess(null, 'Обновлено');
}

// POST: синхронизация, массовые операции, изменение порядка. Только админ.
if ($method === 'POST') {
    if (!isLoggedIn() || !isAdmin()) {
        jsonError('Только администратор', 403);
    }
    $raw = file_get_contents('php://input');
    $body = (is_string($raw) && trim($raw) !== '') ? json_decode($raw, true) : null;
    $action = $_GET['action'] ?? $_POST['action'] ?? (is_array($body) ? ($body['action'] ?? '') : '');

    if ($action === 'bulk' && is_array($body)) {
        ensure_supported_emojis_table($pdo);
        $emojis = isset($body['emojis']) && is_array($body['emojis']) ? $body['emojis'] : [];
        $emojis = array_map('trim', array_filter($emojis, 'is_string'));
        $emojis = array_unique(array_filter($emojis, function ($e) { return mb_strlen($e) > 0 && mb_strlen($e) <= 32; }));
        $bulkAction = $body['bulk_action'] ?? '';
        if (empty($emojis)) {
            jsonError('Укажите массив emojis');
        }
        $placeholders = implode(',', array_fill(0, count($emojis), '?'));
        if ($bulkAction === 'move_category') {
            $category = mb_substr(trim((string) ($body['category'] ?? '')), 0, 64) ?: 'Эмодзи';
            $stmt = $pdo->prepare("UPDATE supported_emojis SET category = ? WHERE emoji IN ({$placeholders})");
            $stmt->execute(array_merge([$category], $emojis));
            try {
                $paths = array_map(function ($e) { return 'emoji:' . $e; }, $emojis);
                $ph = implode(',', array_fill(0, count($paths), '?'));
                $pdo->prepare("UPDATE stickers SET category = ? WHERE file_path IN ({$ph})")->execute(array_merge([$category], $paths));
            } catch (PDOException $e) {
                // таблица stickers может отсутствовать
            }
            jsonSuccess(['updated' => $stmt->rowCount()], 'Категория обновлена');
        }
        if ($bulkAction === 'hide') {
            $stmt = $pdo->prepare("UPDATE supported_emojis SET hidden = 1 WHERE emoji IN ({$placeholders})");
            $stmt->execute($emojis);
            jsonSuccess(['updated' => $stmt->rowCount()], 'Скрыто');
        }
        if ($bulkAction === 'show') {
            $stmt = $pdo->prepare("UPDATE supported_emojis SET hidden = 0 WHERE emoji IN ({$placeholders})");
            $stmt->execute($emojis);
            jsonSuccess(['updated' => $stmt->rowCount()], 'Показано');
        }
        if ($bulkAction === 'delete') {
            $stmt = $pdo->prepare("DELETE FROM supported_emojis WHERE emoji IN ({$placeholders})");
            $stmt->execute($emojis);
            jsonSuccess(['deleted' => $stmt->rowCount()], 'Удалено');
        }
        jsonError('Неизвестное действие bulk: move_category, hide, show, delete');
    }

    if ($action === 'reorder' && is_array($body) && !empty($body['order'])) {
        ensure_supported_emojis_table($pdo);
        $order = $body['order'];
        if (!is_array($order)) {
            jsonError('Укажите order: массив { emoji, sort_order }');
        }
        $stmt = $pdo->prepare("UPDATE supported_emojis SET sort_order = ? WHERE emoji = ?");
        foreach ($order as $item) {
            if (isset($item['emoji'], $item['sort_order'])) {
                $stmt->execute([(int) $item['sort_order'], trim((string) $item['emoji'])]);
            }
        }
        jsonSuccess(null, 'Порядок сохранён');
    }

    if ($action === 'remove_duplicates') {
        $r = remove_duplicate_emojis_from_config();
        if (!empty($r['error'])) {
            $msg = $r['error'];
            if (strpos($msg, 'запис') !== false || strpos($msg, 'доступ') !== false) {
                $msg .= ' Проверьте права на запись файла config/supported_emojis.php (владелец — пользователь веб-сервера).';
            }
            jsonError($msg, 500);
        }
        jsonSuccess($r, 'Удалено дубликатов: ' . $r['removed'] . ', записей осталось: ' . $r['kept']);
    }

    if ($action === 'save_etalon') {
        $r = save_supported_emojis_to_config($pdo);
        if (!empty($r['error'])) {
            $msg = $r['error'];
            if (strpos($msg, 'запис') !== false || strpos($msg, 'доступ') !== false) {
                $msg .= ' Проверьте права на запись config/supported_emojis.php.';
            }
            jsonError($msg, 500);
        }
        jsonSuccess($r, 'Эталон сохранён: ' . $r['saved'] . ' записей');
    }

    $action = $action ?: 'sync_all';
    $result = ['supported_emojis' => ['inserted' => 0, 'errors' => []], 'stickers' => ['inserted' => 0, 'errors' => []]];
    if ($action === 'sync_all' || $action === 'sync_supported') {
        $r = sync_supported_emojis_from_config($pdo);
        $result['supported_emojis'] = $r;
    }
    if ($action === 'sync_all' || $action === 'sync_stickers') {
        $r = sync_stickers_from_supported_emojis($pdo);
        $result['stickers'] = $r;
    }
    jsonSuccess($result, 'Синхронизация выполнена');
}

// GET: список эмодзи с keywords и category (публично для пикера)
$category = isset($_GET['category']) ? trim((string) $_GET['category']) : null;
$withMeta = get_supported_emojis_with_meta($pdo);
if ($category !== null && $category !== '') {
    $withMeta = array_filter($withMeta, function ($r) use ($category) {
        return ($r['category'] ?? '') === $category;
    });
    $withMeta = array_values($withMeta);
}
$hiddenCategories = get_hidden_reaction_category_names($pdo);
if (!empty($hiddenCategories)) {
    $hiddenSet = array_flip($hiddenCategories);
    $withMeta = array_values(array_filter($withMeta, function ($r) use ($hiddenSet) {
        return !isset($hiddenSet[$r['category'] ?? '']);
    }));
}
$categories = array_values(array_unique(array_column($withMeta, 'category')));
$orderNames = get_reaction_category_order($pdo, true);
if (!empty($orderNames)) {
    $orderMap = array_flip($orderNames);
    usort($categories, function ($a, $b) use ($orderMap) {
        $ia = isset($orderMap[$a]) ? $orderMap[$a] : PHP_INT_MAX;
        $ib = isset($orderMap[$b]) ? $orderMap[$b] : PHP_INT_MAX;
        if ($ia !== $ib) {
            return $ia - $ib;
        }
        return strcmp($a, $b);
    });
    usort($withMeta, function ($a, $b) use ($orderMap) {
        $ca = $a['category'] ?? 'Эмодзи';
        $cb = $b['category'] ?? 'Эмодзи';
        $ia = isset($orderMap[$ca]) ? $orderMap[$ca] : PHP_INT_MAX;
        $ib = isset($orderMap[$cb]) ? $orderMap[$cb] : PHP_INT_MAX;
        if ($ia !== $ib) {
            return $ia - $ib;
        }
        return ((int) ($a['sort_order'] ?? 0)) - ((int) ($b['sort_order'] ?? 0));
    });
} else {
    sort($categories);
}
$usageCounts = [];
try {
    $stmt = $pdo->query("SELECT emoji, COUNT(*) AS cnt FROM message_reactions GROUP BY emoji");
    if ($stmt) {
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $usageCounts[$row['emoji']] = (int) $row['cnt'];
        }
    }
} catch (PDOException $e) {
    // таблица может отсутствовать
}
foreach ($withMeta as &$e) {
    $e['usage_count'] = isset($usageCounts[$e['emoji']]) ? $usageCounts[$e['emoji']] : 0;
}
unset($e);
jsonSuccess([
    'emojis'     => $withMeta,
    'categories' => $categories,
]);
