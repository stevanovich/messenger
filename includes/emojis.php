<?php
/**
 * Единый перечень поддерживаемых эмодзи (inline, стикеры, реакции).
 * Источник: таблица supported_emojis в БД; при отсутствии или пустой таблице — config/supported_emojis.php.
 */

if (!defined('ROOT_PATH')) {
    define('ROOT_PATH', dirname(__DIR__));
}

/** Путь к конфигу эмодзи */
function get_supported_emojis_config_path() {
    return rtrim(ROOT_PATH, '/\\') . '/config/supported_emojis.php';
}

/**
 * Загрузить конфиг эмодзи из PHP-файла (массив записей с emoji, keywords, category).
 * @return array<int, array{emoji: string, keywords: string, category: string}>
 */
function load_supported_emojis_from_config() {
    $path = get_supported_emojis_config_path();
    if (!is_file($path) || !is_readable($path)) {
        return [];
    }
    $data = @include $path;
    if (!is_array($data)) {
        return [];
    }
    $byEmoji = [];
    foreach ($data as $row) {
        if (empty($row['emoji']) || !is_string($row['emoji'])) {
            continue;
        }
        $item = [
            'emoji'    => $row['emoji'],
            'keywords' => isset($row['keywords']) ? (string) $row['keywords'] : '',
            'category' => isset($row['category']) ? (string) $row['category'] : 'Эмодзи',
        ];
        $key = normalize_emoji_key($item['emoji']);
        if ($key === '') {
            continue;
        }
        if (!isset($byEmoji[$key]) || mb_strlen($item['keywords']) > mb_strlen($byEmoji[$key]['keywords'])) {
            $byEmoji[$key] = $item;
        }
    }
    return array_values($byEmoji);
}

/**
 * Нормализовать символ эмодзи для сравнения дубликатов: один и тот же эмодзи (напр. 👍 и 👍️) даёт один ключ.
 * Убирает селекторы вариантов (U+FE0E, U+FE0F), при наличии Intl — приводит к NFC.
 * @param string $s
 * @return string
 */
function normalize_emoji_key($s) {
    if ($s === '' || !is_string($s)) {
        return $s;
    }
    $s = preg_replace('/[\x{FE0E}\x{FE0F}]/u', '', $s);
    if ($s === '') {
        return $s;
    }
    if (class_exists('Normalizer') && is_callable(['Normalizer', 'normalize'])) {
        $n = \Normalizer::normalize($s, \Normalizer::NFC);
        if ($n !== false && $n !== '') {
            return $n;
        }
    }
    return $s;
}

/**
 * Найти дубликаты эмодзи в config-файле и удалить записи с меньшим числом ключевых слов.
 * Дубликаты определяются по нормализованному эмодзи (один символ = один ключ); из дубликатов оставляется запись с более длинными keywords.
 * Перезаписывает config/supported_emojis.php.
 * @return array{removed: int, kept: int, total_before: int, path: string, error?: string}
 */
function remove_duplicate_emojis_from_config() {
    $path = get_supported_emojis_config_path();
    $result = ['removed' => 0, 'kept' => 0, 'total_before' => 0, 'path' => $path];
    if (!is_file($path) || !is_readable($path)) {
        $result['error'] = 'Файл конфига не найден или недоступен для чтения';
        return $result;
    }
    $data = @include $path;
    if (!is_array($data)) {
        $result['error'] = 'Конфиг не содержит массив';
        return $result;
    }
    $result['total_before'] = count($data);
    $byEmoji = [];
    $order = [];
    foreach ($data as $row) {
        if (empty($row['emoji']) || !is_string($row['emoji'])) {
            continue;
        }
        $item = [
            'emoji'    => $row['emoji'],
            'keywords' => isset($row['keywords']) ? (string) $row['keywords'] : '',
            'category' => isset($row['category']) ? (string) $row['category'] : 'Эмодзи',
        ];
        $key = normalize_emoji_key($item['emoji']);
        if ($key === '') {
            continue;
        }
        if (!isset($byEmoji[$key])) {
            $byEmoji[$key] = $item;
            $order[] = $key;
        } elseif (mb_strlen($item['keywords']) > mb_strlen($byEmoji[$key]['keywords'])) {
            $result['removed']++;
            $byEmoji[$key] = $item;
        } else {
            $result['removed']++;
        }
    }
    $result['kept'] = count($byEmoji);
    $deduplicated = [];
    foreach ($order as $key) {
        $deduplicated[] = $byEmoji[$key];
    }
    if (!is_writable($path)) {
        $result['error'] = 'Файл конфига недоступен для записи';
        return $result;
    }
    $escape = function ($s) {
        return str_replace(['\\', "'"], ['\\\\', "\\'"], $s);
    };
    $lines = ["<?php\n", "/**\n", " * Единый перечень поддерживаемых эмодзи (для inline-панели, стикеров и реакций).\n", " * Каждый элемент: emoji, keywords (поиск), category (категория для стикеров/фильтров).\n", " * При наличии таблицы supported_emojis в БД данные берутся из неё; иначе используется этот массив как fallback.\n", " */\n", "\nreturn [\n"];
    foreach ($deduplicated as $row) {
        $lines[] = "    ['emoji' => '" . $escape($row['emoji']) . "', 'keywords' => '" . $escape($row['keywords']) . "', 'category' => '" . $escape($row['category']) . "'],\n";
    }
    $lines[] = "];\n";
    if (file_put_contents($path, implode('', $lines)) === false) {
        $result['error'] = 'Не удалось записать файл';
        return $result;
    }
    return $result;
}

