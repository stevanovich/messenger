// Polling для обновления сообщений и чатов

let pollingInterval = null;
let isPollingActive = false;

// Инициализация polling
document.addEventListener('DOMContentLoaded', () => {
    startPolling();
    
    // Остановка polling при скрытии вкладки
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPolling();
        } else {
            startPolling();
        }
    });
});

// Запуск polling (не запускаем, если WebSocket уже подключён)
function startPolling() {
    if (isPollingActive) return;
    if (window.websocketModule && typeof window.websocketModule.isConnected === 'function' && window.websocketModule.isConnected()) return;
    
    isPollingActive = true;
    setConnectionStatusPolling();
    pollingInterval = setInterval(() => {
        pollUpdates();
    }, POLLING_INTERVAL);
    
    // Первый запрос сразу
    pollUpdates();
}

function setConnectionStatusPolling() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    // Не перезаписываем, если WebSocket ещё в процессе подключения
    if (el.classList.contains('connection-status--connecting')) return;
    el.textContent = 'По запросу';
    el.className = 'connection-status connection-status--polling';
    el.title = 'Обновление по запросу (polling)';
    if (typeof window.applyConnectionStatusVisibility === 'function') {
        window.applyConnectionStatusVisibility();
    }
}

// Остановка polling
function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    isPollingActive = false;
}

// Polling обновлений
async function pollUpdates() {
    try {
        // Обновление списка чатов
        await pollConversations();
        
        // Обновление сообщений и реакций в текущем чате
        if (window.chatModule && window.chatModule.currentConversationId()) {
            await pollMessages();
            await pollReactions();
        }
    } catch (error) {
        console.error('Polling error:', error);
    }
}

// Обновление списка чатов
async function pollConversations() {
    try {
        const data = await apiRequest(`${API_BASE}/api/conversations.php`);
        const newConversations = data.data.conversations || [];
        
        // Проверка изменений
        const currentConversations = window.chatModule?.conversations() || [];
        if (JSON.stringify(newConversations) !== JSON.stringify(currentConversations)) {
            if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                window.chatModule.loadConversations();
            }
        }
    } catch (error) {
        // Тихая ошибка при polling
        console.debug('Conversations polling error:', error);
    }
}

// Обновление сообщений
async function pollMessages() {
    const conversationId = window.chatModule?.currentConversationId();
    if (!conversationId) return;
    
    try {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        // Получаем ID последнего сообщения (последний .message, т.к. в контейнере есть разделители дат)
        const lastMessage = window.chatModule?.getLastMessageElement?.(chatMessages) ?? chatMessages.querySelector('.message:last-child');
        const lastMessageId = lastMessage 
            ? parseInt(lastMessage.dataset.messageId || '0')
            : 0;
        
        if (lastMessageId === 0) return;
        
        const url = `${API_BASE}/api/messages.php?conversation_id=${conversationId}&last_message_id=${lastMessageId}&limit=50`;
        const data = await apiRequest(url);
        const newMessages = data.data.messages || [];
        
        if (newMessages.length > 0) {
            let toAdd = newMessages.filter(m => !chatMessages.querySelector(`.message[data-message-id="${m.id}"]`));
            if (toAdd.length > 0 && window.chatModule?.renderMessages) {
                if (window.chatModule.ensureMessagesDecryptedForConversation) {
                    toAdd = await window.chatModule.ensureMessagesDecryptedForConversation(conversationId, toAdd);
                }
                window.chatModule.renderMessages(toAdd, false, { skipScroll: true });
            }
            const currentUserUuid = document.body.dataset.userUuid || '';
            const otherMessageIds = newMessages.filter(m => m.user_uuid !== currentUserUuid).map(m => m.id);
            if (otherMessageIds.length > 0 && window.chatModule?.markDelivered) {
                window.chatModule.markDelivered(conversationId, otherMessageIds);
            }
            
            // Прокрутка вниз только если пользователь уже внизу
            const isScrolledToBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 100;
            if (isScrolledToBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
                // Пользователь видит новые сообщения — отмечаем как прочитанное
                const hasOtherUserMessage = newMessages.some(m => m.user_uuid !== currentUserUuid);
                if (hasOtherUserMessage && window.chatModule?.markConversationAsRead) {
                    window.chatModule.markConversationAsRead(conversationId);
                }
            }
            
            // Обновление списка чатов
            if (window.chatModule && typeof window.chatModule.loadConversations === 'function') {
                window.chatModule.loadConversations();
            }
        }
    } catch (error) {
        // Тихая ошибка при polling
        console.debug('Messages polling error:', error);
    }
}

