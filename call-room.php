<?php
/**
 * Страница звонка для гостя (по ссылке). WebRTC + WebSocket по ws_guest_token.
 * Параметры: guest_token, group_call_id, conversation_id, with_video, ws_guest_token.
 * Не требует авторизации.
 */
session_start();
require_once __DIR__ . '/includes/functions.php';

require_once __DIR__ . '/includes/locale.php';
initLocale();
$pageTitle = t('calls.call_title');
$guestToken = isset($_GET['guest_token']) ? trim((string) $_GET['guest_token']) : '';
$withVideo = !empty($_GET['with_video']) && $_GET['with_video'] !== '0';
$wsUrl = defined('WEBSOCKET_WS_URL') ? WEBSOCKET_WS_URL : '';

include __DIR__ . '/includes/header.php';
?>
<div class="call-room-container"<?php if ($guestToken && $wsUrl): ?> data-base-url="<?php echo escape(rtrim(BASE_URL, '/')); ?>" data-ws-url="<?php echo escape($wsUrl); ?>"<?php endif; ?>>
    <?php if ($guestToken): ?>
        <div class="call-room-panel call-room-panel--visible">
            <button type="button" class="call-panel-minimize-corner call-room-minimize" id="callRoomMinimize" title="<?php echo escape(t('calls.minimize')); ?>" aria-label="<?php echo escape(t('calls.minimize')); ?>" style="display:none">−</button>
            <div class="call-room-inner">
                <div class="call-room-header">
                    <span class="call-room-title" id="callRoomTitle"><?php echo escape(t('calls.call_title')); ?></span>
                    <span class="call-room-duration" id="callRoomDuration">0:00</span>
                </div>
                <div class="call-room-content">
                    <p id="callRoomStatus" class="call-room-status"><?php echo escape(t('calls.connecting')); ?></p>
                    <div class="call-room-video-wrap">
                        <div class="call-room-video-area">
                            <div class="call-room-grid" id="callRoomGrid"></div>
                        </div>
                        <div class="call-room-local-pip-wrap" id="callRoomLocalPipWrap">
                            <video id="callRoomLocalVideo" class="call-room-local-video" playsinline muted></video>
                            <span class="call-room-local-label"><?php echo escape(t('calls.you')); ?></span>
                            <button type="button" class="btn-call-switch-camera-on-pip" id="callRoomSwitchCamera" title="<?php echo escape(t('calls.switch_camera_title')); ?>" aria-label="<?php echo escape(t('calls.switch_camera_title')); ?>" style="display:none">🔄</button>
                        </div>
                    </div>
                </div>
                <div class="call-room-actions-bar">
                    <div class="call-room-actions-left">
                        <div class="call-room-register">
                            <span class="call-room-register-text"><?php echo escape(t('calls.register_hint')); ?></span>
                            <a href="<?php echo escape(BASE_URL); ?>register.php?redirect=<?php echo escape(urlencode(BASE_URL . 'index.php')); ?>" class="call-room-register-link"><?php echo escape(t('calls.create_account')); ?></a>
                        </div>
                    </div>
                    <div class="call-room-actions-center">
                        <div class="call-room-actions-group">
                            <button type="button" class="btn-call-toggle btn-call-audio" id="callRoomMute" title="<?php echo escape(t('calls.mic_title')); ?>" aria-label="<?php echo escape(t('calls.microphone')); ?>">🎤<span class="btn-call-label"><?php echo escape(t('calls.microphone')); ?></span></button>
                            <button type="button" class="btn-call-toggle" id="callRoomVideo" title="<?php echo escape(t('calls.camera_title')); ?>" aria-label="<?php echo escape(t('calls.camera')); ?>" style="display:none">📹<span class="btn-call-label"><?php echo escape(t('calls.camera')); ?></span></button>
                            <button type="button" class="btn-call-toggle" id="callRoomShareScreen" title="<?php echo escape(t('calls.share_screen_title')); ?>" aria-label="<?php echo escape(t('calls.share_screen_title')); ?>" style="display:none">🖥️</button>
                        </div>
                    </div>
                    <div class="call-room-actions-right">
                        <button type="button" class="btn-call-hangup" id="callRoomLeaveBtn" title="<?php echo escape(t('calls.leave_call_title')); ?>" aria-label="<?php echo escape(t('calls.leave_call_title')); ?>">📞</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="call-room-minimized-bar" id="callRoomMinimizedBar" role="button" tabindex="0" aria-label="<?php echo escape(t('calls.expand_call')); ?>" style="order: -1">
            <span class="call-room-minimized-bar-name" id="callRoomMinimizedName"><?php echo escape(t('calls.group_call_title')); ?></span>
            <span class="call-room-minimized-bar-duration" id="callRoomMinimizedDuration">0:00</span>
            <button type="button" class="call-room-minimized-bar-hangup" id="callRoomMinimizedBarHangup" title="<?php echo escape(t('calls.leave_call_title')); ?>" aria-label="<?php echo escape(t('calls.leave_call_title')); ?>">📞</button>
        </div>
    <?php else: ?>
        <div class="call-room-box">
            <h1 class="call-room-title"><?php echo escape(t('calls.call_title')); ?></h1>
            <p><?php echo escape(t('calls.invalid_link')); ?></p>
            <a href="<?php echo escape(BASE_URL); ?>" class="btn btn-secondary"><?php echo escape(t('calls.go_home')); ?></a>
        </div>
    <?php endif; ?>
</div>
<?php if ($guestToken): ?>
<script src="<?php echo escape(BASE_URL); ?>assets/js/call-room.js"></script>
<?php endif; ?>
<?php include __DIR__ . '/includes/footer.php'; ?>
