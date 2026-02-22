<?php
require_once __DIR__ . '/common.php';
$pageTitle = t('admin.heatmaps');
global $pdo;

// Проверка наличия новых колонок (viewport, zone) — после миграции migrate_analytics_clicks_heatmap_zones.sql
$hasNewColumns = false;
try {
    $pdo->query("SELECT viewport_width, zone FROM analytics_clicks LIMIT 1");
    $hasNewColumns = true;
} catch (Exception $e) {
    // Таблица без новых колонок — работаем в старом режиме
}

// Типы страниц для тепловых карт (1–6) и соответствие путям из analytics
$HEATMAP_PAGE_TYPES = [
    'login'  => ['label' => t('admin.heatmaps_login'), 'paths' => ['/login.php', '/login']],
    'register' => ['label' => t('admin.heatmaps_register'), 'paths' => ['/register.php', '/register']],
    'chats'  => ['label' => t('admin.heatmaps_chats'), 'paths' => ['/', '/index.php', '/index']],
    'chat'   => ['label' => t('admin.heatmaps_chat'), 'paths' => ['/', '/index.php', '/index']],
    'call'   => ['label' => t('admin.heatmaps_call'), 'paths' => ['/call-room.php', '/call-room']],
    'join'   => ['label' => t('admin.heatmaps_join'), 'paths' => ['/join-call.php', '/join-conversation.php', '/join-call', '/join-conversation']],
];

$pageFilter = isset($_GET['page']) ? (string)$_GET['page'] : '';
$days = min(90, max(1, (int)($_GET['days'] ?? 7)));
$cellSize = max(10, min(50, (int)($_GET['cell'] ?? 20)));
$deviceFilter = isset($_GET['device']) ? (string)$_GET['device'] : 'all'; // all | mobile | desktop
$zoneFilter = isset($_GET['zone']) ? (string)$_GET['zone'] : '';

if (!$hasNewColumns) {
    $deviceFilter = 'all';
    $zoneFilter = '';
}

// Валидный тип страницы — один из ключей или первый из списка
if ($pageFilter !== '' && !isset($HEATMAP_PAGE_TYPES[$pageFilter])) {
    $pageFilter = array_key_first($HEATMAP_PAGE_TYPES);
}
$heatmapPage = $pageFilter !== '' ? $pageFilter : array_key_first($HEATMAP_PAGE_TYPES);

