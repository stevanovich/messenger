<?php
require_once __DIR__ . '/common.php';
$pageTitle = t('admin.emojis_page');
require_once __DIR__ . '/../includes/emojis.php';
global $pdo;

$emojis = get_supported_emojis_with_meta($pdo);
$categories = array_values(array_unique(array_column($emojis, 'category')));
sort($categories);
$baseUrl = defined('BASE_URL') ? BASE_URL : '/';

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title"><?= escape(t('admin.emojis_page')) ?></h1>
<p class="admin-description"><?= escape(t('admin.emojis_description')) ?></p>

<div class="admin-emojis-actions">
    <button type="button" id="syncFromConfig" class="admin-btn admin-btn-primary"><?= escape(t('admin.sync_from_config')) ?></button>
    <button type="button" id="syncStickers" class="admin-btn"><?= escape(t('admin.sync_stickers')) ?></button>
</div>
<div id="syncResult" class="admin-sync-result is-hidden"></div>

<div class="admin-emojis-filter">
    <label><?= escape(t('admin.category_name')) ?>:</label>
    <select id="filterCategory">
        <option value=""><?= escape(t('chat.all_category')) ?></option>
        <?php foreach ($categories as $c): ?>
        <option value="<?= escape($c) ?>"><?= escape($c) ?></option>
        <?php endforeach; ?>
    </select>
</div>

<div class="admin-emojis-grid-wrap">
    <div class="admin-emojis-grid" id="emojisGrid">
        <?php foreach ($emojis as $e): ?>
        <div class="admin-emoji-card" data-emoji="<?= escape($e['emoji']) ?>" data-keywords="<?= escape($e['keywords']) ?>" data-category="<?= escape($e['category']) ?>">
            <span class="admin-emoji-char"><?= $e['emoji'] ?></span>
            <span class="admin-emoji-category"><?= escape($e['category']) ?></span>
            <span class="admin-emoji-keywords" title="<?= escape($e['keywords']) ?>"><?= escape(mb_substr($e['keywords'], 0, 30)) ?><?= mb_strlen($e['keywords']) > 30 ? '…' : '' ?></span>
            <button type="button" class="admin-btn-edit-emoji" title="<?= escape(t('admin.edit_emoji')) ?>">✎</button>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<div id="editEmojiModal" class="admin-modal is-hidden">
    <div class="admin-modal-content">
        <h3><?= escape(t('admin.edit_emoji')) ?></h3>
        <form id="editEmojiForm">
            <input type="hidden" id="editEmojiChar">
            <div class="admin-form-row">
                <label><?= escape(t('chat.emoji_category')) ?></label>
                <span id="editEmojiPreview" class="admin-emoji-preview"></span>
            </div>
            <div class="admin-form-row">
                <label><?= escape(t('admin.keywords')) ?></label>
                <input type="text" id="editEmojiKeywords" maxlength="500" placeholder="smile happy">
            </div>
            <div class="admin-form-row">
                <label><?= escape(t('admin.category_name')) ?></label>
                <input type="text" id="editEmojiCategory" maxlength="64" list="emojiCategoriesList" placeholder="<?= escape(t('chat.emoji_category')) ?>">
                <datalist id="emojiCategoriesList">
                    <?php foreach ($categories as $c): ?>
                    <option value="<?= escape($c) ?>">
                    <?php endforeach; ?>
                </datalist>
            </div>
            <div class="admin-modal-buttons">
                <button type="submit" class="admin-btn admin-btn-primary"><?= escape(t('common.save')) ?></button>
                <button type="button" class="admin-btn admin-modal-close"><?= escape(t('common.cancel')) ?></button>
            </div>
        </form>
    </div>
</div>

