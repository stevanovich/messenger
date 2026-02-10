/**
 * Web Push: регистрация Service Worker, подписка, тумблер в профиле.
 * Зависит от API_BASE и apiRequest (app.js).
 */

(function () {
    const PUSH_API = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/push_subscriptions.php';

    /**
     * Условия поддержки Web Push:
     * 1) Безопасный контекст: HTTPS или localhost.
     * 2) API Notification.
     * 3) API Service Worker (PushManager доступен только у registration.pushManager, не на navigator).
     */
    function isSupported() {
        return window.isSecureContext &&
            'Notification' in window &&
            'serviceWorker' in navigator;
    }

    /** Возвращает причину, по которой push не поддерживается (для подсказки пользователю). */
    function getUnsupportedReason() {
        if (!window.isSecureContext) {
            return 'Уведомления работают только по HTTPS (или на localhost). Откройте сайт по защищённому соединению.';
        }
        if (!('Notification' in window)) {
            return 'Браузер не поддерживает уведомления (Notification API).';
        }
        if (!('serviceWorker' in navigator)) {
            return 'Браузер не поддерживает Service Worker. Обновите браузер или используйте Chrome, Firefox, Edge.';
        }
        return null;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const output = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
            output[i] = rawData.charCodeAt(i);
        }
        return output;
    }

    async function getRegistration() {
        const base = typeof API_BASE !== 'undefined' ? API_BASE : (window.location.origin + window.location.pathname.replace(/\/[^/]*$/, ''));
        const swUrl = base + '/sw.js';
        return navigator.serviceWorker.register(swUrl);
    }

    async function fetchJson(url, options) {
        const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
        const text = await res.text();
        let data = null;
        try {
            if (text && text.trim().startsWith('{')) data = JSON.parse(text);
        } catch (_) {}
        if (!data && !res.ok) {
            if (res.status === 503) throw new Error('Push-уведомления не настроены на сервере. Задайте VAPID-ключи в config (см. план).');
            throw new Error('Ответ сервера не в формате JSON. Проверьте настройки.');
        }
        return { res, data: data || {} };
    }

    async function getPublicKey() {
        const { res, data } = await fetchJson(PUSH_API);
        if (!res.ok) throw new Error((data && data.error) || 'Ошибка');
        const key = (data.data && data.data.public_key) ? data.data.public_key : (data.public_key || '');
        if (!key) throw new Error('Push не настроен на сервере (нет публичного ключа).');
        return key;
    }

    async function enableNotifications() {
        if (!isSupported()) return { ok: false, error: 'Не поддерживается' };
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return { ok: false, error: 'Разрешение не дано' };
            await getRegistration();
            const reg = await navigator.serviceWorker.ready;
            await reg.update();
            const key = await getPublicKey();
            const subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key)
            });
            const subJson = subscription.toJSON();
            const body = {
                subscription: {
                    endpoint: subJson.endpoint,
                    keys: { p256dh: subJson.keys && subJson.keys.p256dh, auth: subJson.keys && subJson.keys.auth }
                }
            };
            const { res, data } = await fetchJson(PUSH_API, { method: 'POST', body: JSON.stringify(body) });
            if (!res.ok) throw new Error((data && data.error) || 'Ошибка сохранения подписки');
            return { ok: true };
        } catch (e) {
            var msg = e.message || 'Ошибка';
            var isEdgeBlock = e.name === 'AbortError' || (msg && (msg.indexOf('push service error') !== -1 || msg.indexOf('Registration failed') !== -1));
            if (isEdgeBlock) {
                msg = 'Браузер заблокировал подписку. В Edge: Настройки → Конфиденциальность → Предотвращение отслеживания → добавьте этот сайт в исключения.';
                console.warn('Push: ' + msg, e);
            } else {
                console.error('Push enable error:', e);
            }
            return { ok: false, error: msg };
        }
    }

    async function disableNotifications() {
        if (!isSupported()) return { ok: false };
        try {
            const reg = await navigator.serviceWorker.ready;
            const subscription = await reg.pushManager.getSubscription();
            if (subscription) {
                try {
                    await fetch(PUSH_API, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoint: subscription.endpoint })
                    });
                } catch (_) {}
                await subscription.unsubscribe();
            }
            return { ok: true };
        } catch (e) {
            console.error('Push disable error:', e);
            return { ok: false };
        }
    }

    async function refreshSubscription() {
        if (!isSupported()) return;
        try {
            const reg = await navigator.serviceWorker.getRegistration(
                (typeof API_BASE !== 'undefined' ? API_BASE : window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '')) + '/'
            );
            if (!reg) return;
            const sub = await reg.pushManager.getSubscription();
            if (!sub || !sub.endpoint) return;
            const subJson = sub.toJSON();
            const body = { subscription: { endpoint: subJson.endpoint, keys: { p256dh: subJson.keys && subJson.keys.p256dh, auth: subJson.keys && subJson.keys.auth } } };
            await fetch(PUSH_API, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } catch (_) {}
    }

    async function getSubscriptionStatus() {
        if (!isSupported()) return { supported: false, subscribed: false, permission: 'denied' };
        const permission = Notification.permission;
        let subscribed = false;
        try {
            const reg = await navigator.serviceWorker.getRegistration(
                (typeof API_BASE !== 'undefined' ? API_BASE : window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '')) + '/'
            );
            if (reg) {
                const sub = await reg.pushManager.getSubscription();
                if (sub && sub.endpoint) {
                    const res = await fetch(PUSH_API + '?endpoint=' + encodeURIComponent(sub.endpoint), { credentials: 'include' });
                    const data = await res.json();
                    subscribed = !!(data.data && data.data.subscribed);
                }
            }
        } catch (_) {}
        return { supported: true, subscribed, permission };
    }

    function updateToggleUI(container, status) {
        if (!container) return;
        const toggle = container.querySelector('.profile-notifications-toggle-input');
        const statusEl = container.querySelector('.profile-notifications-status');
        const label = container.querySelector('.profile-notifications-label');
        if (!status.supported) {
            if (label) label.classList.add('disabled');
            if (toggle) { toggle.checked = false; toggle.disabled = true; }
            if (statusEl) statusEl.textContent = typeof getUnsupportedReason === 'function' ? getUnsupportedReason() : 'Не поддерживается в этом браузере';
            return;
        }
        if (label) label.classList.remove('disabled');
        if (toggle) toggle.disabled = false;
        if (toggle) toggle.checked = status.subscribed;
        if (statusEl) {
            if (status.subscribed) statusEl.textContent = 'Включены';
            else if (status.permission === 'denied') statusEl.textContent = 'Разрешите уведомления в настройках браузера';
            else statusEl.textContent = 'Выключены';
        }
    }

    function initProfileToggle() {
        const container = document.getElementById('profileNotificationsBlock');
        if (!container) return;
        const toggle = container.querySelector('.profile-notifications-toggle-input');
        if (!toggle) return;

        getSubscriptionStatus().then(function (status) {
            updateToggleUI(container, status);
            if (status.supported && status.subscribed) {
                refreshSubscription();
            }
        });

        toggle.addEventListener('change', async function () {
            const on = toggle.checked;
            if (on) {
                toggle.disabled = true;
                const result = await enableNotifications();
                const status = await getSubscriptionStatus();
                updateToggleUI(container, status);
                toggle.disabled = false;
                if (!result.ok && result.error) {
                    const statusEl = container.querySelector('.profile-notifications-status');
                    if (statusEl) statusEl.textContent = result.error;
                    toggle.checked = false;
                }
            } else {
                toggle.disabled = true;
                await disableNotifications();
                const status = await getSubscriptionStatus();
                updateToggleUI(container, status);
                toggle.disabled = false;
            }
        });
    }

    function notifyConversationFocus(conversationId, focused) {
        if (!isSupported()) return;
        var controller = navigator.serviceWorker.controller;
        if (controller) {
            try {
                controller.postMessage({ type: 'pushFocus', conversationId: conversationId != null ? conversationId : null, focused: !!focused });
            } catch (e) {
                // После обновления SW контроллер может быть не активным для клиента — игнорируем
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (document.body.dataset.userUuid) initProfileToggle();
            window.addEventListener('focus', function () {
                var id = (typeof window.chatModule !== 'undefined' && window.chatModule.currentConversationId) ? window.chatModule.currentConversationId() : null;
                notifyConversationFocus(id, true);
            });
            window.addEventListener('blur', function () {
                notifyConversationFocus(null, false);
            });
        });
    } else {
        if (document.body.dataset.userUuid) initProfileToggle();
        window.addEventListener('focus', function () {
            var id = (typeof window.chatModule !== 'undefined' && window.chatModule.currentConversationId) ? window.chatModule.currentConversationId() : null;
            notifyConversationFocus(id, true);
        });
        window.addEventListener('blur', function () {
            notifyConversationFocus(null, false);
        });
    }

    window.pushModule = {
        isSupported: isSupported,
        getUnsupportedReason: getUnsupportedReason,
        enable: enableNotifications,
        disable: disableNotifications,
        getStatus: getSubscriptionStatus,
        updateToggleUI: updateToggleUI,
        notifyConversationFocus: notifyConversationFocus,
        refreshSubscription: refreshSubscription
    };
})();
