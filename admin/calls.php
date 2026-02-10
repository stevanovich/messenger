<?php
/**
 * Админка: сброс активных звонков (завершение для всех или для выбранных пользователей).
 */
$pageTitle = 'Звонки';
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/../includes/call_reset.php';
global $pdo;

$message = '';
$messageType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $action = $_POST['action'];
    $sendWs = !empty($_POST['send_ws']);
    $userUuids = [];

    if ($action === 'reset_all') {
        $userUuids = [];
    } elseif ($action === 'reset_users' && !empty($_POST['user_uuids'])) {
        $input = trim((string) $_POST['user_uuids']);
        $userUuids = array_values(array_filter(array_map('trim', preg_split('/[\s,;]+/', $input))));
        if (empty($userUuids)) {
            $message = 'Укажите хотя бы один UUID пользователя.';
            $messageType = 'error';
        }
    }

    if ($message === '' && ($action === 'reset_all' || ($action === 'reset_users' && !empty($userUuids)))) {
        $result = resetActiveCalls([
            'user_uuids' => $userUuids,
            'dry_run' => false,
            'send_ws' => $sendWs,
            'source' => 'admin',
        ]);
        if ($result['error'] !== null) {
            $message = 'Ошибка: ' . escape($result['error']);
            $messageType = 'error';
        } else {
            $total = $result['call_logs_count'] + $result['group_calls_count'];
            if ($total === 0) {
                $message = 'Активных звонков не было.';
                $messageType = 'success';
            } else {
                $message = 'Сброшено: звонков 1-на-1 — ' . $result['call_logs_count'] . ', групповых — ' . $result['group_calls_count'] . '.';
                if ($sendWs) {
                    $message .= ' Клиентам отправлены события завершения.';
                }
                $messageType = 'success';
            }
        }
    }
}

$counts = getActiveCallsCount();
include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Звонки</h1>

<?php if ($message !== ''): ?>
<div class="admin-message admin-message--<?= $messageType === 'error' ? 'error' : 'success' ?>">
    <?= $message ?>
</div>
<?php endif; ?>

<div class="admin-cards" style="margin-bottom: 1.5rem;">
    <div class="admin-card">
        <div class="admin-card-title">Активных звонков 1-на-1</div>
        <div class="admin-card-value"><?= (int) $counts['call_logs'] ?></div>
    </div>
    <div class="admin-card">
        <div class="admin-card-title">Активных групповых звонков</div>
        <div class="admin-card-value"><?= (int) $counts['group_calls'] ?></div>
    </div>
</div>

<div class="admin-section">
    <h2 class="admin-section-title">Сбросить активные звонки</h2>
    <p class="admin-hint">Завершает звонки в БД, добавляет сообщение в беседы и при необходимости отправляет клиентам события (call.end / call.group.ended), чтобы интерфейс обновился.</p>

    <div class="admin-form-group" style="margin-top: 1rem;">
        <form method="post" action="" class="admin-inline-form" onsubmit="return confirm('Завершить все активные звонки для всех пользователей?');">
            <input type="hidden" name="action" value="reset_all">
            <label class="admin-checkbox-label">
                <input type="checkbox" name="send_ws" value="1" checked>
                Отправить события в WebSocket (клиенты закроют панель звонка)
            </label>
            <button type="submit" class="admin-btn admin-btn-primary">Сбросить все активные звонки</button>
        </form>
    </div>

    <form method="post" action="" class="admin-form" style="margin-top: 1.5rem;">
        <input type="hidden" name="action" value="reset_users">
        <div class="admin-form-row">
            <label for="user_uuids" class="admin-label">Сбросить только звонки с участием пользователей (UUID через запятую или пробел):</label>
            <textarea id="user_uuids" name="user_uuids" class="admin-input" rows="2" placeholder="uuid-1, uuid-2 (из /api/auth.php?action=me)"></textarea>
        </div>
        <div class="admin-form-row">
            <label class="admin-checkbox-label">
                <input type="checkbox" name="send_ws" value="1" checked>
                Отправить события в WebSocket
            </label>
        </div>
        <div class="admin-form-row">
            <button type="submit" class="btn btn-secondary">Сбросить звонки для выбранных</button>
        </div>
    </form>
</div>

<p class="admin-hint" style="margin-top: 1.5rem;">
    Тот же функционал из CLI: <code>php tools/reset_active_calls.php --all</code> или <code>--user=uuid1,uuid2</code>, опции <code>--dry-run</code>, <code>--no-ws</code>.
</p>

<?php include __DIR__ . '/footer.php'; ?>
