// WebSocket-клиент: реальное время сообщений и реакций.
// Токен получаем через GET /api/auth.php?action=ws_token, первое сообщение — auth.
// При успешном соединении polling не запускается; при обрыве — fallback на polling.

(function() {
    const API_BASE = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
    let ws = null;
    let authenticated = false;
    let reconnectAttempts = 0;
    let authFailed401 = false; // при 401 от ws_token не переподключаемся
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_BASE_MS = 1000;
    let reconnectTimer = null;

    // Включить логи для отладки: ?ws_debug=1 в URL или localStorage.setItem('ws_debug','1')
    function dbg() {
        if (window.location.search.indexOf('ws_debug=1') !== -1 || (typeof localStorage !== 'undefined' && localStorage.getItem('ws_debug'))) {
            console.log.apply(console, ['[WS]'].concat(Array.prototype.slice.call(arguments)));
        }
    }

    function getWsUrl() {
        const url = document.body && document.body.dataset && document.body.dataset.wsUrl;
        dbg('getWsUrl:', url ? url : '(нет data-ws-url)');
        return (url && url.trim()) || null;
    }

    function setConnectionStatus(mode, label, title) {
        const el = document.getElementById('connectionStatus');
        if (!el) return;
        el.textContent = label || '';
        el.className = 'connection-status connection-status--' + (mode || '');
        el.title = title || (mode === 'ws' ? 'Обновления в реальном времени (WebSocket)' : mode === 'polling' ? 'Обновление по запросу (polling)' : 'Режим обновления чата');
        if (typeof window.applyConnectionStatusVisibility === 'function') {
            window.applyConnectionStatusVisibility();
        }
    }

    function isConnected() {
        return authenticated && ws && ws.readyState === WebSocket.OPEN;
    }

    function stopPollingFallback() {
        if (window.pollingModule && typeof window.pollingModule.stop === 'function') {
            window.pollingModule.stop();
        }
    }

    function startPollingFallback() {
        if (window.pollingModule && typeof window.pollingModule.start === 'function') {
            window.pollingModule.start();
        }
    }

    function applyReactionUpdate(messageId, reactions) {
        var lastUpdated = (window.__reactionUpdateTime || {})[String(messageId)] || 0;
        if (Date.now() - lastUpdated < 3000) return;
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        const msgEl = chatMessages.querySelector('.message[data-message-id="' + messageId + '"]');
        if (!msgEl) return;
        const bubble = msgEl.querySelector('.message-bubble');
        if (!bubble) return;
        let wrap = msgEl.querySelector('.message-reactions');
        if (wrap) wrap.remove();
        const currentUserUuid = document.body.dataset.userUuid || '';
        if (reactions && reactions.length > 0) {
            const div = document.createElement('div');
            div.className = 'message-reactions';
            const buildOne = (typeof window.buildOneReactionHtml === 'function') ? window.buildOneReactionHtml : function(r) {
                const own = (r.has_own ? ' own-reaction' : '');
                const countHtml = (r.count > 1 ? '<span class="message-reaction-count">' + (typeof escapeHtml !== 'undefined' ? escapeHtml(String(r.count)) : r.count) + '</span>' : '');
                const emoji = (typeof escapeHtml !== 'undefined' ? escapeHtml(r.emoji) : r.emoji);
                return '<span class="message-reaction' + own + '" data-emoji="' + emoji + '">' + emoji + countHtml + '</span>';
            };
            div.innerHTML = reactions.map(buildOne).join('');
            bubble.appendChild(div);
            div.querySelectorAll('.message-reaction').forEach(function(el) {
                el.addEventListener('click', function(e) {
                    if (e.target.closest && e.target.closest('.message-reaction-avatar')) return;
                    if (window.chatModule && typeof window.chatModule.toggleReaction === 'function') {
                        window.chatModule.toggleReaction(messageId, el.dataset.emoji, null);
                    }
                });
            });
            div.querySelectorAll('.message-reaction-avatar[data-user-uuid]').forEach(function(avatarEl) {
                avatarEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var u = avatarEl.dataset.userUuid;
                    if (u && typeof openUserProfileModal === 'function') openUserProfileModal(u);
                });
            });
        }
    }

    function handleMessage(eventType, data) {
        if (eventType === 'message.new' && data) {
            const conversationId = data.conversation_id != null ? parseInt(data.conversation_id, 10) : null;
            const currentId = window.chatModule && window.chatModule.currentConversationId ? window.chatModule.currentConversationId() : null;
            let message = data.message || data;
            if (message && message.conversation_id === undefined && conversationId != null) message.conversation_id = conversationId;
            const currentUserUuid = document.body.dataset.userUuid || '';

            if (conversationId === currentId && message) {
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages && window.chatModule && typeof window.chatModule.createMessageElement === 'function') {
                    if (!chatMessages.querySelector('.message[data-message-id="' + message.id + '"]')) {
                        (async function () {
                            let msg = message;
                            if (window.chatModule.ensureMessagesDecryptedForConversation && (msg.encrypted === 1 || msg.encrypted === '1')) {
                                const decrypted = await window.chatModule.ensureMessagesDecryptedForConversation(conversationId, [msg]);
                                if (decrypted && decrypted[0]) msg = decrypted[0];
                            }
                            if (window.chatModule.insertDateSeparatorIfNeeded) {
                                window.chatModule.insertDateSeparatorIfNeeded(chatMessages, msg.created_at);
                            }
                            const messageEl = window.chatModule.createMessageElement(msg, currentUserUuid);
                            chatMessages.appendChild(messageEl);
                            if (msg.user_uuid !== currentUserUuid && window.chatModule.markDelivered) {
                                window.chatModule.markDelivered(conversationId, [msg.id]);
                            }
                            const isScrolledToBottom = chatMessages && chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 100;
                            if (isScrolledToBottom) {
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                                if (msg.user_uuid !== currentUserUuid && window.chatModule.markConversationAsRead) {
                                    window.chatModule.markConversationAsRead(conversationId);
                                }
                            }
                        })();
                    }
                }
            } else {
                if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                    window.chatModule.loadConversations();
                }
            }
            return;
        }

        if (eventType === 'reaction.update' && data) {
            const messageId = data.message_id;
            const reactions = data.reactions || [];
            if (messageId) applyReactionUpdate(parseInt(messageId, 10), reactions);
            return;
        }

        if (eventType === 'message.status_update' && data) {
            const messageId = data.message_id;
            const deliveryCount = data.delivery_count || 0;
            const readCount = data.read_count || 0;
            const readDetails = data.read_details || [];
            const recipientCount = data.recipient_count || 1;
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages || !messageId) return;
            const msgEl = chatMessages.querySelector('.message[data-message-id="' + messageId + '"]');
            if (!msgEl) return;
            const statusEl = msgEl.querySelector('.message-status');
            if (statusEl && window.chatModule && typeof window.chatModule.updateMessageStatus === 'function') {
                window.chatModule.updateMessageStatus(statusEl, { delivery_count: deliveryCount, read_count: readCount, read_details: readDetails, recipient_count: recipientCount });
            }
            return;
        }

        if (eventType === 'message.deleted' && data) {
            const conversationId = data.conversation_id != null ? parseInt(data.conversation_id, 10) : null;
            const currentId = window.chatModule && window.chatModule.currentConversationId ? window.chatModule.currentConversationId() : null;
            if (conversationId !== currentId) return;
            const messageId = data.message_id;
            const permanent = data.permanent === true;
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages || !messageId) return;
            const msgEl = chatMessages.querySelector('.message[data-message-id="' + messageId + '"]');
            if (!msgEl) return;
            if (permanent) {
                msgEl.remove();
            } else {
                const bubble = msgEl.querySelector('.message-bubble');
                if (bubble) {
                    bubble.innerHTML = '<div class="message-content message-deleted">Сообщение удалено</div>';
                    bubble.classList.add('message-deleted-bubble');
                }
            }
            return;
        }

        if (eventType === 'conversation.updated') {
            if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                window.chatModule.loadConversations();
            }
        }
    }

    function connect() {
        if (authFailed401) {
            dbg('connect пропущен: ранее получен 401');
            return;
        }
        const wsUrl = getWsUrl();
        dbg('connect attempt', reconnectAttempts + 1, 'wsUrl=', wsUrl);
        if (!wsUrl) {
            dbg('нет URL → polling');
            setConnectionStatus('polling', 'По запросу', 'WebSocket недоступен, используется обновление по запросу');
            reconnectAttempts++;
            if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                reconnectTimer = setTimeout(connect, RECONNECT_BASE_MS * Math.min(reconnectAttempts, 5));
            }
            return;
        }

        ws = new WebSocket(wsUrl);
        authenticated = false;
        dbg('WebSocket создан, readyState=', ws.readyState);

        ws.onopen = function() {
            dbg('onopen, запрашиваю токен:', API_BASE + '/api/auth.php?action=ws_token');
            reconnectAttempts = 0;
            fetch(API_BASE + '/api/auth.php?action=ws_token', { credentials: 'same-origin' })
                .then(function(r) {
                    dbg('fetch ws_token status:', r.status, r.ok);
                    if (r.status === 401) {
                        authFailed401 = true;
                        if (ws) ws.close();
                        if (reconnectTimer) clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                        console.warn('[WS] Не авторизован (401). Войдите в аккаунт. Переподключение отключено.');
                        return Promise.reject(new Error('Unauthorized'));
                    }
                    return r.json();
                })
                .then(function(res) {
                    if (!res || res === undefined) return;
                    // API возвращает { success: true, data: { token, expires_at } }
                    const data = (res && res.data) ? res.data : res;
                    const token = (data && data.token) ? data.token : null;
                    dbg('токен получен:', token ? 'да, длина ' + String(token).length : 'нет', 'res=', res);
                    if (!token || !ws || ws.readyState !== WebSocket.OPEN) {
                        dbg('не отправляю auth: нет токена или WS закрыт', !token, ws ? ws.readyState : 'no ws');
                        if (ws) ws.close();
                        return;
                    }
                    ws.send(JSON.stringify({ type: 'auth', token: token }));
                    dbg('auth отправлен по WebSocket');
                })
                .catch(function(err) {
                    if (err && err.message === 'Unauthorized') return;
                    dbg('fetch ws_token ошибка:', err);
                    if (ws) ws.close();
                });
        };

        ws.onmessage = function(ev) {
            try {
                const msg = JSON.parse(ev.data);
                const type = msg && msg.type;
                dbg('onmessage type=', type, type === 'auth_ok' || type === 'auth_error' ? msg : '');
                if (type === 'auth_ok') {
                    authenticated = true;
                    dbg('auth_ok → устанавливаю статус Реальное время');
                    setConnectionStatus('ws', 'Реальное время', 'Обновления в реальном времени (WebSocket)');
                    stopPollingFallback();
                    return;
                }
                if (type === 'auth_error') {
                    dbg('auth_error:', msg.message || msg);
                    authenticated = false;
                    setConnectionStatus('polling', 'По запросу', 'Обновление по запросу (polling)');
                    if (ws) ws.close();
                    return;
                }
                if (type === 'subscribed') return;
                if (type === 'message.new' || type === 'reaction.update' || type === 'message.deleted' || type === 'message.status_update' || type === 'conversation.updated') {
                    handleMessage(type, msg.data || msg);
                }
                if (type && type.indexOf('call.') === 0) {
                    if (window.Calls && typeof window.Calls.onWebSocketEvent === 'function') {
                        window.Calls.onWebSocketEvent(type, msg.data || msg);
                    }
                }
            } catch (e) {
                console.debug('WebSocket message parse error', e);
                dbg('parse error', e);
            }
        };

        ws.onclose = function(ev) {
            dbg('onclose code=', ev ? ev.code : '', 'reason=', ev ? ev.reason : '');
            authenticated = false;
            ws = null;
            if (!authFailed401 && ev && (ev.code !== 1000 || ev.reason)) {
                console.warn('WebSocket closed:', ev.code, ev.reason || '(no reason)');
            }
            // Не запускаем polling, если вкладка в фоне (сеть приостановлена). При возврате на вкладку polling запустит visibilitychange в polling.js.
            if (!document.hidden) {
                startPollingFallback();
            }
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            if (authFailed401) return;
            reconnectAttempts++;
            if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                reconnectTimer = setTimeout(connect, RECONNECT_BASE_MS * Math.min(reconnectAttempts, 5));
            }
        };

        ws.onerror = function(ev) {
            dbg('onerror', ev && ev.type);
            console.warn('WebSocket error:', ev && ev.type, wsUrl);
        };
    }

    function subscribe(conversationId) {
        if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated) return;
        const id = conversationId != null && conversationId > 0 ? parseInt(conversationId, 10) : null;
        ws.send(JSON.stringify({ type: 'subscribe', conversation_id: id }));
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (!document.body.dataset.userUuid) return;
        connect();
    });

    window.websocketModule = {
        isConnected: isConnected,
        subscribe: subscribe,
        connect: connect
    };
})();
