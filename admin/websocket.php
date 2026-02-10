<?php
/**
 * Управление WebSocket-сервером из админки: статус, запуск, остановка.
 */
$pageTitle = 'WebSocket';
require_once __DIR__ . '/common.php';
ob_start();

$rootPath = rtrim(ROOT_PATH, '/\\');
$ds = DIRECTORY_SEPARATOR;
$wsDir = $rootPath . $ds . 'websocket';
$pidFile = $wsDir . $ds . 'server.pid';
$logFile = $wsDir . $ds . 'server.log';
$startScript = $wsDir . $ds . 'start.sh';
$stopScript = $wsDir . $ds . 'stop.sh';
$restartScript = $wsDir . $ds . 'restart.sh';

$runAsUser = defined('WEBSOCKET_RUN_AS_USER') && trim(WEBSOCKET_RUN_AS_USER) !== '' ? trim(WEBSOCKET_RUN_AS_USER) : '';
$envPrefix = $runAsUser !== '' ? 'WEBSOCKET_RUN_AS_USER=' . escapeshellarg($runAsUser) . ' ' : '';

$message = '';
$messageType = '';
$redirectAfterPost = null;
$isAjax = !empty($_POST['ajax']) || (isset($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest');

// Одноразовое сообщение после редиректа (журнал очищен)
if (isset($_GET['cleared']) && $_GET['cleared'] === '1') {
    $message = 'Журнал WebSocket очищен.';
    $messageType = 'success';
}

// Обработка действий
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $action = $_POST['action'];

    // Настройка отображения индикатора режима обновления для всех пользователей (не требует exec)
    if ($action === 'set_show_connection_status') {
        $show = isset($_POST['show']) ? (string) $_POST['show'] : '';
        $showBool = ($show === '1' || $show === 'true');
        if (saveShowConnectionStatusIndicator($showBool)) {
            if ($isAjax) {
                while (ob_get_level()) ob_end_clean();
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['success' => true, 'show' => $showBool]);
                exit;
            }
            $redirectAfterPost = (defined('BASE_URL') ? BASE_URL : '') . 'admin/websocket.php';
        } else {
            $message = 'Не удалось сохранить настройку. Выдайте веб-серверу права на запись в папку config/ (файл connection_status_display.json).';
            $messageType = 'error';
        }
    } elseif (!function_exists('exec')) {
        $message = 'Функция exec() отключена на сервере. Управление возможно только через SSH (websocket/start.sh / websocket/stop.sh).';
        $messageType = 'error';
    } else {
        if ($action === 'start') {
            $phpPath = defined('WEBSOCKET_PHP_PATH') ? trim(WEBSOCKET_PHP_PATH) : '';
            $env = $envPrefix . ($phpPath !== '' ? 'PHP_CMD=' . escapeshellarg($phpPath) . ' ' : '');
            $cmd = 'cd ' . escapeshellarg($rootPath) . ' && ' . $env . escapeshellarg($startScript) . ' 2>&1';
            $output = [];
            exec($cmd, $output, $code);
            $outStr = implode("\n", $output);
            if ($code !== 0 || strpos($outStr, 'Ошибка:') !== false || strpos($outStr, 'pdo_mysql') !== false) {
                if (stripos($outStr, 'Permission denied') !== false) {
                    $message = 'Нет прав на выполнение скрипта. По SSH из корня проекта выполните: <code>chmod +x websocket/start.sh websocket/stop.sh websocket/restart.sh websocket/info.sh</code>. Вывод: ' . escape(nl2br($outStr));
                } else {
                    $message = 'Запуск не удался. Проверьте WEBSOCKET_PHP_PATH в config.php (путь к PHP с pdo_mysql). Вывод: ' . escape(nl2br($outStr));
                }
                $messageType = 'error';
            } else {
                if (!$isAjax) $redirectAfterPost = (defined('BASE_URL') ? BASE_URL : '') . 'admin/websocket.php';
            }
        } elseif ($action === 'stop') {
            $cmd = 'cd ' . escapeshellarg($rootPath) . ' && ' . $envPrefix . escapeshellarg($stopScript) . ' 2>&1';
            exec($cmd, $output = [], $code);
            $outStr = implode("\n", $output);
            if ($isAjax && !empty($output)) {
                if (stripos($outStr, 'Permission denied') !== false) {
                    $message = 'Нет прав на выполнение скрипта. По SSH выполните: chmod +x websocket/start.sh websocket/stop.sh websocket/restart.sh websocket/info.sh';
                    $messageType = 'error';
                } else {
                    $message = $outStr;
                    $messageType = 'success';
                }
            }
            if (!$isAjax) $redirectAfterPost = (defined('BASE_URL') ? BASE_URL : '') . 'admin/websocket.php';
        } elseif ($action === 'restart') {
            $phpPath = defined('WEBSOCKET_PHP_PATH') ? trim(WEBSOCKET_PHP_PATH) : '';
            $env = $envPrefix . ($phpPath !== '' ? 'PHP_CMD=' . escapeshellarg($phpPath) . ' ' : '');
            $cmd = 'cd ' . escapeshellarg($rootPath) . ' && ' . $env . escapeshellarg($restartScript) . ' 2>&1';
            exec($cmd, $output = [], $code);
            $outStr = implode("\n", $output);
            if ($isAjax && !empty($output)) {
                if (stripos($outStr, 'Permission denied') !== false) {
                    $message = 'Нет прав на выполнение скрипта. По SSH выполните: chmod +x websocket/start.sh websocket/stop.sh websocket/restart.sh websocket/info.sh';
                    $messageType = 'error';
                } else {
                    $message = $outStr;
                    $messageType = 'success';
                }
            }
            if (!$isAjax) $redirectAfterPost = (defined('BASE_URL') ? BASE_URL : '') . 'admin/websocket.php';
        } elseif ($action === 'clear_log') {
            $logDir = dirname($logFile);
            if (is_file($logFile)) {
                if (is_writable($logFile)) {
                    if (file_put_contents($logFile, '') !== false) {
                        if (!$isAjax) $redirectAfterPost = (defined('BASE_URL') ? BASE_URL : '') . 'admin/websocket.php?cleared=1';
                    } else {
                        $message = 'Не удалось очистить файл журнала (нет прав записи).';
                        $messageType = 'error';
                    }
                } else {
                    $message = 'Файл журнала недоступен для записи. Выдайте веб-серверу права на запись в websocket/ (chmod или владелец файла).';
                    $messageType = 'error';
                }
            } else {
                if (is_dir($logDir) && is_writable($logDir) && file_put_contents($logFile, '') !== false) {
                    if (!$isAjax) $redirectAfterPost = (defined('BASE_URL') ? BASE_URL : '') . 'admin/websocket.php?cleared=1';
                } else {
                    $message = 'Файл журнала отсутствует. Запустите WebSocket-сервер (./websocket/start.sh) — лог создастся автоматически. Либо выдайте веб-серверу права на запись в папку websocket/.';
                    $messageType = 'error';
                }
            }
        }
    }
    if ($redirectAfterPost !== null) {
        header('Location: ' . $redirectAfterPost);
        exit;
    }
}

