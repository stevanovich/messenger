<?php
/**
 * Страница звонка для гостя (по ссылке). WebRTC + WebSocket по ws_guest_token.
 * Параметры: guest_token, group_call_id, conversation_id, with_video, ws_guest_token.
 * Не требует авторизации.
 */
session_start();
require_once __DIR__ . '/includes/functions.php';

$pageTitle = 'Звонок';
$guestToken = isset($_GET['guest_token']) ? trim((string) $_GET['guest_token']) : '';
$withVideo = !empty($_GET['with_video']) && $_GET['with_video'] !== '0';
$wsUrl = defined('WEBSOCKET_WS_URL') ? WEBSOCKET_WS_URL : '';

include __DIR__ . '/includes/header.php';
?>
<div class="call-room-container"<?php if ($guestToken && $wsUrl): ?> data-base-url="<?php echo escape(rtrim(BASE_URL, '/')); ?>" data-ws-url="<?php echo escape($wsUrl); ?>"<?php endif; ?>>
    <?php if ($guestToken): ?>
        <div class="call-room-panel call-room-panel--visible">
            <div class="call-room-inner">
                <div class="call-room-header">
                    <span class="call-room-title" id="callRoomTitle">Звонок</span>
                    <span class="call-room-duration" id="callRoomDuration">0:00</span>
                </div>
                <div class="call-room-content">
                    <p id="callRoomStatus" class="call-room-status">Подключение…</p>
                    <div class="call-room-video-wrap">
                        <div class="call-room-video-area">
                            <div class="call-room-grid" id="callRoomGrid"></div>
                        </div>
                        <div class="call-room-local-pip-wrap" id="callRoomLocalPipWrap">
                            <video id="callRoomLocalVideo" class="call-room-local-video" playsinline muted></video>
                            <span class="call-room-local-label">Вы</span>
                            <button type="button" class="btn-call-switch-camera-on-pip" id="callRoomSwitchCamera" title="Переключить камеру" aria-label="Переключить камеру" style="display:none">🔄</button>
                        </div>
                    </div>
                </div>
                <div class="call-room-actions-bar">
                    <div class="call-room-actions-left">
                        <div class="call-room-register">
                            <span class="call-room-register-text">Зарегистрируйтесь, чтобы сохранять историю и звонить с любого устройства.</span>
                            <a href="<?php echo escape(BASE_URL); ?>register.php?redirect=<?php echo escape(urlencode(BASE_URL . 'index.php')); ?>" class="call-room-register-link">Создать аккаунт</a>
                        </div>
                    </div>
                    <div class="call-room-actions-center">
                        <div class="call-room-actions-group">
                            <button type="button" class="btn-call-toggle" id="callRoomMute" title="Микрофон вкл/выкл" aria-label="Микрофон">🎤<span class="btn-call-label">Микрофон</span></button>
                            <button type="button" class="btn-call-toggle" id="callRoomVideo" title="Камера вкл/выкл" aria-label="Камера" style="display:none">📹<span class="btn-call-label">Камера</span></button>
                            <button type="button" class="btn-call-toggle" id="callRoomShareScreen" title="Поделиться экраном" aria-label="Поделиться экраном" style="display:none">🖥️</button>
                        </div>
                    </div>
                    <div class="call-room-actions-right">
                        <button type="button" class="btn-call-hangup" id="callRoomLeaveBtn" title="Покинуть звонок" aria-label="Покинуть звонок">📞</button>
                    </div>
                </div>
            </div>
        </div>
    <?php else: ?>
        <div class="call-room-box">
            <h1 class="call-room-title">Звонок</h1>
            <p>Неверная ссылка. Вернитесь по приглашению.</p>
            <a href="<?php echo escape(BASE_URL); ?>" class="btn btn-secondary">На главную</a>
        </div>
    <?php endif; ?>
</div>
<?php if ($guestToken): ?>
<script src="<?php echo escape(BASE_URL); ?>assets/js/call-room.js"></script>
<?php endif; ?>
<?php include __DIR__ . '/includes/footer.php'; ?>
