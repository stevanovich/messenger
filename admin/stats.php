<?php
$pageTitle = 'Статистика';
require_once __DIR__ . '/common.php';
global $pdo;

$period = $_GET['period'] ?? '7';
$days = (int) $period;
if ($days < 1) $days = 7;
if ($days > 90) $days = 90;

// События по типам за период
$stmt = $pdo->prepare("
    SELECT event_type, COUNT(*) as cnt 
    FROM analytics_events 
    WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY event_type 
    ORDER BY cnt DESC 
    LIMIT 20
");
$stmt->execute([$days]);
$eventsByType = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Сообщения по дням
$stmt = $pdo->prepare("
    SELECT DATE(created_at) as d, COUNT(*) as cnt 
    FROM messages 
    WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY d 
    ORDER BY d
");
$stmt->execute([$days]);
$messagesByDay = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Активность по страницам (клики)
$stmt = $pdo->prepare("
    SELECT page, COUNT(*) as cnt 
    FROM analytics_clicks 
    WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY page 
    ORDER BY cnt DESC 
    LIMIT 15
");
$stmt->execute([$days]);
$clicksByPage = $stmt->fetchAll(PDO::FETCH_ASSOC);

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Статистика использования</h1>

<div class="admin-filters">
    <label>
        Период:
        <select onchange="location.href='?period='+this.value">
            <option value="7" <?= $period === '7' ? 'selected' : '' ?>>7 дней</option>
            <option value="14" <?= $period === '14' ? 'selected' : '' ?>>14 дней</option>
            <option value="30" <?= $period === '30' ? 'selected' : '' ?>>30 дней</option>
            <option value="90" <?= $period === '90' ? 'selected' : '' ?>>90 дней</option>
        </select>
    </label>
</div>

<div class="admin-table-wrap">
    <h3 style="margin: 0; padding: 1rem 1rem 0;">События по типам</h3>
    <table class="admin-table">
        <thead>
            <tr>
                <th>Тип события</th>
                <th>Количество</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($eventsByType as $row): ?>
                <tr>
                    <td><?= escape($row['event_type']) ?></td>
                    <td><?= (int) $row['cnt'] ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($eventsByType)): ?>
                <tr><td colspan="2">Нет данных</td></tr>
            <?php endif; ?>
        </tbody>
    </table>
</div>

<div class="admin-table-wrap">
    <h3 style="margin: 0; padding: 1rem 1rem 0;">Сообщения по дням</h3>
    <table class="admin-table">
        <thead>
            <tr>
                <th>Дата</th>
                <th>Сообщений</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($messagesByDay as $row): ?>
                <tr>
                    <td><?= escape($row['d']) ?></td>
                    <td><?= (int) $row['cnt'] ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($messagesByDay)): ?>
                <tr><td colspan="2">Нет данных</td></tr>
            <?php endif; ?>
        </tbody>
    </table>
</div>

<div class="admin-table-wrap">
    <h3 style="margin: 0; padding: 1rem 1rem 0;">Клики по страницам (тепловая карта)</h3>
    <table class="admin-table">
        <thead>
            <tr>
                <th>Страница</th>
                <th>Кликов</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($clicksByPage as $row): ?>
                <tr>
                    <td><code><?= escape($row['page']) ?></code></td>
                    <td><?= (int) $row['cnt'] ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (empty($clicksByPage)): ?>
                <tr><td colspan="2">Нет данных</td></tr>
            <?php endif; ?>
        </tbody>
    </table>
</div>

<?php include __DIR__ . '/footer.php'; ?>