$wsPort = defined('WEBSOCKET_PORT') ? (int) WEBSOCKET_PORT : 8081;
$eventPort = defined('WEBSOCKET_EVENT_PORT') ? (int) WEBSOCKET_EVENT_PORT : 8082;

// Статус процесса: по PID-файлу + /proc, при необходимости — по порту 8081
$statusRunning = false;
$statusPid = null;
$statusDetails = '';

if (is_file($pidFile)) {
    $pid = (int) trim(file_get_contents($pidFile));
    if ($pid > 0) {
        $statusPid = $pid;
        // Проверка через /proc не требует прав на процесс (процесс мог быть запущен из SSH другим пользователем)
        if (is_dir("/proc/$pid") || is_file("/proc/$pid/status")) {
            $statusRunning = true;
            if (is_readable("/proc/$pid/cmdline")) {
                $cmd = @file_get_contents("/proc/$pid/cmdline");
                if ($cmd !== false && $cmd !== '' && strpos($cmd, 'websocket') === false) {
                    $statusRunning = false; // процесс есть, но это не наш
                }
            }
        } else {
            $statusRunning = (function_exists('posix_kill') && @posix_kill($pid, 0))
                || (@exec('kill -0 ' . (int) $pid . ' 2>/dev/null', $_, $code) !== false && isset($code) && $code === 0);
        }
        if (!$statusRunning) {
            $statusDetails = 'Устаревший PID (процесс не найден).';
        }
    }
} else {
    $statusDetails = 'PID-файл отсутствует.';
}