/**
 * Сохранить текущий набор эмодзи из БД (supported_emojis) в config/supported_emojis.php (эталон).
 * @param PDO $pdo
 * @return array{saved: int, path: string, error?: string}
 */
function save_supported_emojis_to_config($pdo) {
    $path = get_supported_emojis_config_path();
    $result = ['saved' => 0, 'path' => $path];
    if (!$pdo) {
        $result['error'] = 'Нет подключения к БД';
        return $result;
    }
    try {
        $stmt = $pdo->query("SELECT emoji, keywords, category FROM supported_emojis ORDER BY sort_order, category, emoji");
        if (!$stmt) {
            $result['error'] = 'Таблица supported_emojis недоступна';
            return $result;
        }
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        $result['error'] = 'Ошибка БД: ' . $e->getMessage();
        return $result;
    }
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($path) && !is_writable($dir)) {
        $result['error'] = 'Файл конфига недоступен для записи';
        return $result;
    }
    $escape = function ($s) {
        return str_replace(['\\', "'"], ['\\\\', "\\'"], $s);
    };
    $lines = ["<?php\n", "/**\n", " * Единый перечень поддерживаемых эмодзи (для inline-панели, стикеров и реакций).\n", " * Каждый элемент: emoji, keywords (поиск), category (категория для стикеров/фильтров).\n", " * Сохранён из БД (эталон). При наличии таблицы supported_emojis в БД данные берутся из неё; иначе используется этот массив.\n", " */\n", "\nreturn [\n"];
    foreach ($rows as $r) {
        $emoji = $r['emoji'] ?? '';
        if ($emoji === '') {
            continue;
        }
        $keywords = isset($r['keywords']) ? (string) $r['keywords'] : '';
        $category = isset($r['category']) ? (string) $r['category'] : 'Эмодзи';
        $lines[] = "    ['emoji' => '" . $escape($emoji) . "', 'keywords' => '" . $escape($keywords) . "', 'category' => '" . $escape($category) . "'],\n";
        $result['saved']++;
    }
    $lines[] = "];\n";
    if (file_put_contents($path, implode('', $lines)) === false) {
        $result['error'] = 'Не удалось записать файл';
        return $result;
    }
    return $result;
}

/**
 * Создать таблицу supported_emojis при отсутствии (для API/миграций).
 * @param PDO $pdo
 */
