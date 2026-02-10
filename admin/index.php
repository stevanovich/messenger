<?php
$pageTitle = 'Дашборд';
require_once __DIR__ . '/common.php';
global $pdo;

$stats = [
    'users' => 0,
    'messages' => 0,
    'conversations' => 0,
    'events_today' => 0,
    'clicks_today' => 0,
];

$stmt = $pdo->query("SELECT COUNT(*) FROM users");
$stats['users'] = (int) $stmt->fetchColumn();

$stmt = $pdo->query("SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL");
$stats['messages'] = (int) $stmt->fetchColumn();

$stmt = $pdo->query("SELECT COUNT(*) FROM conversations");
$stats['conversations'] = (int) $stmt->fetchColumn();

$stmt = $pdo->prepare("SELECT COUNT(*) FROM analytics_events WHERE DATE(timestamp) = CURDATE()");
$stmt->execute();
$stats['events_today'] = (int) $stmt->fetchColumn();

$stmt = $pdo->prepare("SELECT COUNT(*) FROM analytics_clicks WHERE DATE(timestamp) = CURDATE()");
$stmt->execute();
$stats['clicks_today'] = (int) $stmt->fetchColumn();

// Сообщения за последние 7 дней для графика
$messagesByDay = [];
for ($i = 6; $i >= 0; $i--) {
    $date = date('Y-m-d', strtotime("-$i days"));
    $stmt = $pdo->prepare("
        SELECT COUNT(*) FROM messages 
        WHERE deleted_at IS NULL AND DATE(created_at) = ?
    ");
    $stmt->execute([$date]);
    $messagesByDay[] = ['date' => $date, 'count' => (int) $stmt->fetchColumn()];
}

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Статистика использования</h1>

<div class="admin-cards">
    <div class="admin-card">
        <div class="admin-card-title">Пользователей</div>
        <div class="admin-card-value"><?= $stats['users'] ?></div>
    </div>
    <div class="admin-card">
        <div class="admin-card-title">Сообщений</div>
        <div class="admin-card-value"><?= $stats['messages'] ?></div>
    </div>
    <div class="admin-card">
        <div class="admin-card-title">Бесед</div>
        <div class="admin-card-value"><?= $stats['conversations'] ?></div>
    </div>
    <div class="admin-card">
        <div class="admin-card-title">Событий сегодня</div>
        <div class="admin-card-value"><?= $stats['events_today'] ?></div>
    </div>
    <div class="admin-card">
        <div class="admin-card-title">Кликов сегодня</div>
        <div class="admin-card-value"><?= $stats['clicks_today'] ?></div>
    </div>
</div>

<div class="admin-chart-wrap">
    <h3 style="margin: 0 0 1rem;">Сообщения за 7 дней</h3>
    <canvas id="chartMessages" width="400" height="200"></canvas>
</div>

<script>
window.addEventListener('load', function() {
    const data = <?= json_encode(array_column($messagesByDay, 'count')) ?>;
    const labels = <?= json_encode(array_map(function($d) { return date('d.m', strtotime($d['date'])); }, $messagesByDay)) ?>;
    const ctx = document.getElementById('chartMessages');
    if (ctx && typeof Chart !== 'undefined') {
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Сообщений',
                    data: data,
                    backgroundColor: 'rgba(33, 150, 243, 0.5)',
                    borderColor: 'rgb(33, 150, 243)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
});
</script>

<?php include __DIR__ . '/footer.php'; ?>