// Резерв: если веб-сервер не видит /proc или PID-файл (другой путь/пользователь), проверяем порт
if (!$statusRunning && $wsPort > 0) {
    $sock = @fsockopen('127.0.0.1', $wsPort, $errno, $errstr, 2);
    if ($sock) {
        fclose($sock);
        $statusRunning = true;
        $statusDetails = 'Запущен (порт ' . $wsPort . ' занят).';
    }
}

if ($statusRunning && $statusDetails === '') {
    $statusDetails = 'PID ' . $statusPid;
}

$logLines = [];
if (is_file($logFile)) {
    $lines = file($logFile);
    $logLines = array_slice($lines, -12);
}

$phpPathConfigured = defined('WEBSOCKET_PHP_PATH') && trim(WEBSOCKET_PHP_PATH) !== '';

// Ответ JSON для AJAX-запросов (после действия карточка обновляется без перезагрузки)
if ($isAjax && $_SERVER['REQUEST_METHOD'] === 'POST') {
    while (ob_get_level()) ob_end_clean();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => ($messageType !== 'error'),
        'statusRunning' => (bool) $statusRunning,
        'statusDetails' => (string) $statusDetails,
        'wsPort' => $wsPort,
        'eventPort' => $eventPort,
        'message' => $message,
        'messageType' => $messageType,
        'logLines' => $logLines,
    ]);
    exit;
}

include __DIR__ . '/header.php';
?>

<h1 class="admin-page-title">WebSocket-сервер</h1>

<?php if ($message): ?>
<div id="admin-websocket-message" class="admin-message admin-message--<?= $messageType ?>"><?= $message ?></div>
<?php else: ?>
<div id="admin-websocket-message" class="admin-message" style="display:none;"></div>
<?php endif; ?>

<div class="admin-websocket-status">
    <div class="admin-card">
        <div class="admin-card-title">Статус</div>
        <div id="admin-websocket-status-value" class="admin-card-value admin-websocket-status-value <?= $statusRunning ? 'running' : 'stopped' ?>">
            <?= $statusRunning ? 'Запущен' : 'Остановлен' ?>
        </div>
        <div id="admin-websocket-status-details" class="admin-websocket-details"><?= $statusDetails ? escape($statusDetails) : '' ?></div>
    </div>
    <div class="admin-card">
        <div class="admin-card-title">Порты</div>
        <div class="admin-websocket-details">WebSocket: <?= $wsPort ?>, HTTP-хук (события): <?= $eventPort ?></div>
    </div>
</div>

<?php $showConnectionStatus = getShowConnectionStatusIndicator(); ?>
<div class="admin-websocket-toggle-card admin-card">
    <div class="admin-card-title">Индикатор режима обновления в чате</div>
    <p class="admin-websocket-toggle-desc">Показывать в шапке чата признак текущего режима: «Реальное время» (WebSocket) или «По запросу» (polling). Настройка действует для всех пользователей.</p>
    <label class="admin-toggle-label">
        <input type="checkbox" id="adminShowConnectionStatus" class="admin-toggle-input" <?= $showConnectionStatus ? 'checked' : '' ?>>
        <span class="admin-toggle-slider"></span>
        <span class="admin-toggle-text" id="adminShowConnectionStatusLabel"><?= $showConnectionStatus ? 'Показывать' : 'Скрывать' ?></span>
    </label>
</div>

