/**
 * Service Worker для Web Push уведомлений.
 * Должен находиться в корне приложения, чтобы scope был /sites/messenger/ (а не только /assets/).
 */

var pushFocusByClient = {};

self.addEventListener('message', function (event) {
    var data = event.data;
    if (data && data.type === 'pushFocus') {
        var key = event.source && (event.source.id || event.source.url);
        if (key !== undefined) {
            if (data.focused === true && data.conversationId != null) {
                pushFocusByClient[key] = { conversationId: data.conversationId, focused: true };
            } else {
                pushFocusByClient[key] = { conversationId: data.conversationId || null, focused: !!data.focused };
            }
        }
    }
});

self.addEventListener('push', function (event) {
    if (!event.data) return;
    var payload;
    try {
        payload = event.data.json();
    } catch (_) {
        payload = { title: 'Новое сообщение', body: '' };
    }
    var conversationId = payload.conversation_id;
    var title = payload.title || 'Мессенджер';
    var body = payload.body || '';
    var url = payload.url || '/';
    var isCall = payload.type === 'incoming_call';
    var tag = isCall ? 'call-' + (payload.call_id || conversationId || '') : 'message-' + (conversationId || '');
    var options = {
        body: body,
        icon: 'assets/favicon.svg',
        tag: tag,
        renotify: true,
        data: {
            url: url,
            conversationId: conversationId
        }
    };

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            var skip = false;
            if (!isCall && conversationId != null) {
                for (var i = 0; i < clientList.length; i++) {
                    var c = clientList[i];
                    var key = c.id || c.url;
                    var state = key ? pushFocusByClient[key] : null;
                    if (state && state.focused && state.conversationId == conversationId) {
                        skip = true;
                        break;
                    }
                }
            }
            if (!skip) {
                return self.registration.showNotification(title, options);
            }
        })
    );
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    const url = event.notification.data && event.notification.data.url;
    const targetUrl = url || self.location.origin + self.location.pathname.replace(/\/[^/]*$/, '/');
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