// Маппинг сохранённых в БД путей на типы страниц (прошлые данные могут быть с подпапкой или без)
$getPageTypes = function ($page) {
    $page = trim((string) $page);
    $norm = trim($page, '/');
    // Точное совпадение корня или index
    if ($norm === '' || $norm === 'index' || $norm === 'index.php') {
        return ['chats', 'chat'];
    }
    // Путь заканчивается на /index.php или /index (в т.ч. /messenger/index.php)
    if (preg_match('#/(index\.php)?$#', $page)) {
        return ['chats', 'chat'];
    }
    // Остальные — по ключевым частям (порядок важен: более специфичные первыми)
    if (strpos($page, 'join-conversation') !== false || strpos($page, 'join-call') !== false) {
        return ['join'];
    }
    if (strpos($page, 'call-room') !== false) {
        return ['call'];
    }
    if (strpos($page, 'register') !== false) {
        return ['register'];
    }
    if (strpos($page, 'login') !== false) {
        return ['login'];
    }
    return [];
};
$daysForMapping = min(90, max(1, (int)($_GET['days'] ?? 7)));
$stmt = $pdo->prepare("
    SELECT DISTINCT page FROM analytics_clicks 
    WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    ORDER BY page
");
$stmt->execute([$daysForMapping]);
$distinctPages = $stmt->fetchAll(PDO::FETCH_COLUMN);
$actualPagesByType = array_fill_keys(array_keys($HEATMAP_PAGE_TYPES), []);
foreach ($distinctPages as $p) {
    foreach ($getPageTypes($p) as $t) {
        $actualPagesByType[$t][] = $p;
    }
}
foreach (array_keys($actualPagesByType) as $t) {
    $actualPagesByType[$t] = array_values(array_unique($actualPagesByType[$t]));
}

// Для выбранного типа страницы объединяем канонические пути и фактические из БД
$canonicalPaths = $HEATMAP_PAGE_TYPES[$heatmapPage]['paths'] ?? [];
$heatmapPagePaths = array_values(array_unique(array_merge($canonicalPaths, $actualPagesByType[$heatmapPage] ?? [])));
$pagePlaceholders = count($heatmapPagePaths) > 0 ? implode(',', array_fill(0, count($heatmapPagePaths), '?')) : '';

// Список зон с подписями (для фильтра и подписи под картой)
$HEATMAP_ZONES = [
    'sidebar'        => t('admin.heatmaps_zone_sidebar'),
    'sidebar_tabs'   => t('admin.heatmaps_zone_sidebar_tabs'),
    'chats_panel'    => t('admin.heatmaps_zone_chats_panel'),
    'contacts_panel' => t('admin.heatmaps_zone_contacts_panel'),
    'chat_main'      => t('admin.heatmaps_zone_chat_main'),
    'chat_empty'     => t('admin.heatmaps_zone_chat_empty'),
    'chat_window'    => t('admin.heatmaps_zone_chat_window'),
    'chat_header'    => t('admin.heatmaps_zone_chat_header'),
    'chat_messages'  => t('admin.heatmaps_zone_chat_messages'),
    'chat_input'     => t('admin.heatmaps_zone_chat_input'),
    'new_chat_btn'   => t('admin.heatmaps_zone_new_chat_btn'),
    'viewport'       => t('admin.heatmaps_zone_viewport'),
];

const MOBILE_MAX_WIDTH = 768;
const CANVAS_W = 800;
const CANVAS_H = 600;
const MOBILE_CANVAS_W = 375;
const MOBILE_CANVAS_H = 667;
const ZONE_CANVAS_W = 400;
const ZONE_CANVAS_H = 300;
const NORM_GRID_W = 80;
const NORM_GRID_H = 60;
const ZONE_GRID_W = 40;
const ZONE_GRID_H = 30;

// Построение query string для ссылок фильтров (для подстановки в JS передаём плейсхолдер)
$queryParams = function ($overrides = []) use ($pageFilter, $days, $cellSize, $deviceFilter, $zoneFilter) {
    $p = [
        'page'   => $pageFilter,
        'days'   => $days,
        'cell'   => $cellSize,
        'device' => $deviceFilter,
        'zone'   => $zoneFilter,
    ];
    $p = array_merge($p, $overrides);
    return '?' . http_build_query(array_filter($p, function ($v) { return $v !== ''; }));
};
$q = function ($overrides) use ($queryParams) {
    return htmlspecialchars($queryParams($overrides), ENT_QUOTES, 'UTF-8');
};

$clicks = [];
$heatmapMode = 'viewport'; // viewport = вся страница (нормализованная), zone = по зоне
$zoneLabel = '';
$gridW = NORM_GRID_W;
$gridH = NORM_GRID_H;
$canvasW = CANVAS_W;
$canvasH = CANVAS_H;

if ($heatmapPage !== '' && !empty($heatmapPagePaths)) {
    if ($hasNewColumns && $zoneFilter !== '') {
        // Режим «по зоне»: только клики в выбранной зоне, координаты в системе зоны (страницу не перерисовываем)
        $zoneLabel = $HEATMAP_ZONES[$zoneFilter] ?? $zoneFilter;
        $sql = "
            SELECT zone_x AS x, zone_y AS y, zone_width AS vw, zone_height AS vh
            FROM analytics_clicks
            WHERE page IN ($pagePlaceholders) AND zone = ? AND timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            AND zone_x IS NOT NULL AND zone_y IS NOT NULL AND zone_width IS NOT NULL AND zone_height IS NOT NULL
            AND zone_width > 0 AND zone_height > 0
        ";
        $params = array_merge($heatmapPagePaths, [$zoneFilter, $days]);
        if ($deviceFilter === 'mobile') {
            $sql .= " AND viewport_width IS NOT NULL AND viewport_width < ?";
            $params[] = MOBILE_MAX_WIDTH;
        } elseif ($deviceFilter === 'desktop') {
            $sql .= " AND viewport_width IS NOT NULL AND viewport_width >= ?";
            $params[] = MOBILE_MAX_WIDTH;
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        // Нормализация внутри зоны: gx = floor((zone_x/zone_width) * ZONE_GRID_W), gy = floor((zone_y/zone_height) * ZONE_GRID_H)
        $agg = [];
        foreach ($rows as $r) {
            $vw = (int)$r['vw'];
            $vh = (int)$r['vh'];
            if ($vw <= 0 || $vh <= 0) continue;
            $gx = (int)floor(((int)$r['x'] / $vw) * ZONE_GRID_W);
            $gy = (int)floor(((int)$r['y'] / $vh) * ZONE_GRID_H);
            $gx = max(0, min(ZONE_GRID_W - 1, $gx));
            $gy = max(0, min(ZONE_GRID_H - 1, $gy));
            $key = $gx . '_' . $gy;
            $agg[$key] = ($agg[$key] ?? 0) + 1;
        }
        $clicks = [];
        foreach ($agg as $key => $cnt) {
            list($gx, $gy) = explode('_', $key);
            $clicks[] = ['gx' => (int)$gx, 'gy' => (int)$gy, 'cnt' => $cnt];
        }
        $heatmapMode = 'zone';
        $gridW = ZONE_GRID_W;
        $gridH = ZONE_GRID_H;
        $canvasW = ZONE_CANVAS_W;
        $canvasH = ZONE_CANVAS_H;
    } elseif ($hasNewColumns) {
        // Режим «вся страница»: нормализованные координаты по viewport
        $sql = "
            SELECT x, y, viewport_width AS vw, viewport_height AS vh
            FROM analytics_clicks
            WHERE page IN ($pagePlaceholders) AND timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            AND viewport_width IS NOT NULL AND viewport_width > 0 AND viewport_height IS NOT NULL AND viewport_height > 0
        ";
        $params = array_merge($heatmapPagePaths, [$days]);
        if ($deviceFilter === 'mobile') {
            $sql .= " AND viewport_width < ?";
            $params[] = MOBILE_MAX_WIDTH;
        } elseif ($deviceFilter === 'desktop') {
            $sql .= " AND viewport_width >= ?";
            $params[] = MOBILE_MAX_WIDTH;
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $agg = [];
        foreach ($rows as $r) {
            $vw = (int)$r['vw'];
            $vh = (int)$r['vh'];
            if ($vw <= 0 || $vh <= 0) continue;
            $xNorm = (int)$r['x'] / $vw;
            $yNorm = (int)$r['y'] / $vh;
            $gx = (int)floor($xNorm * NORM_GRID_W);
            $gy = (int)floor($yNorm * NORM_GRID_H);
            $gx = max(0, min(NORM_GRID_W - 1, $gx));
            $gy = max(0, min(NORM_GRID_H - 1, $gy));
            $key = $gx . '_' . $gy;
            $agg[$key] = ($agg[$key] ?? 0) + 1;
        }
        $clicks = [];
        foreach ($agg as $key => $cnt) {
            list($gx, $gy) = explode('_', $key);
            $clicks[] = ['gx' => (int)$gx, 'gy' => (int)$gy, 'cnt' => $cnt];
        }
        if ($deviceFilter === 'mobile') {
            $canvasW = MOBILE_CANVAS_W;
            $canvasH = MOBILE_CANVAS_H;
        }
    } else {
        // Старый режим: сырые пиксели (без viewport/zone)
        $stmt = $pdo->prepare("
            SELECT FLOOR(x / ?) AS gx, FLOOR(y / ?) AS gy, COUNT(*) AS cnt 
            FROM analytics_clicks 
            WHERE page IN ($pagePlaceholders) AND timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY FLOOR(x / ?), FLOOR(y / ?)
        ");
        $stmt->execute(array_merge([$cellSize, $cellSize], $heatmapPagePaths, [$days, $cellSize, $cellSize]));
        $clicks = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $gridW = (int)(CANVAS_W / $cellSize);
        $gridH = (int)(CANVAS_H / $cellSize);
    }
}

// Список зон с данными для выпадающего списка (только при наличии новых колонок)
$zonesWithData = [];
if ($hasNewColumns && $heatmapPage !== '' && !empty($heatmapPagePaths)) {
    $stmt = $pdo->prepare("
        SELECT DISTINCT zone FROM analytics_clicks 
        WHERE page IN ($pagePlaceholders) AND timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND zone IS NOT NULL AND zone != ''
        ORDER BY zone
    ");
    $stmt->execute(array_merge($heatmapPagePaths, [$days]));
    $zonesWithData = $stmt->fetchAll(PDO::FETCH_COLUMN);
}

$maxCnt = 0;
foreach ($clicks as $c) {
    if ((int)$c['cnt'] > $maxCnt) $maxCnt = (int)$c['cnt'];
}

// Масштаб: в нормализованном режиме одна «ячейка» = (canvasW/gridW) x (canvasH/gridH) пикселей
$cellPxW = $heatmapMode === 'zone' ? (ZONE_CANVAS_W / ZONE_GRID_W) : ($canvasW / NORM_GRID_W);
$cellPxH = $heatmapMode === 'zone' ? (ZONE_CANVAS_H / ZONE_GRID_H) : ($canvasH / NORM_GRID_H);

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Тепловые карты кликов</h1>

<p class="admin-heatmap-hint">Тепловая карта показывает, где пользователи чаще всего кликают на выбранной странице или в выбранной зоне. Яркость = количество кликов.</p>

<div class="admin-filters">
    <label>
        Страница:
        <select onchange="location.href=('<?= $q(['page' => '__V__']) ?>').replace('__V__', encodeURIComponent(this.value))">
            <?php foreach ($HEATMAP_PAGE_TYPES as $pKey => $pInfo): ?>
                <option value="<?= escape($pKey) ?>" <?= $heatmapPage === $pKey ? 'selected' : '' ?>><?= escape($pInfo['label']) ?></option>
            <?php endforeach; ?>
        </select>
    </label>
    <label>
        Период (дней):
        <select onchange="location.href=('<?= $q(['days' => '__D__']) ?>').replace('__D__', this.value)">
            <option value="7" <?= $days === 7 ? 'selected' : '' ?>>7</option>
            <option value="14" <?= $days === 14 ? 'selected' : '' ?>>14</option>
            <option value="30" <?= $days === 30 ? 'selected' : '' ?>>30</option>
            <option value="90" <?= $days === 90 ? 'selected' : '' ?>>90</option>
        </select>
    </label>
    <?php if ($hasNewColumns): ?>
    <label>
        Устройство:
        <select onchange="location.href=('<?= $q(['device' => '__DEV__']) ?>').replace('__DEV__', this.value)">
            <option value="all" <?= $deviceFilter === 'all' ? 'selected' : '' ?>>Все</option>
            <option value="mobile" <?= $deviceFilter === 'mobile' ? 'selected' : '' ?>>Мобильные (&lt;768px)</option>
            <option value="desktop" <?= $deviceFilter === 'desktop' ? 'selected' : '' ?>>Десктоп (≥768px)</option>
        </select>
    </label>
    <label>
        Зона:
        <select onchange="location.href=('<?= $q(['zone' => '__Z__']) ?>').replace('__Z__', encodeURIComponent(this.value))">
            <option value="">Вся страница</option>
            <?php foreach ($zonesWithData as $z): ?>
                <option value="<?= escape($z) ?>" <?= $zoneFilter === $z ? 'selected' : '' ?>><?= escape($HEATMAP_ZONES[$z] ?? $z) ?></option>
            <?php endforeach; ?>
        </select>
    </label>
    <?php endif; ?>
    <label>
        Размер ячейки:
        <select onchange="location.href=('<?= $q(['cell' => '__C__']) ?>').replace('__C__', this.value)">
            <option value="10" <?= $cellSize === 10 ? 'selected' : '' ?>>10</option>
            <option value="20" <?= $cellSize === 20 ? 'selected' : '' ?>>20</option>
            <option value="30" <?= $cellSize === 30 ? 'selected' : '' ?>>30</option>
            <option value="50" <?= $cellSize === 50 ? 'selected' : '' ?>>50</option>
        </select>
    </label>
</div>

<div class="admin-heatmap-wrap">
    <?php if (empty($heatmapPagePaths)): ?>
        <div class="admin-heatmap-empty">Нет данных для выбранного типа страницы.</div>
    <?php else: ?>
        <p class="admin-heatmap-meta">
            Страница: <strong><?= escape($HEATMAP_PAGE_TYPES[$heatmapPage]['label'] ?? $heatmapPage) ?></strong>
            <?php if ($zoneLabel !== ''): ?>
                · Зона: <strong><?= escape($zoneLabel) ?></strong>
            <?php endif; ?>
            <?php if ($deviceFilter !== 'all'): ?>
                · <?= $deviceFilter === 'mobile' ? 'Мобильные' : 'Десктоп' ?>
            <?php endif; ?>
            <?php if (empty($clicks)): ?>
                · <span class="admin-heatmap-no-clicks">Нет кликов за период</span>
            <?php endif; ?>
        </p>
        <?php
        $showMockup = ($hasNewColumns && $zoneFilter === '');
        $mockupKey = $heatmapPage;
        ?>
        <div class="admin-heatmap-view <?= $zoneFilter !== '' ? 'admin-heatmap-view--zone' : '' ?>" style="--canvas-w:<?= (int)$canvasW ?>px;--canvas-h:<?= (int)$canvasH ?>px">
            <?php if ($showMockup): ?>
            <div class="admin-heatmap-mockup admin-heatmap-mockup--<?= escape($mockupKey) ?>" aria-hidden="true">
                <iframe
                    src="<?= escape(BASE_URL) ?>admin/heatmap-frame.php?page=<?= escape($mockupKey === 'chat' ? 'chats' : $mockupKey) ?>&device=<?= escape($deviceFilter) ?>"
                    class="admin-heatmap-mockup-iframe"
                    width="<?= (int)$canvasW ?>"
                    height="<?= (int)$canvasH ?>"
                    title="<?= escape($HEATMAP_PAGE_TYPES[$heatmapPage]['label'] ?? $mockupKey) ?>"
                ></iframe>
            </div>
            <?php endif; ?>
            <canvas id="heatmapCanvas" class="admin-heatmap-canvas" width="<?= (int)$canvasW ?>" height="<?= (int)$canvasH ?>"
                    data-show-layout="<?= $showMockup ? '1' : '0' ?>"
                    data-zone="<?= $zoneFilter !== '' ? escape($zoneFilter) : '' ?>"></canvas>
        </div>
        <script>
        (function() {
            const clicks = <?= json_encode($clicks) ?>;
            const cellPxW = <?= (float)$cellPxW ?>;
            const cellPxH = <?= (float)$cellPxH ?>;
            const maxCnt = <?= (int)$maxCnt ?>;
            const canvas = document.getElementById('heatmapCanvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            const showLayout = canvas.getAttribute('data-show-layout') === '1';
            const zoneId = canvas.getAttribute('data-zone') || '';

            function wrapText(ctx, text, cx, cy, maxWidth) {
                const parts = text.split(' / ');
                const lineHeight = 12;
                const lines = [];
                parts.forEach(function(part) {
                    const words = part.trim().split(/\s+/);
                    let line = '';
                    for (let i = 0; i < words.length; i++) {
                        const test = line ? line + ' ' + words[i] : words[i];
                        if (ctx.measureText(test).width <= maxWidth) line = test;
                        else { if (line) lines.push(line); line = words[i]; }
                    }
                    if (line) lines.push(line);
                });
                const totalH = lines.length * lineHeight;
                let y = cy - totalH / 2 + lineHeight / 2;
                lines.forEach(function(l) {
                    ctx.fillText(l, cx, y);
                    y += lineHeight;
                });
            }

            // Упрощённая схема зоны для контекста (режим «По зоне»)
            function drawZoneLayout() {
                const font = '11px sans-serif';
                ctx.font = font;
                ctx.strokeStyle = '#bbb';
                ctx.lineWidth = 1;
                ctx.fillStyle = '#e8e8e8';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                if (zoneId === 'new_chat_btn') {
                    ctx.fillRect(2, 2, w - 4, h - 4);
                    ctx.strokeRect(2, 2, w - 4, h - 4);
                    ctx.fillStyle = '#666';
                    ctx.fillText('Новая беседа', w / 2, h / 2);
                    return;
                }
                if (zoneId === 'chat_input') {
                    const actionH = h * 0.25, fieldH = h * 0.5, sendW = w * 0.15;
                    ctx.fillStyle = '#e0e0e0';
                    ctx.fillRect(2, 2, w * 0.12, actionH - 2);
                    ctx.strokeRect(2, 2, w * 0.12, actionH - 2);
                    ctx.fillStyle = '#666';
                    ctx.fillText('⋯', w * 0.06, actionH / 2);
                    ctx.fillStyle = '#eee';
                    ctx.fillRect(w * 0.12 + 2, 2, w * 0.73 - 4, h - 4);
                    ctx.strokeRect(w * 0.12 + 2, 2, w * 0.73 - 4, h - 4);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Ввод сообщения...', w * 0.5, h / 2);
                    ctx.fillStyle = '#e0e0e0';
                    ctx.fillRect(w - sendW - 2, 2, sendW, h - 4);
                    ctx.strokeRect(w - sendW - 2, 2, sendW, h - 4);
                    ctx.fillStyle = '#666';
                    ctx.fillText('➤', w - sendW / 2 - 2, h / 2);
                    return;
                }
                if (zoneId === 'chat_header') {
                    const barH = Math.min(48, h * 0.4);
                    ctx.fillStyle = '#e5e5e5';
                    ctx.fillRect(0, 0, w, barH);
                    ctx.strokeRect(0.5, 0.5, w - 1, barH - 1);
                    ctx.fillStyle = '#666';
                    ctx.textAlign = 'left';
                    ctx.fillText('←', 12, barH / 2);
                    ctx.textAlign = 'center';
                    ctx.fillText('Чат / Имя', w / 2, barH / 2);
                    return;
                }
                if (zoneId === 'chat_messages') {
                    ctx.fillStyle = '#f5f5f5';
                    ctx.fillRect(2, 2, w - 4, h - 4);
                    ctx.strokeRect(2, 2, w - 4, h - 4);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Сообщения', w / 2, h / 2);
                    return;
                }
                if (zoneId === 'chat_window') {
                    const headH = h * 0.12, inputH = h * 0.2;
                    ctx.fillStyle = '#e5e5e5';
                    ctx.fillRect(0, 0, w, headH);
                    ctx.strokeRect(0.5, 0.5, w - 1, headH - 1);
                    ctx.fillStyle = '#f5f5f5';
                    ctx.fillRect(0, headH, w, h - headH - inputH);
                    ctx.strokeRect(0.5, headH + 0.5, w - 1, h - headH - inputH - 1);
                    ctx.fillStyle = '#eee';
                    ctx.fillRect(0, h - inputH, w, inputH);
                    ctx.strokeRect(0.5, h - inputH + 0.5, w - 1, inputH - 1);
                    ctx.fillStyle = '#888';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Шапка', w / 2, headH / 2);
                    ctx.fillText('Сообщения', w / 2, headH + (h - headH - inputH) / 2);
                    ctx.fillText('Ввод', w / 2, h - inputH / 2);
                    return;
                }
                if (zoneId === 'chat_empty') {
                    ctx.fillStyle = '#f0f0f0';
                    ctx.fillRect(2, 2, w - 4, h - 4);
                    ctx.strokeRect(2, 2, w - 4, h - 4);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Выберите чат', w / 2, h / 2);
                    return;
                }
                if (zoneId === 'chat_main') {
                    ctx.fillStyle = '#f2f2f2';
                    ctx.fillRect(2, 2, w - 4, h - 4);
                    ctx.strokeRect(2, 2, w - 4, h - 4);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Область чата (пусто / окно)', w / 2, h / 2);
                    return;
                }
                if (zoneId === 'sidebar_tabs') {
                    const tw = w / 2;
                    ctx.fillStyle = '#e8e8e8';
                    ctx.fillRect(2, 2, tw - 2, h - 4);
                    ctx.strokeRect(2, 2, tw - 2, h - 4);
                    ctx.fillStyle = '#ddd';
                    ctx.fillRect(tw, 2, tw - 2, h - 4);
                    ctx.strokeRect(tw + 0.5, 2, tw - 2.5, h - 4);
                    ctx.fillStyle = '#666';
                    ctx.fillText('Чаты', w / 4, h / 2);
                    ctx.fillText('Контакты', w * 3 / 4, h / 2);
                    return;
                }
                if (zoneId === 'chats_panel') {
                    const searchH = h * 0.15;
                    ctx.fillStyle = '#e8e8e8';
                    ctx.fillRect(2, 2, w - 4, searchH - 2);
                    ctx.strokeRect(2, 2, w - 4, searchH - 2);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Поиск чатов', w / 2, searchH / 2);
                    ctx.fillStyle = '#f0f0f0';
                    ctx.fillRect(2, searchH, w - 4, h - searchH - 2);
                    ctx.strokeRect(2, searchH + 0.5, w - 4, h - searchH - 2.5);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Список чатов', w / 2, searchH + (h - searchH) / 2);
                    return;
                }
                if (zoneId === 'contacts_panel') {
                    const searchH = h * 0.15;
                    ctx.fillStyle = '#e8e8e8';
                    ctx.fillRect(2, 2, w - 4, searchH - 2);
                    ctx.strokeRect(2, 2, w - 4, searchH - 2);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Поиск контактов', w / 2, searchH / 2);
                    ctx.fillStyle = '#f0f0f0';
                    ctx.fillRect(2, searchH, w - 4, h - searchH - 2);
                    ctx.strokeRect(2, searchH + 0.5, w - 4, h - searchH - 2.5);
                    ctx.fillStyle = '#999';
                    ctx.fillText('Список контактов', w / 2, searchH + (h - searchH) / 2);
                    return;
                }
                if (zoneId === 'sidebar') {
                    const tabH = h * 0.1;
                    ctx.fillStyle = '#e0e0e0';
                    ctx.fillRect(0, 0, w, tabH);
                    ctx.strokeRect(0.5, 0.5, w - 1, tabH - 1);
                    ctx.fillStyle = '#e8e8e8';
                    ctx.fillRect(0, tabH, w, h - tabH);
                    ctx.strokeRect(0.5, tabH + 0.5, w - 1, h - tabH - 1);
                    ctx.fillStyle = '#888';
                    ctx.font = '10px sans-serif';
                    ctx.fillText('Вкладки', w / 2, tabH / 2);
                    ctx.fillText('Список чатов / Контакты', w / 2, tabH + (h - tabH) / 2);
                    return;
                }
                // Остальные зоны — рамка и подпись
                ctx.fillStyle = '#eee';
                ctx.fillRect(2, 2, w - 4, h - 4);
                ctx.strokeRect(2, 2, w - 4, h - 4);
                ctx.fillStyle = '#888';
                ctx.fillText(zoneId, w / 2, h / 2);
            }

            // 1) Фон: при showLayout оставляем канвас прозрачным (под ним макет страницы); иначе лёгкий фон, чтобы тепловой слой был виден
            if (!showLayout) {
                ctx.fillStyle = '#f0f0f0';
                ctx.fillRect(0, 0, w, h);
            }

            // 2) В режиме по зоне страницу не перерисовываем — только тепловой слой (клики по зоне)

            // 3) Тепловой слой поверх (только клики по выбранной зоне в режиме по зоне, иначе все по странице)
            if (clicks.length) {
                clicks.forEach(function(c) {
                    const x = parseInt(c.gx, 10) * cellPxW;
                    const y = parseInt(c.gy, 10) * cellPxH;
                    const cnt = parseInt(c.cnt, 10);
                    const intensity = maxCnt > 0 ? Math.min(1, cnt / maxCnt) : 0;
                    const alpha = 0.2 + intensity * 0.7;
                    ctx.fillStyle = 'rgba(255, 80, 0, ' + alpha + ')';
                    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellPxW) + 1, Math.ceil(cellPxH) + 1);
                });
            }
        })();
        </script>
        <?php if ($zoneFilter !== '' && $zoneLabel !== ''): ?>
        <p class="admin-heatmap-zone-label">Зона: <strong><?= escape($zoneLabel) ?></strong></p>
        <?php endif; ?>
    <?php endif; ?>
</div>

<?php include __DIR__ . '/footer.php'; ?>