<?php if (!$phpPathConfigured): ?>
<div class="admin-message admin-message--warning">
    В <code>config/config.php</code> не задан <code>WEBSOCKET_PHP_PATH</code>. На Synology укажите путь к PHP с pdo_mysql (из Web Station), иначе «Запустить» может не сработать. Подробнее: websocket/docs/WEBSOCKET_NAS_SETUP.md
</div>
<?php endif; ?>

<?php if ($runAsUser === ''): ?>
<div class="admin-message admin-message--info">
    Если «Остановить» из веб не срабатывает (сервер был запущен по SSH) — задайте в <code>config/config.php</code> <code>WEBSOCKET_RUN_AS_USER</code> (пользователь веб-сервера, например <code>http</code> или <code>sc-web</code>) и настройте sudo. Тогда и CLI, и веб будут управлять одним процессом. Подробнее: websocket/docs/WEBSOCKET_NAS_SETUP.md#единый-пользователь-websocket_run_as_user
</div>
<?php endif; ?>

<div class="admin-websocket-actions">
    <form method="post" class="admin-websocket-form admin-websocket-form-action" data-confirm="Запустить WebSocket-сервер?" data-action="start">
        <input type="hidden" name="action" value="start">
        <button type="submit" class="btn btn-primary" <?= $statusRunning ? 'disabled' : '' ?>>Запустить</button>
    </form>
    <form method="post" class="admin-websocket-form admin-websocket-form-action" data-confirm="Перезапустить WebSocket-сервер?" data-action="restart">
        <input type="hidden" name="action" value="restart">
        <button type="submit" class="btn btn-secondary" <?= !$statusRunning ? 'disabled' : '' ?>>Перезапустить</button>
    </form>
    <form method="post" class="admin-websocket-form admin-websocket-form-action" data-confirm="Остановить WebSocket-сервер?" data-action="stop">
        <input type="hidden" name="action" value="stop">
        <button type="submit" class="btn btn-secondary" <?= !$statusRunning ? 'disabled' : '' ?>>Остановить</button>
    </form>
</div>

<div class="admin-websocket-log">
    <h3>Журнал WebSocket</h3>
    <div id="admin-websocket-log-content">
    <?php if (!empty($logLines)): ?>
    <pre class="admin-websocket-log-pre"><?= escape(implode('', $logLines)) ?></pre>
    <form method="post" class="admin-websocket-form admin-websocket-form-clear" data-confirm="Очистить журнал WebSocket? Текущее содержимое будет удалено.">
        <input type="hidden" name="action" value="clear_log">
        <button type="submit" class="btn btn-secondary">Очистить журнал</button>
    </form>
    <?php else: ?>
    <p class="admin-websocket-log-empty">Журнал пуст или файл отсутствует.</p>
    <?php endif; ?>
    </div>
</div>

<p class="admin-websocket-help">
    Управление из CLI: <code>./websocket/start.sh</code>, <code>./websocket/restart.sh</code>, <code>./websocket/stop.sh</code>, <code>./websocket/info.sh</code>
</p>

<div id="admin-websocket-confirm" class="admin-confirm" style="display:none;" role="dialog" aria-labelledby="admin-websocket-confirm-title" aria-modal="true">
    <div class="admin-confirm-overlay"></div>
    <div class="admin-confirm-box">
        <p id="admin-websocket-confirm-title" class="admin-confirm-message"></p>
        <div class="admin-confirm-actions">
            <button type="button" class="btn btn-primary admin-confirm-ok">Подтвердить</button>
            <button type="button" class="btn btn-secondary admin-confirm-cancel">Отмена</button>
        </div>
    </div>
</div>

