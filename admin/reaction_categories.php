<?php
require_once __DIR__ . '/common.php';
$pageTitle = t('admin.reaction_categories');
require_once __DIR__ . '/../includes/emojis.php';
require_once __DIR__ . '/../includes/locale.php';
global $pdo;
initLocale();
$currentLocale = function_exists('getLocale') ? getLocale() : 'ru';

$emojis = get_supported_emojis_with_meta($pdo, true);
try {
    $stmt = $pdo->query("
        SELECT id, name, category, file_path,
               COALESCE(sort_order, 0) AS sort_order,
               COALESCE(hidden, 0) AS hidden
        FROM stickers
        ORDER BY COALESCE(sort_order, 0), category, name
    ");
    $stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    $stmt = $pdo->query("SELECT id, name, category, file_path FROM stickers ORDER BY category, name");
    $stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($stickers as $i => $s) {
        $stickers[$i]['sort_order'] = 0;
        $stickers[$i]['hidden'] = 0;
    }
}

$dataCategories = array_values(array_unique(array_merge(
    array_filter(array_column($emojis, 'category')),
    array_filter(array_column($stickers, 'category'))
)));
ensure_reaction_categories_from_data($pdo);
$managedCategories = [];
$categoryDisplayNames = [];
try {
    try {
        $stmt = $pdo->query("SELECT name, sort_order, name_ru, name_en, name_sr, COALESCE(hidden, 0) AS hidden FROM reaction_categories ORDER BY sort_order, name");
    } catch (PDOException $e) {
        try {
            $stmt = $pdo->query("SELECT name, sort_order, name_ru, name_en, name_sr FROM reaction_categories ORDER BY sort_order, name");
        } catch (PDOException $e2) {
            $stmt = $pdo->query("SELECT name, sort_order FROM reaction_categories ORDER BY sort_order, name");
        }
    }
    $managedCategories = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($managedCategories as $i => $row) {
        if (!array_key_exists('hidden', $row)) {
            $managedCategories[$i]['hidden'] = 0;
        }
    }
    foreach ($managedCategories as $row) {
        $key = $row['name'];
        $locCol = 'name_' . $currentLocale;
        $display = (isset($row[$locCol]) && $row[$locCol] !== null && $row[$locCol] !== '') ? $row[$locCol] : $key;
        $categoryDisplayNames[$key] = $display;
    }
} catch (PDOException $e) {
    // таблица ещё не создана
}
$managedNames = array_column($managedCategories, 'name');
$categories = array_values(array_unique(array_merge($managedNames, $dataCategories)));
sort($categories);
$categories = array_values(array_unique($categories));

$byCategory = [];
foreach ($categories as $cat) {
    $byCategory[$cat] = ['emojis' => [], 'stickers' => []];
}
foreach ($emojis as $e) {
    $c = $e['category'] ?? 'Эмодзи';
    if (!isset($byCategory[$c])) {
        $byCategory[$c] = ['emojis' => [], 'stickers' => []];
    }
    $byCategory[$c]['emojis'][] = $e;
}
foreach ($stickers as $s) {
    $filePath = $s['file_path'] ?? '';
    if (strpos($filePath, 'emoji:') === 0) {
        continue;
    }
    $c = $s['category'] ?? '';
    if ($c === '') {
        $c = t('admin.no_category');
        if (!isset($byCategory[$c])) {
            $byCategory[$c] = ['emojis' => [], 'stickers' => []];
        }
    }
    $byCategory[$c]['stickers'][] = $s;
}
$orderNames = array_merge($managedNames, array_diff(array_keys($byCategory), $managedNames));
$byCategoryOrdered = [];
foreach ($orderNames as $n) {
    if (isset($byCategory[$n])) {
        $byCategoryOrdered[$n] = $byCategory[$n];
    }
    if (!isset($categoryDisplayNames[$n])) {
        $categoryDisplayNames[$n] = $n;
    }
}
$byCategory = $byCategoryOrdered;

$baseUrl = defined('BASE_URL') ? BASE_URL : '/';
$managedCategoriesByName = [];
foreach ($managedCategories as $r) {
    $managedCategoriesByName[$r['name']] = $r;
}

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title"><?= escape(t('admin.reaction_page')) ?></h1>

<div class="admin-reaction-menu" id="reactionMenu">
    <button type="button" id="btnAddCategory" class="admin-btn admin-btn-primary"><?= escape(t('admin.add_category')) ?></button>
    <button type="button" id="btnToggleKeywords" class="admin-btn"><?= escape(t('admin.show_description')) ?></button>
    <button type="button" id="btnExpandAll" class="admin-btn" title="<?= escape(t('admin.expand_all')) ?>"><?= escape(t('admin.expand_all')) ?></button>
    <button type="button" id="btnCollapseAll" class="admin-btn" title="<?= escape(t('admin.collapse_all')) ?>"><?= escape(t('admin.collapse_all')) ?></button>
    <div class="admin-reaction-menu-dropdown">
        <button type="button" id="btnEmojiDb" class="admin-btn" aria-expanded="false" aria-haspopup="true"><?= escape(t('admin.emoji_db')) ?> ▾</button>
        <div class="admin-reaction-menu-dropdown-panel" id="emojiDbDropdown" hidden>
            <button type="button" id="btnSaveEtalon" class="admin-btn admin-dropdown-item"><?= escape(t('admin.save_etalon')) ?></button>
            <button type="button" id="btnSyncFromConfig" class="admin-btn admin-dropdown-item"><?= escape(t('admin.sync_from_config')) ?></button>
            <button type="button" id="btnRestore" class="admin-btn admin-dropdown-item"><?= escape(t('admin.restore')) ?></button>
            <button type="button" id="btnRemoveDuplicates" class="admin-btn admin-dropdown-item"><?= escape(t('admin.remove_duplicates')) ?></button>
        </div>
    </div>
</div>
<div id="syncResult" class="admin-sync-result is-hidden"></div>

<div class="admin-reaction-toolbar-wrap is-hidden" id="bulkToolbarWrap">
<div class="admin-reaction-toolbar is-hidden" id="bulkToolbar">
    <span class="admin-reaction-selected-count" id="selectedCount"></span>
    <select id="bulkMoveCategory">
        <option value="">— <?= escape(t('admin.move_to_category')) ?> —</option>
        <?php foreach ($categories as $c): ?>
        <option value="<?= escape($c) ?>"><?= escape($c) ?></option>
        <?php endforeach; ?>
        <option value="__new__">+ <?= escape(t('admin.new_category')) ?></option>
    </select>
    <input type="text" id="bulkNewCategory" class="is-hidden" placeholder="<?= escape(t('admin.category_name')) ?>" maxlength="64">
    <button type="button" id="bulkMove" class="admin-btn"><?= escape(t('admin.move')) ?></button>
    <button type="button" id="bulkHide" class="admin-btn"><?= escape(t('admin.hide')) ?></button>
    <button type="button" id="bulkShow" class="admin-btn"><?= escape(t('admin.show')) ?></button>
    <button type="button" id="bulkDelete" class="admin-btn admin-btn-danger"><?= escape(t('common.delete')) ?></button>
</div>
</div>

<div id="addCategoryModal" class="admin-modal is-hidden" aria-labelledby="addCategoryModalTitle">
    <div class="admin-modal-content">
        <h3 id="addCategoryModalTitle" class="admin-reaction-manage-title"><?= escape(t('admin.add_category')) ?></h3>
        <div class="admin-reaction-categories-add">
            <input type="text" id="newCategoryName" placeholder="<?= escape(t('admin.category_name')) ?>" maxlength="64">
            <button type="button" id="addCategoryBtn" class="admin-btn admin-btn-primary"><?= escape(t('admin.add_category')) ?></button>
        </div>
        <div class="admin-modal-buttons">
            <button type="button" class="admin-btn admin-modal-close"><?= escape(t('common.close')) ?></button>
        </div>
    </div>
</div>

<div class="admin-reaction-by-category" id="reactionByCategory">
    <?php foreach ($byCategory as $catName => $items):
        $itemCount = count($items['emojis']) + count($items['stickers']);
    ?>
    <?php
        $displayName = $categoryDisplayNames[$catName] ?? $catName;
        $meta = $managedCategoriesByName[$catName] ?? null;
    ?>
    <?php $catHidden = isset($meta['hidden']) ? (int)$meta['hidden'] : 0; ?>
    <section class="admin-reaction-category-block admin-reaction-category-collapsed <?= $catHidden ? 'admin-reaction-category-hidden-in-chat' : '' ?>" data-category="<?= escape($catName) ?>" data-hidden-in-chat="<?= $catHidden ?>">
        <div class="admin-reaction-category-header">
            <button type="button" class="admin-reaction-category-toggle" aria-expanded="false" title="<?= escape(t('admin.expand_collapse')) ?>">▶</button>
            <span class="admin-reaction-category-title-text"><?= escape($displayName) ?></span>
            <span class="admin-reaction-category-count">(<?= $itemCount ?>)</span>
            <button type="button" class="admin-reaction-cat-btn admin-reaction-cat-hide-in-chat" data-category="<?= escape($catName) ?>" data-hidden="<?= $catHidden ?>" title="<?= $catHidden ? escape(t('admin.show_in_chat')) : escape(t('admin.hide_in_chat')) ?>" aria-label="<?= $catHidden ? escape(t('admin.show_in_chat')) : escape(t('admin.hide_in_chat')) ?>"><?= $catHidden ? '👁' : '👁‍🗨' ?></button>
            <div class="admin-reaction-category-actions">
                <button type="button" class="admin-reaction-cat-btn admin-reaction-cat-locales" data-category="<?= escape($catName) ?>" data-name-ru="<?= escape(($meta ?? [])['name_ru'] ?? '') ?>" data-name-en="<?= escape(($meta ?? [])['name_en'] ?? '') ?>" data-name-sr="<?= escape(($meta ?? [])['name_sr'] ?? '') ?>" title="<?= escape(t('admin.locale_names')) ?>">🌐</button>
                <button type="button" class="admin-reaction-cat-btn admin-reaction-cat-rename" data-category="<?= escape($catName) ?>" title="<?= escape(t('admin.rename')) ?>">✎</button>
                <button type="button" class="admin-reaction-cat-btn admin-reaction-cat-move-up" data-category="<?= escape($catName) ?>" title="<?= escape(t('admin.move_up')) ?>">↑</button>
                <button type="button" class="admin-reaction-cat-btn admin-reaction-cat-move-down" data-category="<?= escape($catName) ?>" title="<?= escape(t('admin.move_down')) ?>">↓</button>
                <button type="button" class="admin-reaction-cat-btn admin-reaction-cat-delete" data-category="<?= escape($catName) ?>" title="<?= escape(t('admin.delete_category')) ?>">×</button>
            </div>
        </div>
        <div class="admin-reaction-cards">
            <?php foreach ($items['emojis'] as $e): ?>
            <div class="admin-reaction-card admin-reaction-card-emoji <?= !empty($e['hidden']) ? 'is-hidden' : '' ?>"
                 data-type="emoji" data-emoji="<?= escape($e['emoji']) ?>"
                 data-keywords="<?= escape($e['keywords']) ?>"
                 data-category="<?= escape($e['category']) ?>"
                 data-sort-order="<?= (int)($e['sort_order'] ?? 0) ?>"
                 data-hidden="<?= (int)($e['hidden'] ?? 0) ?>">
                <input type="checkbox" class="admin-reaction-card-check" aria-label="<?= escape(t('admin.select')) ?>">
                <span class="admin-reaction-preview admin-reaction-emoji-char"><?= $e['emoji'] ?></span>
                <span class="admin-reaction-meta">
                    <span class="admin-reaction-keywords" title="<?= escape($e['keywords']) ?>"><?= escape(mb_substr($e['keywords'], 0, 25)) ?><?= mb_strlen($e['keywords'] ?? '') > 25 ? '…' : '' ?></span>
                </span>
                <?php if (!empty($e['hidden'])): ?><span class="admin-reaction-badge-hidden"><?= escape(t('admin.hidden')) ?></span><?php endif; ?>
                <button type="button" class="admin-btn-edit-card" title="<?= escape(t('admin.edit_emoji')) ?>">✎</button>
            </div>
            <?php endforeach; ?>
            <?php foreach ($items['stickers'] as $s): ?>
            <div class="admin-reaction-card admin-reaction-card-sticker <?= !empty($s['hidden']) ? 'is-hidden' : '' ?>"
                 data-type="sticker" data-id="<?= (int)$s['id'] ?>"
                 data-name="<?= escape($s['name']) ?>"
                 data-category="<?= escape($s['category'] ?? '') ?>"
                 data-sort-order="<?= (int)($s['sort_order'] ?? 0) ?>"
                 data-hidden="<?= (int)($s['hidden'] ?? 0) ?>">
                <input type="checkbox" class="admin-reaction-card-check" aria-label="<?= escape(t('admin.select')) ?>">
                <div class="admin-reaction-preview">
                    <?php if (strpos($s['file_path'], 'emoji:') === 0): ?>
                        <span class="admin-reaction-emoji-char"><?= escape(substr($s['file_path'], 6)) ?></span>
                    <?php elseif (preg_match('/\.(mp4|webm|mov)(\?|$)/i', $s['file_path'])): ?>
                        <video src="<?= escape($baseUrl . $s['file_path']) ?>" muted loop playsinline></video>
                    <?php else: ?>
                        <img src="<?= escape($baseUrl . $s['file_path']) ?>" alt="" loading="lazy">
                    <?php endif; ?>
                </div>
                <span class="admin-reaction-meta">
                    <span class="admin-reaction-name"><?= escape($s['name']) ?></span>
                </span>
                <?php if (!empty($s['hidden'])): ?><span class="admin-reaction-badge-hidden"><?= escape(t('admin.hidden')) ?></span><?php endif; ?>
                <button type="button" class="admin-btn-edit-card" title="<?= escape(t('admin.edit_emoji')) ?>">✎</button>
            </div>
            <?php endforeach; ?>
        </div>
    </section>
    <?php endforeach; ?>
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
                <input type="text" id="editEmojiKeywords" maxlength="500">
            </div>
            <div class="admin-form-row">
                <label><?= escape(t('admin.category_name')) ?></label>
                <input type="text" id="editEmojiCategory" maxlength="64" list="emojiCategoriesList">
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

<div id="categoryLocalesModal" class="admin-modal is-hidden">
    <div class="admin-modal-content">
        <h3>Названия категории по языкам</h3>
        <p class="admin-modal-hint">Оставьте пустым — будет использоваться ключ категории для всех языков. Заполните нужные поля для отдельных названий.</p>
        <form id="categoryLocalesForm">
            <input type="hidden" id="localeCategoryName">
            <div class="admin-form-row">
                <label>Ключ категории</label>
                <span id="localeCategoryKey" class="admin-form-readonly"></span>
            </div>
            <div class="admin-form-row">
                <label>RU (русский)</label>
                <input type="text" id="localeNameRu" maxlength="64" placeholder="Одно для всех, если пусто">
            </div>
            <div class="admin-form-row">
                <label>EN (English)</label>
                <input type="text" id="localeNameEn" maxlength="64">
            </div>
            <div class="admin-form-row">
                <label>SR (српски)</label>
                <input type="text" id="localeNameSr" maxlength="64">
            </div>
            <div class="admin-modal-buttons">
                <button type="submit" class="admin-btn admin-btn-primary">Сохранить</button>
                <button type="button" class="admin-btn admin-modal-close">Отмена</button>
            </div>
        </form>
    </div>
</div>

<div id="editStickerModal" class="admin-modal is-hidden">
    <div class="admin-modal-content">
        <h3>Редактировать стикер</h3>
        <form id="editStickerForm">
            <input type="hidden" id="editStickerId">
            <div class="admin-form-row">
                <label>Название</label>
                <input type="text" id="editStickerName" required maxlength="100">
            </div>
            <div class="admin-form-row">
                <label>Категория</label>
                <input type="text" id="editStickerCategory" maxlength="50" list="stickerCategoriesList">
                <datalist id="stickerCategoriesList">
                    <?php foreach (array_keys($byCategory) as $c): ?>
                    <option value="<?= escape($c) ?>">
                    <?php endforeach; ?>
                </datalist>
            </div>
            <div class="admin-modal-buttons">
                <button type="submit" class="admin-btn admin-btn-primary">Сохранить</button>
                <button type="button" class="admin-btn admin-modal-close">Отмена</button>
            </div>
        </form>
    </div>
</div>

<style>
.admin-sync-result { margin-bottom: 1rem; padding: 0.75rem; border-radius: 8px; background: var(--bg-light, #f5f5f5); }
.admin-sync-result-success { background: #e8f5e9; }
.admin-sync-result-error { background: #ffebee; }
.admin-reaction-menu { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
.admin-reaction-menu-dropdown { position: relative; }
.admin-reaction-menu-dropdown-panel { position: absolute; top: 100%; left: 0; margin-top: 2px; background: var(--bg-color, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 200; display: flex; flex-direction: column; min-width: 180px; }
.admin-reaction-menu-dropdown-panel[hidden] { display: none; }
.admin-dropdown-item { border-radius: 0; text-align: left; justify-content: flex-start; border: none; background: none; width: 100%; }
.admin-dropdown-item:hover { background: var(--bg-light, #f0f0f0); }
.admin-reaction-manage-title { margin: 0 0 0.75rem; font-size: 1rem; }
.admin-reaction-categories-add { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.admin-reaction-categories-add input { padding: 0.5rem; border: 1px solid var(--border-color, #ddd); border-radius: 8px; min-width: 200px; }
body.admin-reaction-keywords-hidden .admin-reaction-keywords { display: none !important; }
.admin-reaction-category-block { margin-bottom: 0.5rem; border: 1px solid var(--border-color, #eee); border-radius: 8px; overflow: hidden; }
.admin-reaction-category-block.admin-reaction-category-collapsed .admin-reaction-cards { display: none; }
.admin-reaction-category-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: var(--bg-light, #f5f5f5); cursor: pointer; user-select: none; }
.admin-reaction-category-header:hover { background: var(--secondary-color, #eee); }
.admin-reaction-category-toggle { width: 24px; height: 24px; padding: 0; border: none; background: none; cursor: pointer; font-size: 0.75rem; flex-shrink: 0; }
.admin-reaction-category-block:not(.admin-reaction-category-collapsed) .admin-reaction-category-toggle { transform: rotate(90deg); }
.admin-reaction-category-title-text { font-weight: 600; font-size: 1rem; flex: 1; }
.admin-reaction-category-count { color: var(--text-light, #666); font-size: 0.9rem; }
.admin-reaction-category-actions { display: flex; gap: 0.25rem; }
.admin-reaction-cat-btn { width: 28px; height: 28px; padding: 0; border: none; border-radius: 4px; background: rgba(0,0,0,0.06); cursor: pointer; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.admin-reaction-cat-btn:hover { background: rgba(0,0,0,0.12); }
.admin-reaction-cat-delete { color: #c62828; }
.admin-reaction-cat-delete:hover { background: rgba(198,40,40,0.15); }
.admin-reaction-category-block.admin-reaction-category-hidden-in-chat .admin-reaction-category-header { opacity: 0.9; }
.admin-reaction-category-block .admin-reaction-cards { padding: 0.75rem; border-top: 1px solid var(--border-color, #eee); }
.admin-reaction-toolbar-wrap { position: sticky; top: 0; z-index: 100; margin-bottom: 1rem; background: var(--bg-light, #f5f5f5); }
.admin-reaction-toolbar-wrap:empty { display: none; }
.admin-reaction-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0; padding: 0.75rem; background: var(--bg-light, #f5f5f5); border-radius: 8px; border: 1px solid var(--border-color, #eee); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.admin-reaction-selected-count { font-weight: 600; margin-right: 0.5rem; }
.admin-reaction-toolbar select { padding: 0.35rem 0.5rem; border-radius: 6px; }
.admin-reaction-toolbar input[type="text"] { padding: 0.35rem 0.5rem; width: 180px; border-radius: 6px; }
.admin-btn-danger { background: #c62828; color: #fff; border-color: #c62828; }
.admin-reaction-card { display: inline-block; align-items: center; margin-bottom: 0.4rem; padding: 0.5rem; border: 1px solid var(--border-color, #eee); border-radius: 8px; background: var(--bg-color, #fff); position: relative; min-height: 56px; }
.admin-reaction-card.is-hidden { opacity: 0.7; background: var(--bg-light, #fafafa); }
.admin-reaction-card.dragging { opacity: 0.5; }
.admin-reaction-card-check { vertical-align: top; margin: 0; cursor: default; }
.admin-reaction-card.admin-reaction-card-emoji,
.admin-reaction-card.admin-reaction-card-sticker { cursor: grab; user-select: none; vertical-align: top; padding-right: 2em;}
.admin-reaction-card.admin-reaction-card-emoji:active,
.admin-reaction-card.admin-reaction-card-sticker:active { cursor: grabbing; }
.admin-reaction-card .admin-reaction-card-check,
.admin-reaction-card .admin-btn-edit-card { cursor: pointer; }
.admin-reaction-preview { display: inline-block; align-items: center; justify-content: center; flex-shrink: 0; }
.admin-reaction-preview img, .admin-reaction-preview video { max-width: 160px; object-fit: contain; }
.admin-reaction-emoji-char { font-size: 1.75rem; }
.admin-reaction-preview .twemoji { height: 1.75rem; width: auto; vertical-align: middle; }
.admin-reaction-meta { flex: 1; min-width: 0; font-size: 0.8rem; }
.admin-reaction-keywords, .admin-reaction-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-reaction-badge-hidden { font-size: 0.7rem; color: #999; }
.admin-btn-edit-card { position: absolute; top: 0.25rem; right: 0.25rem; width: 26px; height: 26px; border: none; border-radius: 4px; background: rgba(0,0,0,0.06); cursor: pointer; font-size: 0.85rem; }
.admin-btn-edit-card:hover { background: rgba(0,0,0,0.12); }
.admin-emoji-preview { font-size: 2rem; }
.admin-form-row { margin-bottom: 0.75rem; }
.admin-form-row label { display: block; font-size: 0.85rem; color: var(--text-light, #666); margin-bottom: 0.25rem; }
.admin-form-row input[type="text"] { width: 100%; padding: 0.5rem; border: 1px solid var(--border-color, #ddd); border-radius: 8px; }
.admin-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.admin-modal-content { background: #fff; border-radius: 12px; padding: 1.5rem; min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.admin-modal-content h3 { margin: 0 0 1rem; }
.admin-modal-buttons { display: flex; gap: 0.5rem; margin-top: 1rem; }
.admin-modal-hint { font-size: 0.85rem; color: var(--text-light, #666); margin: 0 0 1rem; }
.admin-form-readonly { display: inline-block; padding: 0.35rem 0; font-weight: 500; }
</style>

<script>
(function() {
    const baseUrl = <?= json_encode($baseUrl) ?>;
    const adminShowInChat = <?= json_encode(t('admin.show_in_chat')) ?>;
    const adminHideInChat = <?= json_encode(t('admin.hide_in_chat')) ?>;
    const adminShowDescription = <?= json_encode(t('admin.show_description')) ?>;
    const adminHideDescription = <?= json_encode(t('admin.hide_description')) ?>;

    function api(path, opts) {
        return fetch(baseUrl + path, { credentials: 'same-origin', ...opts }).then(r => r.json());
    }

    document.getElementById('btnAddCategory').addEventListener('click', function() {
        document.getElementById('addCategoryModal').classList.remove('is-hidden');
        document.getElementById('newCategoryName').value = '';
        document.getElementById('newCategoryName').focus();
    });
    document.getElementById('addCategoryModal').querySelector('.admin-modal-close').addEventListener('click', function() {
        document.getElementById('addCategoryModal').classList.add('is-hidden');
    });
    document.getElementById('addCategoryModal').addEventListener('click', function(e) {
        if (e.target === this) this.classList.add('is-hidden');
    });

    document.body.classList.add('admin-reaction-keywords-hidden');
    function updateToggleKeywordsBtn() {
        const btn = document.getElementById('btnToggleKeywords');
        if (btn) btn.textContent = document.body.classList.contains('admin-reaction-keywords-hidden') ? adminShowDescription : adminHideDescription;
    }
    updateToggleKeywordsBtn();
    document.getElementById('btnToggleKeywords').addEventListener('click', function() {
        document.body.classList.toggle('admin-reaction-keywords-hidden');
        updateToggleKeywordsBtn();
    });

    document.getElementById('btnEmojiDb').addEventListener('click', function(e) {
        e.stopPropagation();
        const panel = document.getElementById('emojiDbDropdown');
        const open = !panel.hidden;
        panel.hidden = open;
        this.setAttribute('aria-expanded', !open);
    });
    document.addEventListener('click', function() {
        document.getElementById('emojiDbDropdown').hidden = true;
        document.getElementById('btnEmojiDb').setAttribute('aria-expanded', 'false');
    });
    document.getElementById('emojiDbDropdown').addEventListener('click', function(e) { e.stopPropagation(); });

    function showSyncResult(msg, isError) {
        const el = document.getElementById('syncResult');
        el.classList.remove('is-hidden');
        el.classList.remove('admin-sync-result-error', 'admin-sync-result-success');
        el.classList.add(isError ? 'admin-sync-result-error' : 'admin-sync-result-success');
        el.innerHTML = msg;
    }
    document.getElementById('btnSaveEtalon').addEventListener('click', async function() {
        document.getElementById('emojiDbDropdown').hidden = true;
        this.disabled = true;
        try {
            const r = await fetch(baseUrl + 'api/emojis.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_etalon' }) });
            const d = await r.json();
            if (d.success) {
                showSyncResult(d.message || 'Эталон сохранён в config/supported_emojis.php', false);
            } else {
                showSyncResult(d.error || 'Ошибка', true);
            }
        } catch (e) {
            showSyncResult('Ошибка: ' + (e.message || 'Сеть'), true);
        }
        this.disabled = false;
    });
    function doSyncFromConfig(btn) {
        document.getElementById('emojiDbDropdown').hidden = true;
        btn.disabled = true;
        api('api/emojis.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=sync_supported' })
            .then(function(d) {
                showSyncResult(d.success ? 'Восстановлено из config. Записей: ' + (d.data?.supported_emojis?.inserted ?? 0) : (d.error || 'Ошибка'), !d.success);
                if (d.success) setTimeout(() => location.reload(), 1200);
            })
            .catch(function(e) {
                showSyncResult('Ошибка: ' + (e.message || 'Сеть'), true);
            })
            .finally(function() { btn.disabled = false; });
    }
    document.getElementById('btnSyncFromConfig').addEventListener('click', function() { doSyncFromConfig(this); });
    document.getElementById('btnRestore').addEventListener('click', function() { doSyncFromConfig(this); });
    document.getElementById('btnRemoveDuplicates').addEventListener('click', async function() {
        document.getElementById('emojiDbDropdown').hidden = true;
        if (!confirm('Найти дубликаты в config/supported_emojis.php и удалить записи с меньшим числом ключевых слов? Файл будет перезаписан.')) return;
        this.disabled = true;
        try {
            const r = await fetch(baseUrl + 'api/emojis.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_duplicates' }) });
            const d = await r.json().catch(() => ({}));
            if (d.success) {
                showSyncResult('Удалено дубликатов: ' + (d.data?.removed ?? 0) + ', записей осталось: ' + (d.data?.kept ?? 0), false);
                setTimeout(() => location.reload(), 2000);
            } else {
                showSyncResult(d.error || 'Ошибка', true);
            }
        } catch (e) {
            showSyncResult('Ошибка: ' + (e.message || 'Сеть'), true);
        }
        this.disabled = false;
    });

    function getSelected() {
        const emojis = [], stickers = [];
        document.querySelectorAll('.admin-reaction-card-check:checked').forEach(cb => {
            const card = cb.closest('.admin-reaction-card');
            if (!card) return;
            if (card.dataset.type === 'emoji') emojis.push(card.dataset.emoji);
            else stickers.push(parseInt(card.dataset.id, 10));
        });
        return { emojis, stickers };
    }
    function updateToolbar() {
        const { emojis, stickers } = getSelected();
        const n = emojis.length + stickers.length;
        const toolbar = document.getElementById('bulkToolbar');
        const wrap = document.getElementById('bulkToolbarWrap');
        const countEl = document.getElementById('selectedCount');
        if (n === 0) {
            if (toolbar) toolbar.classList.add('is-hidden');
            if (wrap) wrap.classList.add('is-hidden');
            return;
        }
        if (toolbar) toolbar.classList.remove('is-hidden');
        if (wrap) wrap.classList.remove('is-hidden');
        countEl.textContent = 'Выбрано: ' + n;
    }
    document.querySelectorAll('.admin-reaction-card-check').forEach(cb => {
        cb.addEventListener('change', updateToolbar);
    });

    document.getElementById('bulkMoveCategory').addEventListener('change', function() {
        document.getElementById('bulkNewCategory').classList.toggle('is-hidden', this.value !== '__new__');
    });
    document.getElementById('bulkMove').addEventListener('click', async function() {
        const { emojis, stickers } = getSelected();
        if (emojis.length + stickers.length === 0) return;
        let category = document.getElementById('bulkMoveCategory').value;
        if (category === '__new__') {
            category = document.getElementById('bulkNewCategory').value.trim();
            if (!category) { alert('Введите название категории'); return; }
        } else if (!category) {
            alert('Выберите категорию'); return;
        }
        if (emojis.length) {
            const d = await api('api/emojis.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'move_category', emojis, category }) });
            if (!d.success) { alert(d.error || 'Ошибка эмодзи'); return; }
        }
        if (stickers.length) {
            const d = await api('api/stickers.php?action=bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'move_category', ids: stickers, category }) });
            if (!d.success) { alert(d.error || 'Ошибка стикеров'); return; }
        }
        location.reload();
    });
    document.getElementById('bulkHide').addEventListener('click', async function() {
        const { emojis, stickers } = getSelected();
        if (emojis.length) await api('api/emojis.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'hide', emojis }) });
        if (stickers.length) await api('api/stickers.php?action=bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'hide', ids: stickers }) });
        if (emojis.length || stickers.length) location.reload();
    });
    document.getElementById('bulkShow').addEventListener('click', async function() {
        const { emojis, stickers } = getSelected();
        if (emojis.length) await api('api/emojis.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'show', emojis }) });
        if (stickers.length) await api('api/stickers.php?action=bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'show', ids: stickers }) });
        if (emojis.length || stickers.length) location.reload();
    });
    document.getElementById('bulkDelete').addEventListener('click', async function() {
        const { emojis, stickers } = getSelected();
        if (emojis.length + stickers.length === 0) return;
        if (!confirm('Удалить выбранные элементы? Эмодзи будут удалены из перечня, стикеры — безвозвратно.')) return;
        if (emojis.length) await api('api/emojis.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'delete', emojis }) });
        if (stickers.length) await api('api/stickers.php?action=bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', bulk_action: 'delete', ids: stickers }) });
        location.reload();
    });

    document.getElementById('addCategoryBtn').addEventListener('click', async function() {
        const input = document.getElementById('newCategoryName');
        const name = input.value.trim();
        if (!name) {
            alert('Введите название категории');
            return;
        }
        const d = await api('api/reaction_categories.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        if (d.success) {
            document.getElementById('addCategoryModal').classList.add('is-hidden');
            input.value = '';
            location.reload();
        } else {
            alert(d.error || 'Ошибка');
        }
    });
    document.getElementById('newCategoryName').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('addCategoryBtn').click();
    });

    document.querySelectorAll('.admin-reaction-category-header').forEach(header => {
        header.addEventListener('click', function(e) {
            if (e.target.closest('.admin-reaction-category-actions')) return;
            const block = this.closest('.admin-reaction-category-block');
            block.classList.toggle('admin-reaction-category-collapsed');
            const toggle = this.querySelector('.admin-reaction-category-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', block.classList.contains('admin-reaction-category-collapsed') ? 'false' : 'true');
        });
    });
    document.getElementById('btnExpandAll').addEventListener('click', function() {
        document.querySelectorAll('#reactionByCategory .admin-reaction-category-block').forEach(block => {
            block.classList.remove('admin-reaction-category-collapsed');
            const toggle = block.querySelector('.admin-reaction-category-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'true');
        });
    });
    document.getElementById('btnCollapseAll').addEventListener('click', function() {
        document.querySelectorAll('#reactionByCategory .admin-reaction-category-block').forEach(block => {
            block.classList.add('admin-reaction-category-collapsed');
            const toggle = block.querySelector('.admin-reaction-category-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
    });
    document.querySelectorAll('.admin-reaction-cat-locales').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const cat = this.dataset.category;
            document.getElementById('localeCategoryName').value = cat;
            document.getElementById('localeCategoryKey').textContent = cat;
            document.getElementById('localeNameRu').value = this.dataset.nameRu || '';
            document.getElementById('localeNameEn').value = this.dataset.nameEn || '';
            document.getElementById('localeNameSr').value = this.dataset.nameSr || '';
            document.getElementById('categoryLocalesModal').classList.remove('is-hidden');
        });
    });
    document.getElementById('categoryLocalesModal').querySelector('.admin-modal-close').addEventListener('click', function() {
        document.getElementById('categoryLocalesModal').classList.add('is-hidden');
    });
    document.getElementById('categoryLocalesModal').addEventListener('click', function(e) {
        if (e.target === this) this.classList.add('is-hidden');
    });
    document.getElementById('categoryLocalesForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const name = document.getElementById('localeCategoryName').value;
        const d = await api('api/reaction_categories.php', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                name_ru: document.getElementById('localeNameRu').value.trim() || '',
                name_en: document.getElementById('localeNameEn').value.trim() || '',
                name_sr: document.getElementById('localeNameSr').value.trim() || ''
            })
        });
        if (d.success) location.reload();
        else alert(d.error || 'Ошибка');
    });

    document.querySelectorAll('.admin-reaction-cat-rename').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const cat = this.dataset.category;
            if (!cat) return;
            const newName = prompt('Новое название категории:', cat);
            if (newName === null || newName.trim() === '') return;
            if (newName.trim() === cat) return;
            const d = await api('api/reaction_categories.php', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old_name: cat, new_name: newName.trim() }) });
            if (d.success) location.reload();
            else alert(d.error || 'Ошибка');
        });
    });
    document.querySelectorAll('.admin-reaction-cat-move-up').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const block = this.closest('.admin-reaction-category-block');
            const prev = block.previousElementSibling;
            if (!prev || !prev.classList.contains('admin-reaction-category-block')) return;
            const container = block.parentElement;
            container.insertBefore(block, prev);
            saveCategoryOrder();
        });
    });
    document.querySelectorAll('.admin-reaction-cat-move-down').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const block = this.closest('.admin-reaction-category-block');
            const next = block.nextElementSibling;
            if (!next || !next.classList.contains('admin-reaction-category-block')) return;
            const container = block.parentElement;
            container.insertBefore(next, block);
            saveCategoryOrder();
        });
    });
    async function saveCategoryOrder() {
        const blocks = document.querySelectorAll('#reactionByCategory .admin-reaction-category-block');
        const order = Array.from(blocks).map((b, i) => ({ name: b.dataset.category, sort_order: i }));
        try {
            const d = await api('api/reaction_categories.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', order }) });
            if (!d.success) {
                console.error('Порядок категорий:', d.error || 'Ошибка');
            }
        } catch (e) {
            console.error('Порядок категорий:', e.message || 'Ошибка сети');
        }
    }
    document.querySelectorAll('.admin-reaction-cat-hide-in-chat').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const cat = this.dataset.category;
            if (!cat) return;
            const currentlyHidden = this.dataset.hidden === '1';
            const newHidden = currentlyHidden ? 0 : 1;
            const d = await api('api/reaction_categories.php', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cat, hidden: newHidden }) });
            if (d.success) {
                const block = this.closest('.admin-reaction-category-block');
                if (block) {
                    block.classList.toggle('admin-reaction-category-hidden-in-chat', newHidden === 1);
                    block.dataset.hiddenInChat = String(newHidden);
                }
                this.dataset.hidden = String(newHidden);
                this.title = newHidden ? adminShowInChat : adminHideInChat;
                this.setAttribute('aria-label', this.title);
                this.textContent = newHidden ? '👁' : '👁‍🗨';
            } else {
                alert(d.error || 'Ошибка');
            }
        });
    });
    document.querySelectorAll('.admin-reaction-cat-delete').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const cat = this.dataset.category;
            if (!cat) return;
            if (!confirm('Удалить категорию «' + cat + '»? Все элементы будут перенесены в «Эмодзи».')) return;
            const d = await api('api/reaction_categories.php?name=' + encodeURIComponent(cat), { method: 'DELETE' });
            if (d.success) location.reload();
            else alert(d.error || 'Ошибка');
        });
    });

    document.querySelectorAll('.admin-btn-edit-card').forEach(btn => {
        btn.addEventListener('click', function() {
            const card = this.closest('.admin-reaction-card');
            if (!card) return;
            if (card.dataset.type === 'emoji') {
                document.getElementById('editEmojiChar').value = card.dataset.emoji || '';
                document.getElementById('editEmojiPreview').textContent = card.dataset.emoji || '';
                document.getElementById('editEmojiKeywords').value = card.dataset.keywords || '';
                document.getElementById('editEmojiCategory').value = card.dataset.category || '';
                document.getElementById('editEmojiModal').classList.remove('is-hidden');
            } else {
                document.getElementById('editStickerId').value = card.dataset.id || '';
                document.getElementById('editStickerName').value = card.dataset.name || '';
                document.getElementById('editStickerCategory').value = card.dataset.category || '';
                document.getElementById('editStickerModal').classList.remove('is-hidden');
            }
        });
    });
    document.querySelectorAll('.admin-modal-close').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.admin-modal').classList.add('is-hidden');
        });
    });
    document.querySelectorAll('.admin-modal').forEach(modal => {
        modal.addEventListener('click', function(e) { if (e.target === this) this.classList.add('is-hidden'); });
    });
    document.getElementById('editEmojiForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const emoji = document.getElementById('editEmojiChar').value;
        const keywords = document.getElementById('editEmojiKeywords').value.trim();
        const category = document.getElementById('editEmojiCategory').value.trim() || 'Эмодзи';
        const d = await api('api/emojis.php', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji, keywords, category }) });
        if (d.success) location.reload();
        else alert(d.error || 'Ошибка');
    });
    document.getElementById('editStickerForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = parseInt(document.getElementById('editStickerId').value, 10);
        const name = document.getElementById('editStickerName').value.trim();
        const category = document.getElementById('editStickerCategory').value.trim() || null;
        const d = await api('api/stickers.php', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, category }) });
        if (d.success) location.reload();
        else alert(d.error || 'Ошибка');
    });

    function initSortable(container) {
        if (!container) return;
        let dragged = null;
        container.querySelectorAll('.admin-reaction-card').forEach(card => {
            card.draggable = true;
            card.addEventListener('dragstart', function(e) {
                if (e.target.closest('.admin-reaction-card-check, .admin-btn-edit-card')) {
                    e.preventDefault();
                    return;
                }
                dragged = this;
                e.dataTransfer.setData('text/plain', this.dataset.type + (this.dataset.emoji || this.dataset.id));
                this.classList.add('dragging');
            });
            card.addEventListener('dragend', function() {
                this.classList.remove('dragging');
                dragged = null;
            });
        });
        container.addEventListener('dragover', function(e) {
            e.preventDefault();
            const card = e.target.closest('.admin-reaction-card');
            if (!card || card === dragged || card.dataset.type !== dragged?.dataset?.type) return;
            const cards = Array.from(container.querySelectorAll('.admin-reaction-card-' + dragged.dataset.type));
            const idx = cards.indexOf(card);
            const dragIdx = cards.indexOf(dragged);
            if (idx === -1 || idx === dragIdx) return;
            const next = idx > dragIdx ? cards[idx].nextElementSibling : cards[idx];
            if (next) container.insertBefore(dragged, next);
            else container.appendChild(dragged);
        });
        container.addEventListener('drop', function(e) {
            e.preventDefault();
            if (!dragged) return;
            const type = dragged.dataset.type;
            const selector = type === 'emoji' ? '.admin-reaction-card-emoji' : '.admin-reaction-card-sticker';
            const order = Array.from(document.querySelectorAll(selector)).map((c, i) =>
                type === 'emoji' ? { emoji: c.dataset.emoji, sort_order: i } : { id: parseInt(c.dataset.id, 10), sort_order: i }
            );
            const url = type === 'emoji' ? 'api/emojis.php' : 'api/stickers.php?action=reorder';
            api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', order }) });
        });
    }
    document.querySelectorAll('.admin-reaction-cards').forEach(initSortable);

    function parseTwemojiInAdmin() {
        if (document.body && document.body.dataset.twemojiEnabled === '1' && typeof twemoji !== 'undefined') {
            var el = document.getElementById('reactionByCategory');
            if (el) twemoji.parse(el, { folder: 'svg', ext: '.svg', className: 'twemoji' });
        }
    }
    if (document.readyState === 'loading') {
        window.addEventListener('load', parseTwemojiInAdmin);
    } else {
        parseTwemojiInAdmin();
    }
})();
</script>

<?php include __DIR__ . '/footer.php'; ?>
