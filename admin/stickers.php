<?php
$pageTitle = 'Стикеры';
require_once __DIR__ . '/common.php';
global $pdo;

$stmt = $pdo->query("
    SELECT id, name, category, file_path, created_at
    FROM stickers
    ORDER BY category, name
");
$stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);

$baseUrl = defined('BASE_URL') ? BASE_URL : '/';
$categories = array_values(array_unique(array_filter(array_column($stickers, 'category'))));
sort($categories);

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">Стикеры</h1>

<div class="admin-stickers-add">
    <h3>Добавить стикер</h3>
    <form id="addStickerForm" class="admin-sticker-form">
        <div class="admin-sticker-form-row">
            <label>Файл (PNG, GIF, WebP, SVG, MP4 до 5 МБ)</label>
            <input type="file" name="file" id="stickerFile" accept="image/png,image/gif,image/webp,image/svg+xml,video/mp4" required>
        </div>
        <div class="admin-sticker-form-row">
            <label>Название</label>
            <input type="text" name="name" id="stickerName" placeholder="Например: Радость" required maxlength="100">
        </div>
        <div class="admin-sticker-form-row">
            <label>Категория</label>
            <input type="text" name="category" id="stickerCategory" placeholder="Например: Эмоции" list="stickerCategoriesList" maxlength="50">
            <datalist id="stickerCategoriesList">
                <?php foreach (['Эмоции', 'Реакции', 'Праздник', 'Эмодзи'] as $c): ?>
                <option value="<?= escape($c) ?>">
                <?php endforeach; ?>
                <?php foreach ($categories as $c): ?>
                <option value="<?= escape($c) ?>">
                <?php endforeach; ?>
            </datalist>
        </div>
        <button type="submit" class="admin-btn admin-btn-primary">Добавить</button>
    </form>
</div>

<div class="admin-stickers-grid-wrap">
    <h3>Набор стикеров (<?= count($stickers) ?>)</h3>
    <div class="admin-stickers-grid" id="stickersGrid">
        <?php foreach ($stickers as $s): ?>
        <div class="admin-sticker-card" data-id="<?= (int)$s['id'] ?>">
            <div class="admin-sticker-preview">
                <?php if (strpos($s['file_path'], 'emoji:') === 0): ?>
                    <span class="admin-sticker-emoji"><?= escape(substr($s['file_path'], 6)) ?></span>
                <?php elseif (preg_match('/\.(mp4|webm|mov)(\?|$)/i', $s['file_path'])): ?>
                    <video src="<?= escape($baseUrl . $s['file_path']) ?>" muted loop playsinline></video>
                <?php else: ?>
                    <img src="<?= escape($baseUrl . $s['file_path']) ?>" alt="<?= escape($s['name']) ?>" loading="lazy">
                <?php endif; ?>
            </div>
            <div class="admin-sticker-info">
                <span class="admin-sticker-name"><?= escape($s['name']) ?></span>
                <?php if (!empty($s['category'])): ?>
                    <span class="admin-sticker-category"><?= escape($s['category']) ?></span>
                <?php endif; ?>
            </div>
            <div class="admin-sticker-actions">
                <button type="button" class="admin-btn-edit-sticker" data-id="<?= (int)$s['id'] ?>" data-name="<?= escape($s['name']) ?>" data-category="<?= escape($s['category'] ?? '') ?>" title="Редактировать">✎</button>
                <button type="button" class="admin-btn-delete-sticker" data-id="<?= (int)$s['id'] ?>" data-name="<?= escape($s['name']) ?>" title="Удалить">×</button>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<div id="editStickerModal" class="admin-modal" style="display: none;">
    <div class="admin-modal-content">
        <h3>Редактировать стикер</h3>
        <form id="editStickerForm">
            <input type="hidden" id="editStickerId">
            <div class="admin-sticker-form-row">
                <label>Название</label>
                <input type="text" id="editStickerName" required maxlength="100">
            </div>
            <div class="admin-sticker-form-row">
                <label>Категория</label>
                <input type="text" id="editStickerCategory" maxlength="50" list="stickerCategoriesList">
            </div>
            <div class="admin-modal-buttons">
                <button type="submit" class="admin-btn admin-btn-primary">Сохранить</button>
                <button type="button" class="admin-btn admin-modal-close">Отмена</button>
            </div>
        </form>
    </div>
</div>