<style>
.admin-description { color: var(--text-light, #666); margin-bottom: 1rem; }
.admin-emojis-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
.admin-sync-result { margin-bottom: 1rem; padding: 0.75rem; border-radius: 8px; background: var(--bg-light, #f5f5f5); }
.admin-sync-result-success { background: #e8f5e9; }
.admin-sync-result-error { background: #ffebee; }
.admin-emojis-filter { margin-bottom: 1rem; }
.admin-emojis-filter label { margin-right: 0.5rem; }
.admin-emojis-grid-wrap { background: var(--bg-color, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 12px; padding: 1rem; }
.admin-emojis-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.5rem; }
.admin-emoji-card { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-color, #eee); border-radius: 8px; background: var(--bg-light, #fafafa); position: relative; }
.admin-emoji-char { font-size: 1.8rem; flex-shrink: 0; }
.admin-emoji-category { font-size: 0.8rem; color: var(--text-light, #666); min-width: 4rem; }
.admin-emoji-keywords { font-size: 0.8rem; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.admin-btn-edit-emoji { position: absolute; top: 0.25rem; right: 0.25rem; width: 24px; height: 24px; border: none; border-radius: 4px; background: rgba(0,0,0,0.05); cursor: pointer; font-size: 0.9rem; }
.admin-btn-edit-emoji:hover { background: rgba(0,0,0,0.1); }
.admin-emoji-preview { font-size: 2rem; }
.admin-form-row { margin-bottom: 0.75rem; }
.admin-form-row label { display: block; font-size: 0.85rem; color: var(--text-light, #666); margin-bottom: 0.25rem; }
.admin-form-row input[type="text"] { width: 100%; padding: 0.5rem; border: 1px solid var(--border-color, #ddd); border-radius: 8px; }
</style>

<script>
(function() {
    const baseUrl = <?= json_encode($baseUrl) ?>;

    document.getElementById('syncFromConfig').addEventListener('click', async function() {
        const btn = this;
        btn.disabled = true;
        const resultEl = document.getElementById('syncResult');
        try {
            const r = await fetch(baseUrl + 'api/emojis.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=sync_all' });
            const d = await r.json();
            resultEl.classList.remove('is-hidden');
            if (d.success) {
                const se = d.data.supported_emojis || {};
                const st = d.data.stickers || {};
                resultEl.innerHTML = 'Добавлено в supported_emojis: ' + (se.inserted || 0) + '. Добавлено стикеров: ' + (st.inserted || 0) + (se.errors && se.errors.length ? '<br>Ошибки: ' + se.errors.join('; ') : '');
                resultEl.classList.remove('admin-sync-result-error'); resultEl.classList.add('admin-sync-result-success');
                setTimeout(() => location.reload(), 1500);
            } else {
                resultEl.textContent = d.error || 'Ошибка';
                resultEl.classList.remove('admin-sync-result-success'); resultEl.classList.add('admin-sync-result-error');
            }
        } catch (e) {
            resultEl.classList.remove('is-hidden');
            resultEl.textContent = 'Ошибка: ' + (e.message || 'Сеть');
            resultEl.classList.remove('admin-sync-result-success'); resultEl.classList.add('admin-sync-result-error');
        }
        btn.disabled = false;
    });

    document.getElementById('syncStickers').addEventListener('click', async function() {
        const btn = this;
        btn.disabled = true;
        const resultEl = document.getElementById('syncResult');
        try {
            const r = await fetch(baseUrl + 'api/emojis.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=sync_stickers' });
            const d = await r.json();
            resultEl.classList.remove('is-hidden');
            if (d.success) {
                const st = d.data.stickers || {};
                const parts = [];
                if (st.deleted_duplicates) parts.push('дубликатов удалено: ' + st.deleted_duplicates);
                if (st.inserted) parts.push('добавлено: ' + st.inserted);
                if (st.updated) parts.push('обновлено: ' + st.updated);
                resultEl.innerHTML = (parts.length ? 'Стикеры: ' + parts.join(', ') : 'Стикеры: без изменений') + (st.errors && st.errors.length ? '<br>Ошибки: ' + st.errors.slice(0, 5).join('; ') : '');
                resultEl.classList.remove('admin-sync-result-error'); resultEl.classList.add('admin-sync-result-success');
            } else {
                resultEl.textContent = d.error || 'Ошибка';
                resultEl.classList.remove('admin-sync-result-success'); resultEl.classList.add('admin-sync-result-error');
            }
        } catch (e) {
            resultEl.classList.remove('is-hidden');
            resultEl.textContent = 'Ошибка: ' + (e.message || 'Сеть');
            resultEl.classList.remove('admin-sync-result-success'); resultEl.classList.add('admin-sync-result-error');
        }
        btn.disabled = false;
    });

    const modal = document.getElementById('editEmojiModal');
    document.querySelectorAll('.admin-btn-edit-emoji').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const card = this.closest('.admin-emoji-card');
            if (!card) return;
            document.getElementById('editEmojiChar').value = card.dataset.emoji || '';
            document.getElementById('editEmojiPreview').textContent = card.dataset.emoji || '';
            document.getElementById('editEmojiKeywords').value = card.dataset.keywords || '';
            document.getElementById('editEmojiCategory').value = card.dataset.category || '';
            modal.classList.remove('is-hidden');
        });
    });
    modal.querySelector('.admin-modal-close').addEventListener('click', () => { modal.classList.add('is-hidden'); });
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.add('is-hidden'); });

    document.getElementById('editEmojiForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const emoji = document.getElementById('editEmojiChar').value;
        const keywords = document.getElementById('editEmojiKeywords').value.trim();
        const category = document.getElementById('editEmojiCategory').value.trim() || 'Эмодзи';
        try {
            const r = await fetch(baseUrl + 'api/emojis.php', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ emoji: emoji, keywords: keywords, category: category })
            });
            const d = await r.json();
            if (d.success) {
                let card = null;
                document.querySelectorAll('.admin-emoji-card').forEach(function(c) { if (c.dataset.emoji === emoji) card = c; });
                if (card) {
                    card.dataset.keywords = keywords;
                    card.dataset.category = category;
                    card.querySelector('.admin-emoji-category').textContent = category;
                    card.querySelector('.admin-emoji-keywords').textContent = keywords.length > 30 ? keywords.slice(0, 30) + '…' : keywords;
                    card.querySelector('.admin-emoji-keywords').title = keywords;
                }
                modal.classList.add('is-hidden');
            } else {
                alert(d.error || 'Ошибка');
            }
        } catch (err) {
            alert('Ошибка сети');
        }
    });

    document.getElementById('filterCategory').addEventListener('change', function() {
        const cat = this.value;
        document.querySelectorAll('.admin-emoji-card').forEach(function(card) {
            card.classList.toggle('is-hidden', cat && card.dataset.category !== cat);
        });
    });
})();
</script>

<?php include __DIR__ . '/footer.php'; ?>