function ensure_supported_emojis_table($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS supported_emojis (
        emoji varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        keywords varchar(500) DEFAULT '',
        category varchar(64) DEFAULT 'Эмодзи',
        sort_order int(11) NOT NULL DEFAULT 0,
        hidden tinyint(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (emoji),
        KEY category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    try {
        $pdo->exec("ALTER TABLE supported_emojis MODIFY emoji varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL");
    } catch (PDOException $e) {
        // колонка уже в нужной коллации
    }
}

/**
 * Есть ли в БД таблица supported_emojis и не пуста ли она.
 * @param PDO $pdo
 * @return bool
 */
function supported_emojis_table_exists_and_has_data($pdo) {
    try {
        $stmt = $pdo->query("SELECT 1 FROM supported_emojis LIMIT 1");
        return $stmt && $stmt->fetch() !== false;
    } catch (PDOException $e) {
        return false;
    }
}

/**
 * Получить полный список поддерживаемых эмодзи с метаданными (keywords, category).
 * Сначала из БД (supported_emojis), при отсутствии данных — из config.
 * @param PDO|null $pdo
 * @param bool $includeHidden Для админки: true — все, false — только видимые (по умолчанию)
 * @return array<int, array{emoji: string, keywords: string, category: string, sort_order?: int, hidden?: int}>
 */
function get_supported_emojis_with_meta($pdo = null, $includeHidden = false) {
    if ($pdo === null) {
        global $pdo;
    }
    if ($pdo && supported_emojis_table_exists_and_has_data($pdo)) {
        $hiddenCond = $includeHidden ? '' : ' WHERE (COALESCE(hidden, 0) = 0)';
        $cols = $includeHidden ? 'emoji, keywords, category, sort_order, COALESCE(hidden, 0) AS hidden' : 'emoji, keywords, category, sort_order';
        try {
            $stmt = $pdo->query("SELECT {$cols} FROM supported_emojis{$hiddenCond} ORDER BY sort_order, category, emoji");
        } catch (PDOException $e) {
            $stmt = null;
        }
        if (!$stmt) {
            try {
                $stmt = $pdo->query("SELECT emoji, keywords, category, sort_order FROM supported_emojis ORDER BY sort_order, category, emoji");
            } catch (PDOException $e) {
                $stmt = null;
            }
        }
        if ($stmt) {
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $out = [];
            $byKey = [];
            foreach ($rows as $r) {
                $item = [
                    'emoji'    => $r['emoji'],
                    'keywords' => (string) ($r['keywords'] ?? ''),
                    'category' => (string) ($r['category'] ?? 'Эмодзи'),
                    'sort_order' => (int) ($r['sort_order'] ?? 0),
                ];
                if ($includeHidden) {
                    $item['hidden'] = (int) ($r['hidden'] ?? 0);
                }
                $key = normalize_emoji_key($item['emoji']);
                if ($key === '') {
                    continue;
                }
                if (!isset($byKey[$key])) {
                    $byKey[$key] = $item;
                }
            }
            return array_values($byKey);
        }
    }
    $config = load_supported_emojis_from_config();
    foreach ($config as $i => $row) {
        $config[$i]['sort_order'] = $i;
        if ($includeHidden) {
            $config[$i]['hidden'] = 0;
        }
    }
    return $config;
}

/**
 * Список только символов эмодзи (для реакций и быстрого доступа).
 * @param PDO|null $pdo
 * @return list<string>
 */
function get_supported_emojis_list($pdo = null) {
    $withMeta = get_supported_emojis_with_meta($pdo);
    return array_column($withMeta, 'emoji');
}

/**
 * Синхронизировать таблицу supported_emojis из config (вставить недостающие, не трогать существующие).
 * @param PDO $pdo
 * @return array{inserted: int, errors: array}
 */
function sync_supported_emojis_from_config($pdo) {
    $inserted = 0;
    $errors = [];
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS supported_emojis (
            emoji varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            keywords varchar(500) DEFAULT '',
            category varchar(64) DEFAULT 'Эмодзи',
            sort_order int(11) NOT NULL DEFAULT 0,
            hidden tinyint(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (emoji),
            KEY category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    } catch (PDOException $e) {
        $errors[] = $e->getMessage();
        return ['inserted' => 0, 'errors' => $errors];
    }
    // Исправить коллацию колонки emoji на utf8mb4_bin (иначе ❤ и ❤️ считаются дубликатами и INSERT IGNORE теряет записи)
    try {
        $pdo->exec("ALTER TABLE supported_emojis MODIFY emoji varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL");
    } catch (PDOException $e) {
        // колонка уже в нужной коллации или другая ошибка — не критично
    }
    $config = load_supported_emojis_from_config();
    $pdo->exec("DELETE FROM supported_emojis");
    $stmt = $pdo->prepare("INSERT INTO supported_emojis (emoji, keywords, category, sort_order, hidden) VALUES (?, ?, ?, ?, 0)");
    foreach ($config as $i => $row) {
        try {
            $stmt->execute([$row['emoji'], $row['keywords'], $row['category'], $i]);
            $inserted++;
        } catch (PDOException $e) {
            $errors[] = $row['emoji'] . ': ' . $e->getMessage();
        }
    }
    return ['inserted' => $inserted, 'errors' => $errors];
}

/**
 * Удалить дубликаты эмодзи-стикеров: оставить по одной записи на «визуальный» эмодзи (нормализованный ключ).
 * Из дубликатов оставляется запись с наибольшей длиной keywords (из supported_emojis); при отсутствии связи — по min id.
 * @param PDO $pdo
 * @return int количество удалённых строк
 */
function remove_duplicate_emoji_stickers($pdo) {
    $stmt = $pdo->query("
        SELECT s.id, s.file_path,
               COALESCE(CHAR_LENGTH(e.keywords), 0) AS keywords_len
        FROM stickers s
        LEFT JOIN supported_emojis e ON s.file_path COLLATE utf8mb4_bin = CONCAT('emoji:', e.emoji)
        WHERE s.file_path LIKE 'emoji:%'
        ORDER BY s.id
    ");
    if (!$stmt) {
        return 0;
    }
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $keepIds = [];
    foreach ($rows as $r) {
        $emoji = substr($r['file_path'], 6);
        $key = normalize_emoji_key($emoji);
        if ($key === '') {
            continue;
        }
        $kwLen = (int) ($r['keywords_len'] ?? 0);
        $id = (int) $r['id'];
        if (!isset($keepIds[$key])) {
            $keepIds[$key] = ['id' => $id, 'keywords_len' => $kwLen];
        } elseif ($kwLen > $keepIds[$key]['keywords_len']) {
            $keepIds[$key] = ['id' => $id, 'keywords_len' => $kwLen];
        } elseif ($kwLen === $keepIds[$key]['keywords_len'] && $id < $keepIds[$key]['id']) {
            $keepIds[$key] = ['id' => $id, 'keywords_len' => $kwLen];
        }
    }
    $idsToKeep = array_column($keepIds, 'id');
    if (empty($idsToKeep)) {
        return 0;
    }
    $placeholders = implode(',', array_fill(0, count($idsToKeep), '?'));
    $del = $pdo->prepare("DELETE FROM stickers WHERE file_path LIKE 'emoji:%' AND id NOT IN ($placeholders)");
    $del->execute($idsToKeep);
    return $del->rowCount();
}

/**
 * Синхронизировать стикеры из supported_emojis: для каждого эмодзи без записи в stickers добавить строку (file_path = 'emoji:' + emoji).
 * Перед вставкой удаляются дубликаты эмодзи-стикеров (одна запись на визуальный эмодзи).
 * @param PDO $pdo
 * @return array{inserted: int, updated: int, deleted_duplicates: int, errors: array}
 */
function sync_stickers_from_supported_emojis($pdo) {
    $inserted = 0;
    $updated = 0;
    $deletedDuplicates = remove_duplicate_emoji_stickers($pdo);
    $errors = [];
    $list = get_supported_emojis_with_meta($pdo);
    $check = $pdo->prepare("SELECT 1 FROM stickers WHERE file_path COLLATE utf8mb4_bin = ? LIMIT 1");
    $insert = $pdo->prepare("INSERT INTO stickers (name, category, file_path) VALUES (?, ?, ?)");
    $update = $pdo->prepare("UPDATE stickers SET name = ?, category = ? WHERE file_path COLLATE utf8mb4_bin = ?");
    foreach ($list as $row) {
        $path = 'emoji:' . $row['emoji'];
        $name = $row['emoji'];
        $firstKeyword = trim(explode(' ', (string) $row['keywords'])[0] ?? '');
        if ($firstKeyword !== '') {
            $name = $firstKeyword;
        }
        if (mb_strlen($name) > 100) {
            $name = mb_substr($name, 0, 100);
        }
        $category = $row['category'] ?? 'Эмодзи';
        $check->execute([$path]);
        if ($check->fetch()) {
            try {
                $update->execute([$name, $category, $path]);
                if ($update->rowCount() > 0) {
                    $updated++;
                }
            } catch (PDOException $e) {
                $errors[] = $row['emoji'] . ': ' . $e->getMessage();
            }
            continue;
        }
        try {
            $insert->execute([$name, $category, $path]);
            $inserted++;
        } catch (PDOException $e) {
            $errors[] = $row['emoji'] . ': ' . $e->getMessage();
        }
    }
    return ['inserted' => $inserted, 'updated' => $updated, 'deleted_duplicates' => $deletedDuplicates, 'errors' => $errors];
}

/**
 * Порядок категорий из reaction_categories (для панелей в чате).
 * @param PDO $pdo
 * @param bool $visibleOnly только категории с hidden = 0 (для отображения в чате)
 * @return list<string>
 */
function get_reaction_category_order($pdo, $visibleOnly = false) {
    try {
        $where = $visibleOnly ? ' WHERE (COALESCE(hidden, 0) = 0)' : '';
        $stmt = $pdo->query("SELECT name FROM reaction_categories{$where} ORDER BY sort_order, name");
        return $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
    } catch (PDOException $e) {
        if ($visibleOnly) {
            try {
                $stmt = $pdo->query("SELECT name FROM reaction_categories ORDER BY sort_order, name");
                return $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
            } catch (PDOException $e2) {
                return [];
            }
        }
        return [];
    }
}

/**
 * Имена категорий, скрытых из чата (reaction_categories.hidden = 1).
 * @param PDO $pdo
 * @return list<string>
 */
function get_hidden_reaction_category_names($pdo) {
    try {
        $stmt = $pdo->query("SELECT name FROM reaction_categories WHERE (COALESCE(hidden, 0) = 1)");
        return $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
    } catch (PDOException $e) {
        return [];
    }
}

/**
 * Создать таблицу reaction_categories при отсутствии и добавить колонку hidden при необходимости.
 * Вызывать перед использованием порядка/видимости категорий в API стикеров и эмодзи.
 * @param PDO $pdo
 */
function ensure_reaction_categories_table(PDO $pdo): void {
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS reaction_categories (
            name varchar(64) NOT NULL,
            sort_order int(11) NOT NULL DEFAULT 0,
            name_ru varchar(64) DEFAULT NULL,
            name_en varchar(64) DEFAULT NULL,
            name_sr varchar(64) DEFAULT NULL,
            hidden tinyint(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    } catch (PDOException $e) {
        // Таблица уже есть или нет прав — пробуем добавить колонку
    }
    try {
        $pdo->exec("ALTER TABLE reaction_categories ADD COLUMN hidden tinyint(1) NOT NULL DEFAULT 0");
    } catch (PDOException $e) {
        // 1060 = duplicate column (MySQL); колонка уже есть или другая ошибка — не прерываем работу
    }
}

/**
 * Собрать все имена категорий из supported_emojis и stickers (без дубликатов).
 * @param PDO $pdo
 * @return list<string>
 */
function get_all_category_names_from_data(PDO $pdo): array {
    $names = [];
    try {
        $stmt = $pdo->query("SELECT DISTINCT category FROM supported_emojis WHERE category IS NOT NULL AND category != ''");
        if ($stmt) {
            while ($row = $stmt->fetch(PDO::FETCH_NUM)) {
                $names[$row[0]] = true;
            }
        }
    } catch (PDOException $e) {
        // таблица может отсутствовать
    }
    try {
        $stmt = $pdo->query("SELECT DISTINCT category FROM stickers WHERE category IS NOT NULL AND category != ''");
        if ($stmt) {
            while ($row = $stmt->fetch(PDO::FETCH_NUM)) {
                $names[$row[0]] = true;
            }
        }
    } catch (PDOException $e) {
        // таблица может отсутствовать
    }
    $list = array_keys($names);
    sort($list, SORT_STRING);
    return array_values($list);
}

/**
 * Добавить в reaction_categories строки для всех категорий из данных (supported_emojis + stickers),
 * которых ещё нет в таблице. Видимость по умолчанию — показывать (hidden=0).
 * @param PDO $pdo
 * @return int количество добавленных строк
 */
function ensure_reaction_categories_from_data(PDO $pdo): int {
    ensure_reaction_categories_table($pdo);
    $fromData = get_all_category_names_from_data($pdo);
    if (empty($fromData)) {
        return 0;
    }
    $existing = [];
    try {
        $stmt = $pdo->query("SELECT name FROM reaction_categories");
        if ($stmt) {
            while ($row = $stmt->fetch(PDO::FETCH_NUM)) {
                $existing[$row[0]] = true;
            }
        }
    } catch (PDOException $e) {
        return 0;
    }
    $maxSort = 0;
    try {
        $r = $pdo->query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM reaction_categories");
        if ($r) {
            $maxSort = (int) $r->fetchColumn();
        }
    } catch (PDOException $e) {
        // ignore
    }
    $inserted = 0;
    $stmt = $pdo->prepare("INSERT INTO reaction_categories (name, sort_order, hidden) VALUES (?, ?, 0)");
    foreach ($fromData as $name) {
        if (isset($existing[$name])) {
            continue;
        }
        try {
            $stmt->execute([$name, $maxSort]);
            $maxSort++;
            $inserted++;
            $existing[$name] = true;
        } catch (PDOException $e) {
            if (($e->errorInfo()[1] ?? 0) !== 1062) {
                throw $e;
            }
        }
    }
    return $inserted;
}