<style>
.admin-stickers-add { background: var(--bg-color,#fff); border: 1px solid var(--border-color,#ddd); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
.admin-stickers-add h3, .admin-stickers-grid-wrap h3 { margin: 0 0 1rem; font-size: 1.1rem; }
.admin-sticker-form { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
.admin-sticker-form-row { display: flex; flex-direction: column; gap: 0.25rem; }
.admin-sticker-form-row label { font-size: 0.85rem; color: var(--text-light,#666); }
.admin-sticker-form-row input[type="text"], .admin-sticker-form-row input[type="file"] { padding: 0.5rem; border: 1px solid var(--border-color,#ddd); border-radius: 8px; min-width: 150px; }
.admin-stickers-grid-wrap { background: var(--bg-color,#fff); border: 1px solid var(--border-color,#ddd); border-radius: 12px; padding: 1.5rem; }
.admin-stickers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1rem; }
.admin-sticker-card { border: 1px solid var(--border-color,#eee); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; align-items: center; padding: 0.75rem; position: relative; background: var(--bg-light,#fafafa); }
.admin-sticker-preview { width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.admin-sticker-preview img,
.admin-sticker-preview video { max-width: 80px; max-height: 80px; object-fit: contain; }
.admin-sticker-emoji { font-size: 3rem; }
.admin-sticker-info { margin-top: 0.5rem; text-align: center; font-size: 0.9rem; }
.admin-sticker-name { font-weight: 500; display: block; }
.admin-sticker-category { font-size: 0.8rem; color: var(--text-light,#666); }
.admin-sticker-actions { position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.25rem; }
.admin-sticker-actions button { width: 28px; height: 28px; border: none; border-radius: 6px; background: rgba(0,0,0,0.5); color: #fff; cursor: pointer; font-size: 1rem; line-height: 1; display: flex; align-items: center; justify-content: center; }
.admin-sticker-actions button:hover { background: rgba(0,0,0,0.7); }
.admin-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.admin-modal-content { background: #fff; border-radius: 12px; padding: 1.5rem; min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.admin-modal-content h3 { margin: 0 0 1rem; }
.admin-modal-buttons { display: flex; gap: 0.5rem; margin-top: 1rem; }
.admin-btn { padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border-color,#ddd); cursor: pointer; font-size: 0.95rem; }
.admin-btn-primary { background: var(--primary-color,#2196f3); color: #fff; border-color: var(--primary-color,#2196f3); }
</style>

<script>
(function() {
    const baseUrl = <?= json_encode($baseUrl) ?>;

    // Добавление стикера — один запрос: файл + name + category
    document.getElementById('addStickerForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const fileInput = document.getElementById('stickerFile');
        const nameInput = document.getElementById('stickerName');
        const categoryInput = document.getElementById('stickerCategory');
        if (!fileInput.files || !fileInput.files[0]) {
            alert('Выберите файл');
            return;
        }
        const name = nameInput.value.trim();
        if (!name) {
            alert('Укажите название');
            return;
        }
        const btn = this.querySelector('button[type="submit"]');
        btn.disabled = true;
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        fd.append('name', name);
        fd.append('category', categoryInput.value.trim());
        try {
            const r = await fetch(baseUrl + 'api/stickers.php?action=add', {
                method: 'POST',
                credentials: 'same-origin',
                body: fd
            });
            const rawText = await r.text();
            let d;
            try {
                d = JSON.parse(rawText);
            } catch (_) {
                alert('Ошибка ответа: ' + (rawText.slice(0, 150) || r.statusText));
                btn.disabled = false;
                return;
            }
            if (d.success) {
                location.reload();
            } else {
                alert(d.error || 'Ошибка (' + r.status + ')');
            }
        } catch (err) {
            alert('Ошибка: ' + (err.message || 'Сеть'));
        }
        btn.disabled = false;
    });

    // Редактирование
    const modal = document.getElementById('editStickerModal');
    document.querySelectorAll('.admin-btn-edit-sticker').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.getElementById('editStickerId').value = this.dataset.id;
            document.getElementById('editStickerName').value = this.dataset.name || '';
            document.getElementById('editStickerCategory').value = this.dataset.category || '';
            modal.style.display = 'flex';
        });
    });
    modal.querySelector('.admin-modal-close').addEventListener('click', function() {
        modal.style.display = 'none';
    });
    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.style.display = 'none';
    });
    document.getElementById('editStickerForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('editStickerId').value;
        const name = document.getElementById('editStickerName').value.trim();
        const category = document.getElementById('editStickerCategory').value.trim() || null;
        try {
            const r = await fetch(baseUrl + 'api/stickers.php', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ id: parseInt(id, 10), name, category })
            });
            const d = await r.json();
            if (d.success) {
                location.reload();
            } else {
                alert(d.error || 'Ошибка');
            }
        } catch (err) {
            alert('Ошибка сети');
        }
    });

    // Удаление
    document.querySelectorAll('.admin-btn-delete-sticker').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const id = this.dataset.id;
            const name = this.dataset.name;
            if (!confirm('Удалить стикер «' + name + '»?')) return;
            btn.disabled = true;
            fetch(baseUrl + 'api/stickers.php?id=' + encodeURIComponent(id), {
                method: 'DELETE',
                credentials: 'same-origin'
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    const card = document.querySelector('.admin-sticker-card[data-id="' + id + '"]');
                    if (card) card.remove();
                } else {
                    alert(d.error || 'Ошибка');
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
