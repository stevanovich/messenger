<?php
/**
 * Страница присоединения к беседе по ссылке-приглашению.
 * URL: join-conversation.php?token=...
 * Требуется войти в аккаунт, после чего пользователь добавляется в участники беседы.
 */
session_start();
require_once __DIR__ . '/includes/functions.php';

$token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
$pageTitle = 'Присоединиться к беседе';
$isLoggedIn = isLoggedIn();

include __DIR__ . '/includes/header.php';
?>
<div class="auth-container">
    <div class="auth-box join-call-box">
        <h1>Присоединиться к беседе</h1>
        <div id="joinConvError" class="alert alert-error" style="display: none;"></div>
        <div id="joinConvLoading" class="join-call-loading">Проверка ссылки…</div>
        <div id="joinConvContent" style="display: none;">
            <p id="joinConvInviteText" class="join-call-invite"></p>
            <div class="join-call-actions">
                <?php if ($isLoggedIn): ?>
                    <button type="button" class="btn btn-primary" id="joinConvBtnLoggedIn">Присоединиться</button>
                <?php else: ?>
                    <a href="<?php echo escape(BASE_URL); ?>login.php?redirect=<?php echo escape(urlencode(BASE_URL . 'join-conversation.php?token=' . $token)); ?>" class="btn btn-primary">Войти в аккаунт</a>
                    <p class="join-call-guest-label" style="margin-top: 1rem;">Чтобы присоединиться к беседе, войдите в мессенджер.</p>
                <?php endif; ?>
            </div>
        </div>
    </div>
</div>
<script>
(function() {
    var token = <?php echo json_encode($token); ?>;
    var baseUrl = <?php echo json_encode(rtrim(BASE_URL, '/')); ?>;

    if (!token) {
        document.getElementById('joinConvLoading').style.display = 'none';
        document.getElementById('joinConvError').textContent = 'Не указана ссылка на беседу.';
        document.getElementById('joinConvError').style.display = 'block';
        return;
    }

    function showError(msg) {
        document.getElementById('joinConvLoading').style.display = 'none';
        document.getElementById('joinConvContent').style.display = 'none';
        document.getElementById('joinConvError').textContent = msg;
        document.getElementById('joinConvError').style.display = 'block';
    }

    function showContent(info) {
        document.getElementById('joinConvLoading').style.display = 'none';
        document.getElementById('joinConvError').style.display = 'none';
        var inviteText = document.getElementById('joinConvInviteText');
        inviteText.textContent = 'Вас приглашают в беседу: «' + (info.conversation_name || 'Беседа') + '».';
        document.getElementById('joinConvContent').style.display = 'block';
    }

    fetch(baseUrl + '/api/conversation_invite.php?action=conv_invite_info&token=' + encodeURIComponent(token), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (res && res.success && res.data) {
                showContent(res.data);
            } else {
                showError(res && res.error ? res.error : 'Ссылка недействительна или истекла.');
            }
        })
        .catch(function() {
            showError('Не удалось проверить ссылку. Попробуйте позже.');
        });

    var joinBtn = document.getElementById('joinConvBtnLoggedIn');
    if (joinBtn) {
        joinBtn.addEventListener('click', function() {
            var btn = this;
            btn.disabled = true;
            fetch(baseUrl + '/api/conversation_invite.php?action=conv_invite_join', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token })
            })
            .then(function(r) { return r.json(); })
            .then(function(res) {
                if (res && res.success && res.data) {
                    var cid = res.data.conversation_id;
                    window.location.href = baseUrl + '/index.php#/c/' + cid;
                } else {
                    document.getElementById('joinConvError').textContent = res && res.error ? res.error : 'Не удалось присоединиться.';
                    document.getElementById('joinConvError').style.display = 'block';
                    btn.disabled = false;
                }
            })
            .catch(function() {
                document.getElementById('joinConvError').textContent = 'Ошибка сети.';
                document.getElementById('joinConvError').style.display = 'block';
                btn.disabled = false;
            });
        });
    }
})();
</script>
<?php include __DIR__ . '/includes/footer.php'; ?>
