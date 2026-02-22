<?php
/**
 * Фрейм для макета тепловой карты: отдаёт страницу фиксированного размера
 * (800×600 для десктопа, 375×667 для мобильных при ?device=mobile).
 * Доступ только для админов.
 */
require_once __DIR__ . '/common.php';

$page = isset($_GET['page']) ? (string) $_GET['page'] : '';
$allowed = ['login', 'register', 'chats', 'chat', 'call', 'join'];
if (!in_array($page, $allowed, true)) {
    $page = 'login';
}
if ($page === 'chat') {
    $page = 'chats';
}
$device = isset($_GET['device']) ? (string) $_GET['device'] : 'desktop';
$isMobileFrame = ($device === 'mobile');
$frameW = $isMobileFrame ? 375 : 800;
$frameH = $isMobileFrame ? 667 : 600;

$heatmapConversations = [];
$heatmapSelectedConv = null;
$heatmapSelectedMessages = [];
$testUserUuid = null;

if ($page === 'chats') {
    $stmt = $pdo->prepare("SELECT uuid FROM users WHERE username = ?");
    $stmt->execute(['test']);
    $testUserUuid = $stmt->fetchColumn();
    if ($testUserUuid) {
        $stmt = $pdo->prepare("
            SELECT c.id, c.type, c.name, c.avatar,
                (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
                (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_time
            FROM conversations c
            INNER JOIN conversation_participants cp ON c.id = cp.conversation_id AND cp.hidden_at IS NULL
            WHERE cp.user_uuid = ?
            ORDER BY last_message_time DESC, c.created_at DESC
            LIMIT 20
        ");
        $stmt->execute([$testUserUuid]);
        $heatmapConversations = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($heatmapConversations as &$conv) {
            if ($conv['type'] === 'private') {
                $stmt = $pdo->prepare("SELECT u.username, u.display_name, u.avatar FROM conversation_participants cp JOIN users u ON cp.user_uuid = u.uuid WHERE cp.conversation_id = ? AND cp.user_uuid != ?");
                $stmt->execute([$conv['id'], $testUserUuid]);
                $other = $stmt->fetch(PDO::FETCH_ASSOC);
                if ($other) {
                    $conv['other_user'] = $other;
                    if (empty($conv['name'])) {
                        $conv['name'] = !empty($other['display_name']) ? $other['display_name'] : $other['username'];
                    }
                    if (empty($conv['avatar'])) {
                        $conv['avatar'] = $other['avatar'] ?? null;
                    }
                }
            }
        }
        unset($conv);

        if (!empty($heatmapConversations)) {
            $heatmapSelectedConv = $heatmapConversations[0];
            $convId = (int) $heatmapSelectedConv['id'];
            $stmt = $pdo->prepare("
                SELECT m.id, m.user_uuid, m.content, m.created_at, m.type, u.username
                FROM messages m
                LEFT JOIN users u ON m.user_uuid = u.uuid
                WHERE m.conversation_id = ? AND m.deleted_at IS NULL
                ORDER BY m.created_at DESC
                LIMIT 15
            ");
            $stmt->execute([$convId]);
            $heatmapSelectedMessages = array_reverse($stmt->fetchAll(PDO::FETCH_ASSOC));
        }
    }
}

header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: SAMEORIGIN');
?>
<!DOCTYPE html>
<html lang="<?= escape(getLocale()) ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=<?= (int)$frameW ?>, height=<?= (int)$frameH ?>">
    <title><?= escape(t('admin.heatmaps')) ?></title>
    <link rel="stylesheet" href="<?= BASE_URL ?>assets/css/main.css?v=<?= file_exists(__DIR__ . '/../assets/css/main.css') ? filemtime(__DIR__ . '/../assets/css/main.css') : '0' ?>">
    <?php if ($page === 'chats'): ?>
    <link rel="stylesheet" href="<?= BASE_URL ?>assets/css/chat.css?v=<?= file_exists(__DIR__ . '/../assets/css/chat.css') ? filemtime(__DIR__ . '/../assets/css/chat.css') : '0' ?>">
    <?php endif; ?>
    <style>
        body { margin: 0; overflow: hidden; }
        .heatmap-frame-view { width: <?= (int)$frameW ?>px; height: <?= (int)$frameH ?>px; position: relative; overflow: hidden; }
        .heatmap-frame-view .auth-container { min-height: <?= (int)$frameH ?>px; }
        .heatmap-frame-view .call-room-container,
        .heatmap-frame-view .call-room-panel { height: 100%; }
        /* Чат: как на реальной странице — навбар + контент, чтобы вёрстка и тепловая карта совпадали */
        .heatmap-frame-view.heatmap-frame-view--chats { display: flex; flex-direction: column; }
        .heatmap-frame-view--chats .main-nav-placeholder { height: <?= $isMobileFrame ? '50' : '58' ?>px; min-height: <?= $isMobileFrame ? '50' : '58' ?>px; flex-shrink: 0; background: var(--bg-color); border-bottom: 1px solid var(--border-color); }
        .heatmap-frame-view--chats .messenger-container { width: <?= (int)$frameW ?>px; flex: 1; min-height: 0; height: auto; }
        .heatmap-frame-view:not(.heatmap-frame-view--chats) .messenger-container { width: <?= (int)$frameW ?>px; height: <?= (int)$frameH ?>px; }
    </style>
</head>
<body>
<div class="heatmap-frame-view<?= $page === 'chats' ? ' heatmap-frame-view--chats' : '' ?>">
<?php if ($page === 'login'): ?>
    <div class="auth-container">
        <div class="auth-box">
            <h1><?= escape(t('login.heading')) ?></h1>
            <form method="post" action="#">
                <div class="form-group">
                    <label for="hm-username"><?= escape(t('login.username')) ?></label>
                    <input type="text" id="hm-username" value="test" readonly tabindex="-1">
                </div>
                <div class="form-group">
                    <label for="hm-password"><?= escape(t('login.password')) ?></label>
                    <input type="password" id="hm-password" value="••••••••" readonly tabindex="-1">
                </div>
                <button type="button" class="btn btn-primary"><?= escape(t('login.submit')) ?></button>
            </form>
            <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
            <div class="auth-oauth">
                <span class="auth-oauth-divider"><?= escape(t('login.oauth_or')) ?></span>
                <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
                <span class="btn btn-oauth btn-oauth-google"><img src="<?= BASE_URL ?>assets/img/oauth-google.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?= escape(t('login.google')) ?></span>
                <?php endif; ?>
                <?php if (!empty(YANDEX_CLIENT_ID)): ?>
                <span class="btn btn-oauth btn-oauth-yandex"><img src="<?= BASE_URL ?>assets/img/oauth-yandex.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?= escape(t('login.yandex')) ?></span>
                <?php endif; ?>
            </div>
            <?php endif; ?>
            <p class="auth-link"><?= escape(t('login.no_account')) ?> <a href="#"><?= escape(t('login.register_link')) ?></a></p>
        </div>
    </div>
<?php elseif ($page === 'register'): ?>
    <div class="auth-container">
        <div class="auth-box">
            <h1><?= escape(t('register.heading')) ?></h1>
            <form method="post" action="#">
                <div class="form-group">
                    <label for="hm-reg-username"><?= escape(t('register.username')) ?></label>
                    <input type="text" id="hm-reg-username" value="test" readonly tabindex="-1">
                </div>
                <div class="form-group">
                    <label for="hm-reg-password"><?= escape(t('register.password')) ?></label>
                    <input type="password" id="hm-reg-password" value="••••••••" readonly tabindex="-1">
                </div>
                <div class="form-group">
                    <label for="hm-reg-password2"><?= escape(t('register.confirm_password')) ?></label>
                    <input type="password" id="hm-reg-password2" value="••••••••" readonly tabindex="-1">
                </div>
                <button type="button" class="btn btn-primary"><?= escape(t('register.submit')) ?></button>
            </form>
            <p class="auth-link"><?= escape(t('register.have_account')) ?> <a href="#"><?= escape(t('register.go_login')) ?></a></p>
        </div>
    </div>
<?php elseif ($page === 'chats'): ?>
    <nav class="main-nav-placeholder" aria-hidden="true"></nav>
    <div class="messenger-container">
        <div class="chats-sidebar">
            <div class="sidebar-tabs">
                <button type="button" class="sidebar-tab active" disabled><?= escape(t('chat.tabs_chats')) ?></button>
                <button type="button" class="sidebar-tab" disabled><?= escape(t('chat.tabs_contacts')) ?></button>
            </div>
            <div class="chats-panel">
                <div class="chats-panel-scroll">
                    <div class="chats-search">
                        <input type="text" placeholder="<?= escape(t('chat.search_chats')) ?>" readonly tabindex="-1">
                    </div>
                    <div class="chats-list">
                        <?php if (empty($heatmapConversations)): ?>
                        <div class="chats-empty-placeholder"><?= escape(t('chat.no_chats')) ?></div>
                        <?php else: ?>
                        <?php foreach ($heatmapConversations as $idx => $conv): ?>
                        <?php
                        $name = $conv['name'] ?? ($conv['other_user']['display_name'] ?? $conv['other_user']['username'] ?? t('chat.conversation_default'));
                        $lastMsg = $conv['last_message'] ?? '';
                        if (mb_strlen($lastMsg) > 40) $lastMsg = mb_substr($lastMsg, 0, 37) . '…';
                        $avatarLetter = mb_strtoupper(mb_substr($name, 0, 1));
                        $avatar = $conv['avatar'] ?? ($conv['other_user']['avatar'] ?? null);
                        $isActive = ($heatmapSelectedConv && (int)$heatmapSelectedConv['id'] === (int)$conv['id']);
                        ?>
                        <div class="chat-item-row<?= $isActive ? ' active' : '' ?>" data-conversation-id="<?= (int)$conv['id'] ?>">
                            <div class="chat-item chat-item-swipe-content">
                                <div class="chat-item-avatar<?= $conv['type'] === 'group' ? ' chat-item-avatar-group' : '' ?>"><?= $avatar ? '<img src="' . escape($avatar) . '" alt="">' : escape($avatarLetter) ?></div>
                                <div class="chat-item-info">
                                    <div class="chat-item-name"><?= escape($name) ?></div>
                                    <div class="chat-item-last-message"><?= escape($lastMsg) ?></div>
                                </div>
                                <div class="chat-item-meta"></div>
                            </div>
                        </div>
                        <?php endforeach; ?>
                        <?php endif; ?>
                    </div>
                </div>
                <button type="button" class="btn-new-chat" disabled title="<?= escape(t('chat.new_chat')) ?>" aria-label="<?= escape(t('chat.new_chat')) ?>"><span class="btn-new-chat-icon" aria-hidden="true">+</span></button>
            </div>
            <div class="contacts-panel is-hidden"></div>
        </div>
        <div class="chat-main">
            <div class="chat-empty<?= $heatmapSelectedConv ? ' is-hidden' : '' ?>">
                <p><?= escape(t('chat.select_chat')) ?></p>
            </div>
            <div class="chat-window<?= $heatmapSelectedConv ? '' : ' is-hidden' ?>">
                <div class="chat-header">
                    <?php if ($heatmapSelectedConv): ?>
                    <?php
                    $selName = $heatmapSelectedConv['name'] ?? ($heatmapSelectedConv['other_user']['display_name'] ?? $heatmapSelectedConv['other_user']['username'] ?? t('chat.conversation_default'));
                    $selAvatar = $heatmapSelectedConv['avatar'] ?? ($heatmapSelectedConv['other_user']['avatar'] ?? null);
                    $selLetter = mb_strtoupper(mb_substr($selName, 0, 1));
                    ?>
                    <div class="chat-header-avatar<?= $heatmapSelectedConv['type'] === 'group' ? ' chat-header-avatar-group' : '' ?>"><?= $selAvatar ? '<img src="' . escape($selAvatar) . '" alt="">' : escape($selLetter) ?></div>
                    <div class="chat-header-info">
                        <div class="chat-header-name"><?= escape($selName) ?></div>
                    </div>
                    <?php endif; ?>
                </div>
                <div class="chat-messages-wrap">
                    <div class="chat-messages">
                        <?php if (!empty($heatmapSelectedMessages)): ?>
                        <?php foreach ($heatmapSelectedMessages as $msg): ?>
                        <?php
                        $isOwn = ($msg['user_uuid'] === $testUserUuid);
                        $content = $msg['content'] ?? '';
                        if ($msg['type'] === 'call') {
                            $content = $content ?: t('chat.call_placeholder');
                        } elseif ($msg['type'] === 'sticker') {
                            if ($content === '') {
                                $content = '🖼️ ' . t('chat.sticker');
                            }
                            /* при непустом content выведем img в шаблоне сообщения */
                        } elseif (in_array($msg['type'], ['image', 'file'], true)) {
                            $content = '🖼️ ' . ($msg['type'] === 'file' ? t('chat.file') : t('chat.image'));
                        }
                        $time = $msg['created_at'] ? date('H:i', strtotime($msg['created_at'])) : '';
                        ?>
                        <div class="message <?= $isOwn ? 'own' : 'other' ?>">
                            <div class="message-bubble">
                                <div class="message-content"><?php if ($msg['type'] === 'sticker' && (string)($msg['content'] ?? '') !== ''): ?><img src="<?= escape($msg['content']) ?>" alt="" class="message-sticker-img"><?php else: ?><?= escape($content) ?><?php endif; ?></div>
                                <div class="message-time-row"><span class="message-time"><?= escape($time) ?></span></div>
                            </div>
                        </div>
                        <?php endforeach; ?>
                        <?php endif; ?>
                    </div>
                </div>
                <div class="chat-input-container">
                    <div class="chat-input-form">
                        <div class="chat-input-wrapper">
                            <div class="chat-input-actions" id="chatInputActions">
                                <button type="button" class="chat-input-actions-trigger" disabled aria-expanded="false">⋯</button>
                                <div class="chat-input-actions-buttons">
                                    <button type="button" class="btn-attach" disabled title="<?= escape(t('chat.attach_file')) ?>">
                                        <span class="chat-input-actions-btn-icon">📎</span>
                                        <span class="chat-input-actions-btn-label"><?= escape(t('chat.attach_file')) ?></span>
                                    </button>
                                    <button type="button" class="btn-emoji" disabled title="<?= escape(t('chat.emoji_btn')) ?>">
                                        <span class="chat-input-actions-btn-icon">😊</span>
                                        <span class="chat-input-actions-btn-label"><?= escape(t('chat.emoji_btn')) ?></span>
                                    </button>
                                    <button type="button" class="btn-sticker" disabled title="<?= escape(t('chat.sticker')) ?>">
                                        <span class="chat-input-actions-btn-icon">🎭</span>
                                        <span class="chat-input-actions-btn-label"><?= escape(t('chat.sticker')) ?></span>
                                    </button>
                                </div>
                            </div>
                            <div class="chat-input-contenteditable empty" data-placeholder="<?= escape(t('chat.message_placeholder')) ?>" contenteditable="false"> </div>
                            <button type="button" class="btn-send" disabled>➤</button>
                        </div>
                    </div>
                    <div class="sticker-panel is-hidden" aria-hidden="true">
                        <div class="sticker-panel-grid"></div>
                        <div class="sticker-panel-categories"></div>
                        <div class="sticker-panel-toolbar">
                            <button type="button" class="emoji-panel-sort-btn" disabled aria-pressed="false">🕐</button>
                            <input type="text" class="emoji-panel-search" placeholder="<?= escape(t('chat.emoji_search_placeholder')) ?>" readonly tabindex="-1">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
<?php elseif ($page === 'call'): ?>
    <div class="call-room-container">
        <div class="call-room-panel call-room-panel--visible">
            <div class="call-room-inner">
                <div class="call-room-header">
                    <span class="call-room-title"><?= escape(t('calls.call_title')) ?></span>
                    <span class="call-room-duration">1:23</span>
                </div>
                <div class="call-room-content">
                    <div class="call-room-video-wrap">
                        <div class="call-room-video-area">
                            <div class="call-room-grid"></div>
                        </div>
                        <div class="call-room-local-pip-wrap">
                            <span class="call-room-local-label"><?= escape(t('calls.you')) ?></span>
                        </div>
                    </div>
                </div>
                <div class="call-room-actions-bar">
                    <div class="call-room-actions-center">
                        <div class="call-room-actions-group">
                            <button type="button" class="btn-call-toggle btn-call-audio" disabled>🎤<span class="btn-call-label"><?= escape(t('calls.microphone')) ?></span></button>
                            <button type="button" class="btn-call-toggle" disabled>📹<span class="btn-call-label"><?= escape(t('calls.camera')) ?></span></button>
                            <button type="button" class="btn-call-hangup" disabled>📞</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
<?php elseif ($page === 'join'): ?>
    <div class="auth-container">
        <div class="auth-box join-call-box">
            <p class="auth-lang-selector">
                <span class="auth-lang-label"><?= escape(t('common.language')) ?>:</span>
                <a href="#" class="auth-lang-link active">Русский</a>
                <a href="#" class="auth-lang-link">English</a>
                <a href="#" class="auth-lang-link">Српски</a>
            </p>
            <h1><?= escape(t('join_call.title')) ?></h1>
            <div class="join-call-loading" aria-hidden="true" style="display: none;"><?= escape(t('join_call.checking')) ?></div>
            <p class="join-call-invite"><?= escape(t('join_call.invite_text')) ?> <?= escape(t('join_call.invite_text_no_name')) ?></p>
            <div class="join-call-actions">
                <a href="#" class="btn btn-primary"><?= escape(t('join_call.login_to_join')) ?></a>
                <div class="join-call-guest-section">
                    <p class="join-call-guest-label"><?= escape(t('join_call.or_guest')) ?></p>
                    <form class="join-call-guest-form">
                        <div class="form-group">
                            <label for="hm-guest-name"><?= escape(t('join_call.your_name')) ?></label>
                            <input type="text" id="hm-guest-name" value="" placeholder="<?= escape(t('join_call.your_name_placeholder')) ?>" readonly tabindex="-1">
                        </div>
                        <button type="button" class="btn btn-secondary" disabled><?= escape(t('join_call.join_as_guest')) ?></button>
                    </form>
                </div>
            </div>
        </div>
    </div>
<?php endif; ?>
</div>
</body>
</html>