// Обновление реакций на сообщения (чтобы участники видели реакции друг друга)
async function pollReactions() {
    const conversationId = window.chatModule?.currentConversationId();
    if (!conversationId) return;
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const messageEls = chatMessages.querySelectorAll('.message[data-message-id]');
    if (messageEls.length === 0) return;
    const messageIds = Array.from(messageEls)
        .map(el => parseInt(el.dataset.messageId || '0', 10))
        .filter(id => id > 0)
        .slice(-50);
    if (messageIds.length === 0) return;
    try {
        const url = `${API_BASE}/api/reactions.php?conversation_id=${conversationId}&message_ids=${messageIds.join(',')}`;
        const data = await apiRequest(url);
        const reactionsByMessage = data.data.reactions || {};
        const currentUserUuid = document.body.dataset.userUuid || '';
        const now = Date.now();
        const reactionGraceMs = 3000;
        for (const messageId of messageIds) {
            const reactions = reactionsByMessage[messageId];
            if (reactions === undefined) continue;
            const lastUpdated = (window.__reactionUpdateTime || {})[String(messageId)] || 0;
            if (now - lastUpdated < reactionGraceMs) continue;
            const msgEl = chatMessages.querySelector(`.message[data-message-id="${messageId}"]`);
            if (!msgEl) continue;
            const bubble = msgEl.querySelector('.message-bubble');
            if (!bubble) continue;
            let wrap = msgEl.querySelector('.message-reactions');
            if (wrap) wrap.remove();
            if (reactions.length > 0) {
                const div = document.createElement('div');
                div.className = 'message-reactions';
                const buildOne = (typeof window.buildOneReactionHtml === 'function') ? window.buildOneReactionHtml : r => {
                    const own = r.has_own ? ' own-reaction' : '';
                    const countHtml = r.count > 1 ? `<span class="message-reaction-count">${r.count}</span>` : '';
                    return `<span class="message-reaction${own}" data-emoji="${escapeHtml(r.emoji)}">${r.emoji}${countHtml}</span>`;
                };
                div.innerHTML = reactions.map(buildOne).join('');
                bubble.appendChild(div);
                div.querySelectorAll('.message-reaction').forEach(el => {
                    el.addEventListener('click', (e) => {
                        if (e.target.closest('.message-reaction-avatar')) return;
                        if (window.chatModule && typeof window.chatModule.toggleReaction === 'function') {
                            window.chatModule.toggleReaction(messageId, el.dataset.emoji, null);
                        }
                    });
                });
                div.querySelectorAll('.message-reaction-avatar[data-user-uuid]').forEach(avatarEl => {
                    avatarEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const u = avatarEl.dataset.userUuid;
                        if (u && typeof openUserProfileModal === 'function') openUserProfileModal(u);
                    });
                });
            }
        }
    } catch (error) {
        console.debug('Reactions polling error:', error);
    }
}

// Простая функция создания элемента сообщения (fallback)
function createMessageElementSimple(message, currentUserUuid) {
    const isOwn = message.user_uuid === currentUserUuid;
    const isCall = message.type === 'call';
    const conv = window.chatModule?.conversations?.();
    const convId = window.chatModule?.currentConversationId?.();
    const isPrivateChat = conv?.find(c => c.id === convId)?.type === 'private';
    const showUsername = !isOwn && !isPrivateChat && !isCall;
    const callVideo = isCall && /^(Видеозвонок|Групповой видеозвонок)/i.test((message.content || '').trim());
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}${isCall ? ' message-call' + (callVideo ? ' message-call-video' : ' message-call-voice') : ''}`;
    div.dataset.messageId = message.id;
    if (message.created_at) div.dataset.createdAt = message.created_at;

    const isVideoMedia = (p, n) => /\.(mp4|webm|mov)(\?|$)/i.test((p || '') + (n || ''));
    let contentHtml = '';
    if (message.type === 'sticker') {
        if (message.file_path && message.file_path.indexOf('emoji:') === 0) {
            contentHtml = `<span class="message-sticker-emoji">${message.file_path.substring(6)}</span>`;
        } else if (message.file_path) {
            let path = message.file_path;
            if (path.indexOf('sticker_file.php') === -1 && path.indexOf('uploads/stickers/') !== -1) {
                const m = path.match(/uploads\/stickers\/[^\s?"']+/);
                if (m) path = (API_BASE || '').replace(/\/$/, '') + '/api/sticker_file.php?path=' + encodeURIComponent(m[0]);
            } else if (!path.startsWith('http') && !path.startsWith('/')) {
                path = (API_BASE || '') + '/' + path.replace(/^\/+/, '');
            }
            contentHtml = isVideoMedia(message.file_path, message.file_name)
                ? `<video src="${escapeHtml(path)}" class="message-sticker-img message-media-video" controls loop muted playsinline></video>`
                : `<img src="${escapeHtml(path)}" alt="Стикер" class="message-sticker-img">`;
        } else {
            contentHtml = `<span class="message-sticker-emoji">${escapeHtml(message.content || '')}</span>`;
        }
    } else if (message.type === 'image' && message.file_path) {
        contentHtml = `<img src="${escapeHtml(message.file_path)}" alt="Изображение" class="message-image">`;
    } else if (message.type === 'file' && (message.file_name || message.file_path)) {
        const fp = message.file_path || '';
        contentHtml = isVideoMedia(fp, message.file_name)
            ? `<video src="${escapeHtml(fp)}" class="message-media-video" controls loop muted playsinline></video>`
            : `<a href="${escapeHtml(fp)}" target="_blank">📎 ${escapeHtml(message.file_name || 'Файл')}</a>`;
    } else if (message.type === 'call') {
        const callContent = (message.content || '').trim();
        const escaped = escapeHtml(callContent).replace(/, длительность /g, '<br>длительность ');
        const groupCallId = message.group_call_id;
        contentHtml = `<span class="message-call-content" data-call-type="${callVideo ? 'video' : 'voice'}">${escaped}</span>`;
        if (groupCallId) {
            contentHtml += ` <button type="button" class="message-call-participants-link" data-group-call-id="${escapeHtml(String(groupCallId))}">Участники</button>`;
        }
    } else {
        contentHtml = escapeHtml(message.content || '');
    }
    
    div.innerHTML = `
        <div class="message-bubble">
            ${showUsername ? `<div class="message-header">
                ${message.user_uuid ? `<button type="button" class="message-username message-username-link" data-user-uuid="${escapeHtml(message.user_uuid)}" title="Открыть профиль">${escapeHtml(message.username)}</button>` : `<span class="message-username">${escapeHtml(message.username)}</span>`}
            </div>` : ''}
            <div>${contentHtml}</div>
            <div class="message-time">${formatMessageTime(message.created_at)}</div>
        </div>
    `;
    
    return div;
}

// Экспорт функций
window.pollingModule = {
    start: startPolling,
    stop: stopPolling
};