<style>
.admin-confirm { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; }
.admin-confirm-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.4); }
.admin-confirm-box { position: relative; background: var(--bg-color, #fff); border-radius: 12px; padding: 1.5rem; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.admin-confirm-message { margin: 0 0 1.25rem; font-size: 1rem; line-height: 1.4; color: var(--text-color, #333); }
.admin-confirm-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
</style>

<script>
(function() {
    var confirmEl = document.getElementById('admin-websocket-confirm');
    var confirmMsgEl = document.getElementById('admin-websocket-confirm-title');
    var confirmOk = confirmEl && confirmEl.querySelector('.admin-confirm-ok');
    var confirmCancel = confirmEl && confirmEl.querySelector('.admin-confirm-cancel');
    var confirmOverlay = confirmEl && confirmEl.querySelector('.admin-confirm-overlay');
    var confirmResolve = null;

    function showConfirm(message, onConfirm, onCancel) {
        if (!confirmEl) return onConfirm();
        confirmMsgEl.textContent = message;
        confirmEl.style.display = 'flex';
        confirmResolve = { onConfirm: onConfirm, onCancel: onCancel || function() {} };
    }
    function hideConfirm() {
        if (confirmEl) confirmEl.style.display = 'none';
        confirmResolve = null;
    }
    function onConfirmOk() {
        if (confirmResolve && confirmResolve.onConfirm) confirmResolve.onConfirm();
        hideConfirm();
    }
    function onConfirmCancel() {
        if (confirmResolve && confirmResolve.onCancel) confirmResolve.onCancel();
        hideConfirm();
    }
    if (confirmOk) confirmOk.addEventListener('click', onConfirmOk);
    if (confirmCancel) confirmCancel.addEventListener('click', onConfirmCancel);
    if (confirmOverlay) confirmOverlay.addEventListener('click', onConfirmCancel);

    function escapeHtml(s) {
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }
    function updateUi(data) {
        var running = data.statusRunning === true || data.statusRunning === '1';
        var statusVal = document.getElementById('admin-websocket-status-value');
        var statusDetails = document.getElementById('admin-websocket-status-details');
        var msgEl = document.getElementById('admin-websocket-message');
        if (statusVal) {
            statusVal.textContent = running ? 'Запущен' : 'Остановлен';
            statusVal.className = 'admin-card-value admin-websocket-status-value ' + (running ? 'running' : 'stopped');
        }
        if (statusDetails) {
            var details = data.statusDetails != null ? String(data.statusDetails) : '';
            statusDetails.textContent = details;
            statusDetails.style.display = details ? '' : 'none';
        }
        if (msgEl) {
            if (data.message) {
                msgEl.innerHTML = data.message;
                msgEl.className = 'admin-message admin-message--' + (data.messageType || '');
                msgEl.style.display = '';
            } else {
                msgEl.textContent = '';
                msgEl.style.display = 'none';
            }
        }
        document.querySelectorAll('.admin-websocket-form-action').forEach(function(form) {
            var action = (form.querySelector('input[name=action]') || {}).value;
            var btn = form.querySelector('button[type=submit]');
            if (!btn) return;
            if (action === 'start') btn.disabled = running;
            else btn.disabled = !running;
        });
        var logContent = document.getElementById('admin-websocket-log-content');
        if (logContent && data.logLines !== undefined) {
            if (data.logLines.length > 0) {
                logContent.innerHTML = '<pre class="admin-websocket-log-pre">' + data.logLines.map(escapeHtml).join('') + '</pre>' +
                    '<form method="post" class="admin-websocket-form admin-websocket-form-clear" data-confirm="Очистить журнал WebSocket? Текущее содержимое будет удалено.">' +
                    '<input type="hidden" name="action" value="clear_log">' +
                    '<button type="submit" class="btn btn-secondary">Очистить журнал</button></form>';
                logContent.querySelector('.admin-websocket-form-clear').addEventListener('submit', onSubmitClear);
            } else {
                logContent.innerHTML = '<p class="admin-websocket-log-empty">Журнал пуст или файл отсутствует.</p>';
            }
        }
    }
    function getFormActionUrl(form) {
        var a = form.getAttribute('action');
        if (a != null && String(a).trim() !== '') return a;
        return window.location.href.split('?')[0];
    }
    function doSubmitAction(form) {
        var fd = new FormData(form);
        fd.set('ajax', '1');
        var btn = form.querySelector('button[type=submit]');
        if (btn) btn.disabled = true;
        var url = getFormActionUrl(form);
        fetch(url, {
            method: 'POST',
            body: fd,
            credentials: 'same-origin',
            redirect: 'manual',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function(r) {
                if (r.type === 'opaqueredirect' || r.status === 302 || r.status === 301) {
                    throw new Error('Сессия истекла или требуется вход. Обновите страницу.');
                }
                if (!r.ok) {
                    return r.text().then(function(t) {
                        var msg = 'HTTP ' + r.status;
                        if (t && t.length < 150) msg += ': ' + t;
                        throw new Error(msg);
                    });
                }
                var ct = r.headers.get('Content-Type') || '';
                if (ct.indexOf('application/json') === -1) {
                    return r.text().then(function(t) {
                        throw new Error('Ответ не JSON. Обновите страницу или проверьте консоль.');
                    });
                }
                return r.json();
            })
            .then(function(data) {
                if (data && typeof data.statusRunning !== 'undefined') {
                    updateUi(data);
                } else {
                    throw new Error('Неверный ответ сервера');
                }
            })
            .catch(function(err) {
                if (btn) btn.disabled = false;
                showConfirm('Ошибка запроса: ' + (err.message || 'обновите страницу.'), function() {});
            });
    }
    function doSubmitClear(form) {
        var fd = new FormData(form);
        fd.set('ajax', '1');
        var url = getFormActionUrl(form);
        fetch(url, {
            method: 'POST',
            body: fd,
            credentials: 'same-origin',
            redirect: 'manual',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function(r) {
                if (r.type === 'opaqueredirect' || r.status === 302 || r.status === 301) {
                    throw new Error('Сессия истекла. Обновите страницу.');
                }
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var ct = r.headers.get('Content-Type') || '';
                if (ct.indexOf('application/json') === -1) throw new Error('Не JSON');
                return r.json();
            })
            .then(function(data) {
                if (data && typeof data.statusRunning !== 'undefined') updateUi(data);
                else location.reload();
            })
            .catch(function() { location.reload(); });
    }
    function onSubmitAction(e) {
        e.preventDefault();
        var form = e.target;
        var confirmMsg = form.getAttribute('data-confirm');
        if (confirmMsg) {
            showConfirm(confirmMsg, function() { doSubmitAction(form); }, function() {});
        } else {
            doSubmitAction(form);
        }
    }
    function onSubmitClear(e) {
        e.preventDefault();
        var form = e.target;
        var confirmMsg = form.getAttribute('data-confirm');
        if (confirmMsg) {
            showConfirm(confirmMsg, function() { doSubmitClear(form); }, function() {});
        } else {
            doSubmitClear(form);
        }
    }
    document.querySelectorAll('.admin-websocket-form-action').forEach(function(form) {
        form.addEventListener('submit', onSubmitAction);
    });
    var clearForm = document.querySelector('.admin-websocket-form-clear');
    if (clearForm) clearForm.addEventListener('submit', onSubmitClear);

    // Тумблер показа индикатора режима обновления (настройка для всех пользователей, сохраняется на сервере)
    var toggleInput = document.getElementById('adminShowConnectionStatus');
    var toggleLabel = document.getElementById('adminShowConnectionStatusLabel');
    if (toggleInput && toggleLabel) {
        toggleInput.addEventListener('change', function() {
            var show = toggleInput.checked;
            var prevChecked = !show;
            var fd = new FormData();
            fd.set('action', 'set_show_connection_status');
            fd.set('show', show ? '1' : '0');
            fd.set('ajax', '1');
            fetch(window.location.href, {
                method: 'POST',
                body: fd,
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data && data.success) {
                        toggleLabel.textContent = show ? 'Показывать' : 'Скрывать';
                    } else {
                        toggleInput.checked = prevChecked;
                        toggleLabel.textContent = prevChecked ? 'Показывать' : 'Скрывать';
                    }
                })
                .catch(function() {
                    toggleInput.checked = prevChecked;
                    toggleLabel.textContent = prevChecked ? 'Показывать' : 'Скрывать';
                });
        });
    }
})();
</script>

<?php include __DIR__ . '/footer.php'; ?>
