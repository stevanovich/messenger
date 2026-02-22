<?php
/**
 * API управляемых категорий реакций: список, добавление, удаление.
 * Только для администраторов.
 */
session_start();
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/emojis.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn() || !isAdmin()) {
    jsonError('Доступ только для администратора', 403);
}

$method = $_SERVER['REQUEST_METHOD'];
global $pdo;

ensure_reaction_categories_table($pdo);

switch ($method) {
    case 'GET':
        try {
            $stmt = $pdo->query("SELECT name, sort_order, name_ru, name_en, name_sr, COALESCE(hidden, 0) AS hidden FROM reaction_categories ORDER BY sort_order, name");
        } catch (PDOException $e) {
            try {
                $stmt = $pdo->query("SELECT name, sort_order, name_ru, name_en, name_sr FROM reaction_categories ORDER BY sort_order, name");
            } catch (PDOException $e2) {
                $stmt = $pdo->query("SELECT name, sort_order FROM reaction_categories ORDER BY sort_order, name");
            }
        }
        $list = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $locale = isset($_GET['locale']) ? trim(strtolower((string) $_GET['locale'])) : '';
        if (!in_array($locale, ['ru', 'en', 'sr'], true)) {
            $locale = null;
        }
        foreach ($list as $i => $row) {
            if (!array_key_exists('name_ru', $row)) {
                $list[$i]['name_ru'] = null;
                $list[$i]['name_en'] = null;
                $list[$i]['name_sr'] = null;
            }
            if (!array_key_exists('hidden', $row)) {
                $list[$i]['hidden'] = 0;
            }
            if ($locale !== null) {
                $col = 'name_' . $locale;
                $list[$i]['display_name'] = (isset($row[$col]) && $row[$col] !== null && $row[$col] !== '') ? $row[$col] : $row['name'];
            }
        }
        jsonSuccess(['categories' => $list]);
        break;

    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $action = $data['action'] ?? 'add';
        if ($action === 'reorder') {
            $order = $data['order'] ?? [];
            if (!is_array($order)) {
                jsonError('Укажите order: массив { name, sort_order }');
            }
            $stmt = $pdo->prepare("INSERT INTO reaction_categories (name, sort_order) VALUES (?, ?) ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)");
            foreach ($order as $i => $item) {
                if (isset($item['name'])) {
                    $name = mb_substr(trim((string) $item['name']), 0, 64);
                    if ($name !== '') {
                        $stmt->execute([$name, (int) ($item['sort_order'] ?? $i)]);
                    }
                }
            }
            jsonSuccess(null, 'Порядок сохранён');
            break;
        }
        $name = isset($data['name']) ? trim((string) $data['name']) : '';
        $name = mb_substr($name, 0, 64);
        if ($name === '') {
            jsonError('Укажите название категории');
        }
        $nextSort = (int) $pdo->query("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM reaction_categories")->fetchColumn();
        try {
            $stmt = $pdo->prepare("INSERT INTO reaction_categories (name, sort_order) VALUES (?, ?)");
            $stmt->execute([$name, $nextSort]);
        } catch (PDOException $e) {
            if (($e->errorInfo()[1] ?? 0) === 1062) {
                jsonError('Категория с таким названием уже есть');
            }
            throw $e;
        }
        jsonSuccess(['name' => $name], 'Категория добавлена');
        break;

    case 'PATCH':
        $data = json_decode(file_get_contents('php://input'), true) ?? [];
        $oldName = isset($data['old_name']) ? trim((string) $data['old_name']) : '';
        $newName = isset($data['new_name']) ? trim((string) $data['new_name']) : '';
        $oldName = mb_substr($oldName, 0, 64);
        $newName = mb_substr($newName, 0, 64);
        if ($oldName !== '' && $newName !== '' && $oldName !== $newName) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare("UPDATE supported_emojis SET category = ? WHERE category = ?")->execute([$newName, $oldName]);
                $pdo->prepare("UPDATE stickers SET category = ? WHERE category = ?")->execute([$newName, $oldName]);
                $pdo->prepare("UPDATE reaction_categories SET name = ? WHERE name = ?")->execute([$newName, $oldName]);
                $pdo->commit();
            } catch (PDOException $e) {
                $pdo->rollBack();
                if (($e->errorInfo()[1] ?? 0) === 1062) {
                    jsonError('Категория с таким названием уже есть');
                }
                throw $e;
            }
            jsonSuccess(['name' => $newName], 'Категория переименована');
            break;
        }
        $name = isset($data['name']) ? trim((string) $data['name']) : '';
        $name = mb_substr($name, 0, 64);
        if ($name !== '' && array_key_exists('hidden', $data)) {
            $hidden = (int) (bool) $data['hidden'];
            try {
                $stmt = $pdo->prepare("UPDATE reaction_categories SET hidden = ? WHERE name = ?");
                $stmt->execute([$hidden, $name]);
                if ($stmt->rowCount() === 0) {
                    $nextSort = (int) $pdo->query("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM reaction_categories")->fetchColumn();
                    $pdo->prepare("INSERT INTO reaction_categories (name, sort_order, hidden) VALUES (?, ?, ?)")->execute([$name, $nextSort, $hidden]);
                }
            } catch (PDOException $e) {
                if (($e->errorInfo()[1] ?? 0) === 1054) {
                    /* column hidden not yet present */
                } else {
                    throw $e;
                }
            }
            jsonSuccess(null, $hidden ? 'Категория скрыта в чатах' : 'Категория отображается в чатах');
            break;
        }
        if ($name !== '' && (array_key_exists('name_ru', $data) || array_key_exists('name_en', $data) || array_key_exists('name_sr', $data))) {
            $updates = [];
            $params = [];
            foreach (['name_ru', 'name_en', 'name_sr'] as $col) {
                if (array_key_exists($col, $data)) {
                    $v = trim((string) $data[$col]);
                    $updates[] = $col . ' = ?';
                    $params[] = $v === '' ? null : mb_substr($v, 0, 64);
                }
            }
            if (!empty($updates)) {
                $params[] = $name;
                $stmt = $pdo->prepare("UPDATE reaction_categories SET " . implode(', ', $updates) . " WHERE name = ?");
                $stmt->execute($params);
                if ($stmt->rowCount() === 0) {
                    $nextSort = (int) $pdo->query("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM reaction_categories")->fetchColumn();
                    $nameRu = array_key_exists('name_ru', $data) ? (trim((string) $data['name_ru']) ?: null) : null;
                    $nameEn = array_key_exists('name_en', $data) ? (trim((string) $data['name_en']) ?: null) : null;
                    $nameSr = array_key_exists('name_sr', $data) ? (trim((string) $data['name_sr']) ?: null) : null;
                    if ($nameRu !== null) $nameRu = mb_substr($nameRu, 0, 64);
                    if ($nameEn !== null) $nameEn = mb_substr($nameEn, 0, 64);
                    if ($nameSr !== null) $nameSr = mb_substr($nameSr, 0, 64);
                    $pdo->prepare("INSERT INTO reaction_categories (name, sort_order, name_ru, name_en, name_sr) VALUES (?, ?, ?, ?, ?)")
                        ->execute([$name, $nextSort, $nameRu, $nameEn, $nameSr]);
                }
            }
            jsonSuccess(null, 'Названия обновлены');
            break;
        }
        jsonError('Укажите old_name и new_name (переименование) или name и name_ru/name_en/name_sr (названия по языкам)');
        break;

    case 'DELETE':
        $name = isset($_GET['name']) ? trim((string) $_GET['name']) : '';
        $name = mb_substr($name, 0, 64);
        if ($name === '') {
            jsonError('Укажите название категории (GET name=...)');
        }
        $targetCategory = 'Эмодзи';
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("UPDATE supported_emojis SET category = ? WHERE category = ?");
            $stmt->execute([$targetCategory, $name]);
            $stmt = $pdo->prepare("UPDATE stickers SET category = ? WHERE category = ?");
            $stmt->execute([$targetCategory, $name]);
            $pdo->prepare("DELETE FROM reaction_categories WHERE name = ?")->execute([$name]);
            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            throw $e;
        }
        jsonSuccess(null, 'Категория удалена, элементы перенесены в «' . $targetCategory . '»');
        break;

    default:
        jsonError('Метод не поддерживается', 405);
}
