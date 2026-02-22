<?php
session_start();
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/locale.php';
initLocale();

$pageTitle = t('common.documentation');
$minimalFooter = true;
$isDocPage = true;

include __DIR__ . '/includes/header.php';

$docBase = rtrim(BASE_URL, '/') . '/documentation.php';
?>

<div class="doc-page">
    <div class="doc-sidebar-backdrop" id="docSidebarBackdrop" aria-hidden="true"></div>
    <aside class="doc-sidebar" id="docSidebar">
        <h2 class="doc-sidebar-title"><?php echo escape(t('common.documentation')); ?></h2>
        <nav class="doc-nav">
            <a href="<?php echo escape($docBase); ?>?f=USER_GUIDE_INDEX.md">Оглавление</a>
            <a href="<?php echo escape($docBase); ?>?f=user-guide-account.md">Учётная запись и настройки</a>
            <a href="<?php echo escape($docBase); ?>?f=user-guide-chat.md">Переписка</a>
            <a href="<?php echo escape($docBase); ?>?f=user-guide-calls.md">Звонки</a>
            <a href="<?php echo escape($docBase); ?>?f=user-guide-privacy-e2ee.md">Конфиденциальность и E2EE</a>
            <a href="<?php echo escape($docBase); ?>?f=user-guide-notifications.md">Уведомления и обновления</a>
            <a href="<?php echo escape($docBase); ?>?f=user-guide-interface.md">Интерфейс и ограничения</a>
        </nav>
    </aside>
    <main class="doc-main">
        <div id="docContent" class="doc-content">
            <p><?php echo escape(t('common.loading')); ?>…</p>
        </div>
    </main>
</div>

<style>
.doc-page { display: flex; min-height: calc(100vh - 52px); }
.doc-sidebar {
    width: 240px; flex-shrink: 0;
    background: var(--surface, #f5f5f5); border-right: 1px solid var(--border, #ddd);
    padding: 1rem; overflow-y: auto;
}
.doc-sidebar-title { font-size: 1rem; margin: 0 0 0.75rem; font-weight: 600; }
.doc-nav { display: flex; flex-direction: column; gap: 0.25rem; }
.doc-nav a {
    padding: 0.4rem 0.5rem; border-radius: 6px; text-decoration: none; color: inherit;
}
.doc-nav a:hover { background: var(--border, #e0e0e0); }
.doc-main { flex: 1; overflow-y: auto; padding: 1.5rem; }
.doc-content {
    max-width: 720px; margin: 0 auto;
    line-height: 1.6; font-size: 0.95rem;
}
.doc-content h1 { font-size: 1.5rem; margin-top: 0; }
.doc-content h2 { font-size: 1.25rem; margin-top: 1.5rem; border-bottom: 1px solid var(--border, #eee); padding-bottom: 0.25rem; }
.doc-content h3 { font-size: 1.1rem; margin-top: 1.25rem; }
.doc-content h4 { font-size: 1rem; margin-top: 1rem; }
.doc-content p { margin: 0.75rem 0; }
.doc-content ul, .doc-content ol { margin: 0.75rem 0; padding-left: 1.5rem; }
.doc-content li { margin: 0.25rem 0; }
.doc-content table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
.doc-content th, .doc-content td { border: 1px solid var(--border, #ddd); padding: 0.5rem 0.75rem; text-align: left; }
.doc-content th { background: var(--surface, #f9f9f9); font-weight: 600; }
.doc-content code { background: var(--surface, #f0f0f0); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
.doc-content pre { background: var(--surface, #f5f5f5); padding: 1rem; border-radius: 6px; overflow-x: auto; }
.doc-content pre code { background: none; padding: 0; }
.doc-content a { color: var(--link, #0066cc); }
.doc-content hr { border: none; border-top: 1px solid var(--border, #eee); margin: 1.5rem 0; }
.doc-error { color: var(--error, #c00); }

.doc-sidebar-backdrop { display: none; }

@media (max-width: 768px) {
    .doc-page { flex-direction: column; position: relative; }
    .doc-sidebar-backdrop {
        display: none; position: fixed; inset: 0; z-index: 10;
        background: rgba(0,0,0,0.4);
    }
    .doc-page.doc-sidebar-open .doc-sidebar-backdrop { display: block; }
    .doc-sidebar {
        position: fixed; top: 0; left: 0; bottom: 0; z-index: 11;
        width: 260px; max-width: 85vw; transform: translateX(-100%);
        transition: transform 0.2s ease; will-change: transform;
        border-right: 1px solid var(--border, #ddd); box-shadow: 2px 0 8px rgba(0,0,0,0.1);
    }
    .doc-page.doc-sidebar-open .doc-sidebar { transform: translateX(0); }
    .doc-main { padding-top: 3rem; }
}
</style>
<script>
(function() {
    var page = document.querySelector('.doc-page');
    var toggle = document.getElementById('docSidebarToggle');
    var sidebar = document.getElementById('docSidebar');
    var backdrop = document.getElementById('docSidebarBackdrop');
    if (!page || !toggle) return;
    function open() {
        page.classList.add('doc-sidebar-open');
        toggle.setAttribute('aria-expanded', 'true');
        backdrop.setAttribute('aria-hidden', 'false');
    }
    function close() {
        page.classList.remove('doc-sidebar-open');
        toggle.setAttribute('aria-expanded', 'false');
        backdrop.setAttribute('aria-hidden', 'true');
    }
    function toggleSidebar() {
        page.classList.toggle('doc-sidebar-open');
        var open = page.classList.contains('doc-sidebar-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    toggle.addEventListener('click', toggleSidebar);
    backdrop.addEventListener('click', close);
    sidebar.querySelectorAll('.doc-nav a').forEach(function(a) {
        a.addEventListener('click', function() {
            if (window.innerWidth <= 768) close();
        });
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && page.classList.contains('doc-sidebar-open')) close();
    });
    window.docCloseSidebar = close;
})();
</script>

<?php include __DIR__ . '/includes/footer.php'; ?>
