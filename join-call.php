<?php
/**
 * Страница присоединения к звонку по ссылке (без обязательной авторизации).
 * URL: join-call.php?token=...
 */
session_start();
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/locale.php';
initLocale();

$token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
$pageTitle = t('join_call.title');
$isLoggedIn = isLoggedIn();

// Если залогинен и токен есть — можно сразу показать «Присоединиться»
include __DIR__ . '/includes/header.php';
?>
<div class="auth-container">
    <div class="auth-box join-call-box">
        <p class="auth-lang-selector">
            <span class="auth-lang-label"><?php echo escape(t('common.language')); ?>:</span>
            <a href="join-call.php?token=<?php echo escape(urlencode($token)); ?>&lang=ru" class="auth-lang-link<?php echo getLocale() === 'ru' ? ' active' : ''; ?>">Русский</a>
            <a href="join-call.php?token=<?php echo escape(urlencode($token)); ?>&lang=en" class="auth-lang-link<?php echo getLocale() === 'en' ? ' active' : ''; ?>">English</a>
            <a href="join-call.php?token=<?php echo escape(urlencode($token)); ?>&lang=sr" class="auth-lang-link<?php echo getLocale() === 'sr' ? ' active' : ''; ?>">Српски</a>
        </p>
        <h1><?php echo escape(t('join_call.title')); ?></h1>
        <div id="joinCallError" class="alert alert-error" style="display: none;"></div>
        <div id="joinCallLoading" class="join-call-loading"><?php echo escape(t('join_call.checking')); ?></div>
        <div id="joinCallContent" style="display: none;">
            <p id="joinCallInviteText" class="join-call-invite"></p>
            <div class="join-call-actions">
                <?php if ($isLoggedIn): ?>
                    <button type="button" class="btn btn-primary" id="joinCallBtnLoggedIn"><?php echo escape(t('join_call.join')); ?></button>
                <?php else: ?>
                    <a href="<?php echo escape(BASE_URL); ?>login.php?redirect=<?php echo escape(urlencode(BASE_URL . 'join-call.php?token=' . $token)); ?>" class="btn btn-primary"><?php echo escape(t('join_call.login_to_join')); ?></a>
                    <div class="join-call-guest-section">
                        <p class="join-call-guest-label"><?php echo escape(t('join_call.or_guest')); ?></p>
                        <form id="joinCallGuestForm" class="join-call-guest-form">
                            <div class="form-group">
                                <label for="guestDisplayName"><?php echo escape(t('join_call.your_name')); ?></label>
                                <input type="text" id="guestDisplayName" name="display_name" required minlength="1" maxlength="255" placeholder="<?php echo escape(t('join_call.your_name_placeholder')); ?>" autocomplete="name">
                            </div>
                            <button type="submit" class="btn btn-secondary"><?php echo escape(t('join_call.join_as_guest')); ?></button>
                        </form>
                    </div>
                <?php endif; ?>
            </div>
        </div>
    </div>
</div>
<script>
(function() {
    var token = <?php echo json_encode($token); ?>;
    var baseUrl = <?php echo json_encode(rtrim(BASE_URL, '/')); ?>;
    var isLoggedIn = <?php echo $isLoggedIn ? 'true' : 'false'; ?>;
    var i18n = <?php echo json_encode([
        'error_no_link' => t('join_call.error_no_link'),
        'error_invalid' => t('join_call.error_invalid'),
        'error_network' => t('join_call.error_network'),
        'error_join_failed' => t('join_call.error_join_failed'),
        'error_network_short' => t('join_call.error_network_short'),
        'invite_text' => t('join_call.invite_text'),
        'invite_text_no_name' => t('join_call.invite_text_no_name'),
    ]); ?>;

    if (!token) {
        document.getElementById('joinCallLoading').style.display = 'none';
        document.getElementById('joinCallError').textContent = i18n.error_no_link;
        document.getElementById('joinCallError').style.display = 'block';
        return;
    }

    function showError(msg) {
        document.getElementById('joinCallLoading').style.display = 'none';
        document.getElementById('joinCallContent').style.display = 'none';
        document.getElementById('joinCallError').textContent = msg;
        document.getElementById('joinCallError').style.display = 'block';
    }

    function showContent(info) {
        document.getElementById('joinCallLoading').style.display = 'none';
        document.getElementById('joinCallError').style.display = 'none';
        var inviteText = document.getElementById('joinCallInviteText');
        inviteText.textContent = info.inviter_name
            ? (i18n.invite_text.replace('%s', info.inviter_name))
            : i18n.invite_text_no_name;
        document.getElementById('joinCallContent').style.display = 'block';
        window._joinCallInfo = info;
    }

    fetch(baseUrl + '/api/calls.php?action=call_link_info&token=' + encodeURIComponent(token), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (res && res.success && res.data) {
                if (res.data.redirect_to_conversation && res.data.redirect_url) {
                    window.location.href = res.data.redirect_url;
                    return;
                }
                showContent(res.data);
            } else {
                showError(res && res.error ? res.error : i18n.error_invalid);
            }
        })
        .catch(function() {
            showError(i18n.error_network);
        });

    if (isLoggedIn) {
        document.getElementById('joinCallBtnLoggedIn').addEventListener('click', function() {
            var btn = this;
            btn.disabled = true;
            fetch(baseUrl + '/api/calls.php?action=call_link_join', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ link_token: token })
            })
            .then(function(r) { return r.json(); })
            .then(function(res) {
                if (res && res.success && res.data) {
                    var cid = res.data.conversation_id;
                    window.location.href = baseUrl + '/index.php?join_call=1#/c/' + cid;
                } else {
                    showError(res && res.error ? res.error : i18n.error_join_failed);
                    btn.disabled = false;
                }
            })
            .catch(function() {
                showError(i18n.error_network_short);
                btn.disabled = false;
            });
        });
    } else {
        document.getElementById('joinCallGuestForm').addEventListener('submit', function(e) {
            e.preventDefault();
            var nameInput = document.getElementById('guestDisplayName');
            var name = (nameInput.value || '').trim();
            if (name.length < 1) {
                nameInput.focus();
                return;
            }
            var btn = this.querySelector('button[type="submit"]');
            btn.disabled = true;
            fetch(baseUrl + '/api/calls.php?action=call_link_join_guest', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ link_token: token, display_name: name })
            })
            .then(function(r) { return r.json(); })
            .then(function(res) {
                if (res && res.success && res.data) {
                    var q = new URLSearchParams({
                        guest_token: res.data.guest_token,
                        group_call_id: res.data.group_call_id,
                        conversation_id: res.data.conversation_id,
                        with_video: res.data.with_video ? '1' : '0',
                        ws_guest_token: res.data.ws_guest_token
                    });
                    window.location.href = baseUrl + '/call-room.php?' + q.toString();
                } else {
                    document.getElementById('joinCallError').textContent = res && res.error ? res.error : i18n.error_join_failed;
                    document.getElementById('joinCallError').style.display = 'block';
                    btn.disabled = false;
                }
            })
            .catch(function() {
                document.getElementById('joinCallError').textContent = i18n.error_network_short;
                document.getElementById('joinCallError').style.display = 'block';
                btn.disabled = false;
            });
        });
    }
})();
</script>
<?php include __DIR__ . '/includes/footer.php'; ?>
