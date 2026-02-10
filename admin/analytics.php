<?php
$pageTitle = 'Аналитика событий';
require_once __DIR__ . '/common.php';
global $pdo;

$typeFilter = $_GET['type'] ?? '';
$limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));

$sql = "
    SELECT ae.id, ae.event_type, ae.event_data, ae.coordinates_x, ae.coordinates_y, ae.timestamp, ae.screen_size, u.username
    FROM analytics_events ae
    LEFT JOIN users u ON ae.user_uuid = u.uuid
";
$params = [];
if ($typeFilter !== '') {
    $sql .= " WHERE ae.event_type = ?";
    $params[] = $typeFilter;
}
$sql .= " ORDER BY ae.timestamp DESC LIMIT " . $limit;
$stmt = $params ? $pdo->prepare($sql) : $pdo->query($sql);
if ($params) $stmt->execute($params);
$events = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Список типов для фильтра
$stmt = $pdo->query("SELECT DISTINCT event_type FROM analytics_events ORDER BY event_type");
$eventTypes = $stmt->fetchAll(PDO::FETCH_COLUMN);

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Аналитика событий</h1>

<div class="admin-filters">
    <label>
        Тип события:
        <select onchange="location.href='?type='+encodeURIComponent(this.value)+'&limit=<?= $limit ?>'">
            <option value="">Все</option>
            <?php foreach ($eventTypes as $t): ?>
                <option value="<?= escape($t) ?>" <?= $typeFilter === $t ? 'selected' : '' ?>><?= escape($t) ?></option>
            <?php endforeach; ?>
        </select>
    </label>
    <label>
        Показать:
        <select onchange="location.href='?type=<?= urlencode($typeFilter) ?>&limit='+this.value">
            <option value="20" <?= $limit === 20 ? 'selected' : '' ?>>20</option>
            <option value="50" <?= $limit === 50 ? 'selected' : '' ?>>50</option>
            <option value="100" <?= $limit === 100 ? 'selected' : '' ?>>100</option>
        </select>
    </label>
</div>

<div class="admin-table-wrap">
    <table class="admin-table">
        <thead>
            <tr>
                <th>Время</th>
                <th>Тип</th>
                <th>Пользователь</th>
                <th>Данные</th>
                <th>Координаты</th>
                <th>Экран</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($events as $row): ?>
                <tr>
                    <td><?= escape($row['timestamp']) ?></td>
                    <td><code><?= escape($row['event_type']) ?></code></td>
                    <td><?= escape($row['username'] ?? '—') ?></td>
                    <td><?= escape($row['event_data'] ?: '—') ?></td>
                    <td><?= ($row['coordinates_x'] !== null ? (int)$row['coordinates_x'] . ', ' . (int)$row['coordinates_y'] : '—') ?></td>
                    <td><?= escape($row['screen_size'] ?? '—') ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($events)): ?>
                <tr><td colspan="6">Нет событий</td></tr>
            <?php endif; ?>
        </tbody>
    </table>
</div>

<?php include __DIR__ . '/footer.php'; ?>
