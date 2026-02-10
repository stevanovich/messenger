<?php
/**
 * Страница присоединения к звонку по ссылке (без обязательной авторизации).
 * URL: join-call.php?token=...
 */
session_start();
require_once __DIR__ . '/includes/functions.php';

$token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
$pageTitle = 'Присоединиться к звонку';
$isLoggedIn = isLoggedIn();

// Если залогинен и токен есть — можно сразу показать «Присоединиться»
include __DIR__ . '/includes/header.php';
?>
<div class="auth-container">
    <div class="auth-box join-call-box">
        <h1>Присоединиться к звонку</h1>
        <div id="joinCallError" class="alert alert-error" style="display: none;"></div>
        <div id="joinCallLoading" class="join-call-loading">Проверка ссылки…</div>
        <div id="joinCallContent" style="display: none;">
            <p id="joinCallInviteText" class="join-call-invite"></p>
            <div class="join-call-actions">
                <?php if ($isLoggedIn): ?>
                    <button type="button" class="btn btn-primary" id="joinCallBtnLoggedIn">Присоединиться</button>
                <?php else: ?>
                    <a href="<?php echo escape(BASE_URL); ?>login.php?redirect=<?php echo escape(urlencode(BASE_URL . 'join-call.php?token=' . $token)); ?>" class="btn btn-primary">Войти в аккаунт</a>
                    <div class="join-call-guest-section">
                        <p class="join-call-guest-label">или войти как гость:</p>
                        <form id="joinCallGuestForm" class="join-call-guest-form">
                            <div class="form-group">
                                <label for="guestDisplayName">Ваше имя</label>
                                <input type="text" id="guestDisplayName" name="display_name" required minlength="1" maxlength="255" placeholder="Как к вам обращаться" autocomplete="name">
                            </div>
                            <button type="submit" class="btn btn-secondary">Присоединиться как гость</button>
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

    if (!token) {
        document.getElementById('joinCallLoading').style.display = 'none';
        document.getElementById('joinCallError').textContent = 'Не указана ссылка на звонок.';
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
            ? 'Вас приглашают в звонок. Приглашает: ' + info.inviter_name
            : 'Вас приглашают в звонок.';
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
                showError(res && res.error ? res.error : 'Ссылка недействительна или истекла.');
            }
        })
        .catch(function() {
            showError('Не удалось проверить ссылку. Попробуйте позже.');
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
                    showError(res && res.error ? res.error : 'Не удалось присоединиться.');
                    btn.disabled = false;
                }
            })
            .catch(function() {
                showError('Ошибка сети.');
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
                    document.getElementById('joinCallError').textContent = res && res.error ? res.error : 'Не удалось присоединиться.';
                    document.getElementById('joinCallError').style.display = 'block';
                    btn.disabled = false;
                }
            })
            .catch(function() {
                document.getElementById('joinCallError').textContent = 'Ошибка сети.';
                document.getElementById('joinCallError').style.display = 'block';
                btn.disabled = false;
            });
        });
    }
})();
</script>
<?php include __DIR__ . '/includes/footer.php'; ?>
