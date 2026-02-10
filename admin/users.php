<?php
$pageTitle = 'Учётные записи';
require_once __DIR__ . '/common.php';
global $pdo;

$stmt = $pdo->query("
    SELECT uuid, username, avatar, created_at, last_seen, visible_in_contacts
    FROM users
    ORDER BY username
");
$users = $stmt->fetchAll(PDO::FETCH_ASSOC);

$currentUserUuid = $_SESSION['user_uuid'] ?? '';
$baseUrl = defined('BASE_URL') ? BASE_URL : '/';

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Учётные записи</h1>

<div class="admin-table-wrap">
    <table class="admin-table">
        <thead>
            <tr>
                <th>Пользователь</th>
                <th>Регистрация</th>
                <th>Последний вход</th>
                <th>В контактах</th>
                <th>Действия</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($users as $u): ?>
            <tr data-user-uuid="<?= escape($u['uuid']) ?>">
                <td>
                    <div class="admin-user-cell">
                        <?php if (!empty($u['avatar'])): ?>
                            <img src="<?= escape($u['avatar']) ?>" alt="" class="admin-user-avatar">
                        <?php else: ?>
                            <span class="admin-user-avatar-placeholder"><?= escape(mb_substr($u['username'], 0, 1)) ?></span>
                        <?php endif; ?>
                        <span><?= escape($u['username']) ?></span>
                    </div>
                </td>
                <td><?= escape(date('d.m.Y H:i', strtotime($u['created_at']))) ?></td>
                <td><?= empty($u['last_seen']) ? '—' : escape(formatTime($u['last_seen'])) ?></td>
                <td class="admin-visible-in-contacts-cell">
                    <?php
                    $visible = isset($u['visible_in_contacts']) ? (int)$u['visible_in_contacts'] : 1;
                    ?>
                    <button type="button" class="admin-btn-toggle-contacts <?= $visible ? 'is-visible' : 'is-hidden' ?>" data-uuid="<?= escape($u['uuid']) ?>" data-visible="<?= $visible ?>" title="<?= $visible ? 'Скрыть из контактов' : 'Показать в контактах' ?>">
                        <?= $visible ? 'Да' : 'Нет' ?>
                    </button>
                </td>
                <td>
                    <?php if ($u['uuid'] === $currentUserUuid): ?>
                        <span class="admin-badge">Вы</span>
                    <?php else: ?>
                        <button type="button" class="admin-btn-delete" data-uuid="<?= escape($u['uuid']) ?>" data-username="<?= escape($u['username']) ?>" title="Удалить">
                            Удалить
                        </button>
                    <?php endif; ?>
                </td>
            </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
</div>

<script>
(function() {
    const baseUrl = <?= json_encode($baseUrl) ?>;
    document.querySelectorAll('.admin-btn-delete').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const uuid = this.dataset.uuid;
            const username = this.dataset.username;
            if (!confirm('Удалить учётную запись «' + username + '»?\n\nБудут удалены все сообщения, беседы и данные этого пользователя. Действие необратимо.')) {
                return;
            }
            btn.disabled = true;
            fetch(baseUrl + 'api/users.php?uuid=' + encodeURIComponent(uuid), {
                method: 'DELETE',
                credentials: 'same-origin'
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    const row = document.querySelector('tr[data-user-uuid="' + uuid.replace(/"/g, '\\"') + '"]');
                    if (row) row.remove();
                } else {
                    alert(data.error || 'Ошибка при удалении');
                    btn.disabled = false;
                }
            })
            .catch(function() {
                alert('Ошибка сети');
                btn.disabled = false;
            });
        });
    });
    document.querySelectorAll('.admin-btn-toggle-contacts').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const uuid = this.dataset.uuid;
            const nextVisible = this.dataset.visible === '1' ? 0 : 1;
            btn.disabled = true;
            fetch(baseUrl + 'api/users.php?uuid=' + encodeURIComponent(uuid), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ visible_in_contacts: nextVisible === 1 })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    btn.dataset.visible = String(nextVisible);
                    btn.textContent = nextVisible === 1 ? 'Да' : 'Нет';
                    btn.classList.toggle('is-visible', nextVisible === 1);
                    btn.classList.toggle('is-hidden', nextVisible === 0);
                    btn.title = nextVisible === 1 ? 'Скрыть из контактов' : 'Показать в контактах';
                } else {
                    alert(data.error || 'Ошибка');
                }
                btn.disabled = false;
            })
            .catch(function() {
                alert('Ошибка сети');
                btn.disabled = false;
            });
        });
    });
})();
</script>

<?php include __DIR__ . '/footer.php'; ?>
