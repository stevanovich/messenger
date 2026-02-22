// Жесты: долгое нажатие (longpress), свайпы

const LONG_PRESS_MS = 500;
let longPressTimer = null;
let touchStartX = 0, touchStartY = 0;

document.addEventListener('DOMContentLoaded', () => {
    setupLongPress();
    setupDeleteChatModal();
    setupSwipeOnMessages();
});
window.initChatSwipe = setupSwipeOnChatItems;

/** Модальное окно подтверждения удаления чата: скрыть для себя или удалить для всех */
function setupDeleteChatModal() {
    const modal = document.getElementById('modalDeleteChat');
    const btnCancel = document.getElementById('modalDeleteChatCancel');
    const btnHide = document.getElementById('modalDeleteChatHide');
    const btnForAll = document.getElementById('modalDeleteChatForAll');
    const btnClose = document.getElementById('modalDeleteChatClose');
    if (!modal || !btnCancel || !btnHide || !btnForAll) return;

    let pendingConvId = null;
    let pendingRow = null;

    function closeModal() {
        modal.classList.add('is-hidden');
        if (pendingRow) delete pendingRow.dataset.swipeTriggered;
        pendingConvId = null;
        pendingRow = null;
    }

    function runDelete(forEveryone) {
        const convId = pendingConvId;
        if (convId != null && window.chatModule && typeof window.chatModule.deleteConversation === 'function') {
            window.chatModule.deleteConversation(convId, forEveryone);
        }
        closeModal();
    }

    btnHide.addEventListener('click', () => runDelete(false));
    btnForAll.addEventListener('click', () => runDelete(true));
    btnCancel.addEventListener('click', closeModal);
    btnClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    window.showDeleteChatConfirm = function (convId, row) {
        pendingConvId = convId;
        pendingRow = row;
        const conv = window.chatModule && typeof window.chatModule.conversations === 'function'
            ? window.chatModule.conversations().find(c => c.id == convId)
            : null;
        const isGroupOrExternal = conv && (conv.type === 'group' || conv.type === 'external');
        const canDeleteForAll = !isGroupOrExternal || (conv && conv.my_role === 'admin');
        btnForAll.style.display = canDeleteForAll ? '' : 'none';
        modal.classList.remove('is-hidden');
    };
}

const LONG_PRESS_MOVE_THRESHOLD = 10; // пикселей: движение больше — считаем жестом выделения, long-press отменяем

function setupLongPress() {
    document.addEventListener('touchstart', (e) => {
        const target = e.target.closest('.message-bubble');
        if (!target) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            const messageEl = target.closest('.message');
            const messageId = messageEl && messageEl.dataset.messageId;
            if (messageId) {
                const rect = target.getBoundingClientRect();
                const ev = { clientX: rect.left + 20, clientY: rect.top, target };
                if (window.chatModule && typeof window.chatModule.showReactionPicker === 'function') {
                    window.chatModule.showReactionPicker(ev, parseInt(messageId));
                } else if (window.showReactionPicker) {
                    window.showReactionPicker(ev, parseInt(messageId));
                }
            }
        }, LONG_PRESS_MS);
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!longPressTimer || !e.touches.length) return;
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.abs(dx) > LONG_PRESS_MOVE_THRESHOLD || Math.abs(dy) > LONG_PRESS_MOVE_THRESHOLD) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.message-bubble')) {
            // Контекстное меню (правый клик) обрабатывается в chat.js
        }
    });
}

function setupSwipeOnChatItems() {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList || chatsList._swipeInited) return;
    chatsList._swipeInited = true;

    let startX = 0, startY = 0, currentX = 0, currentY = 0;
    let activeRow = null;
    let activeContent = null;
    const SWIPE_THRESHOLD = 60;
    const HORIZONTAL_LOCK_THRESHOLD = 15;

    function getActionWidth(row) {
        const action = row ? row.querySelector('.chat-item-action-delete') : null;
        return action ? action.offsetWidth : 256;
    }

    function getClientXY(e) {
        if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function getRowAndContent(target) {
        const row = target && target.closest ? target.closest('.chat-item-row') : null;
        const content = row ? row.querySelector('.chat-item-swipe-content') : null;
        return { row, content };
    }

    function applyTransform(content, diff, actionWidth) {
        if (!content) return;
        const w = actionWidth || 256;
        const tx = Math.max(-w, Math.min(0, diff));
        content.style.transform = `translateX(${tx}px)`;
    }

    function resetTransform(content) {
        if (content) content.style.transform = '';
    }

    function handleStart(e) {
        if (!chatsList.contains(e.target)) return;
        const { row, content } = getRowAndContent(e.target);
        if (!row || !content) return;
        if (row.dataset.userUuid) return; // свайп только для бесед, не для контактов без переписки
        activeRow = row;
        activeContent = content;
        const xy = getClientXY(e);
        startX = xy.x; startY = xy.y;
        currentX = startX; currentY = startY;
    }

    function handleMove(e) {
        if (!activeRow || !activeContent) return;
        const xy = getClientXY(e);
        currentX = xy.x; currentY = xy.y;
        const diffX = currentX - startX;
        const diffY = currentY - startY;
        if (e.cancelable && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > HORIZONTAL_LOCK_THRESHOLD) {
            e.preventDefault();
        }
        applyTransform(activeContent, diffX, getActionWidth(activeRow));
    }

    function handleEnd(e) {
        const row = activeRow;
        const content = activeContent;
        activeRow = null;
        activeContent = null;
        if (!row || !content) return;
        const diff = currentX - startX;
        resetTransform(content);
        const actionWidth = getActionWidth(row);
        if (diff < -SWIPE_THRESHOLD) {
            if (typeof trackEvent === 'function') trackEvent('chat_swipe_left', { conversation_id: row.dataset.conversationId });
            row.dataset.swipeTriggered = '1';
            const convId = parseInt(row.dataset.conversationId, 10);
            setTimeout(() => {
                if (typeof window.showDeleteChatConfirm === 'function') {
                    window.showDeleteChatConfirm(convId, row);
                } else if (window.chatModule && typeof window.chatModule.deleteConversation === 'function') {
                    if (confirm('Удалить этот чат?')) window.chatModule.deleteConversation(convId, false);
                }
                delete row.dataset.swipeTriggered;
            }, 0);
        } else if (diff > SWIPE_THRESHOLD) {
            if (typeof trackEvent === 'function') trackEvent('chat_swipe_right', { conversation_id: row.dataset.conversationId });
        }
    }

    function handleCancel() {
        if (activeContent) resetTransform(activeContent);
        activeRow = null;
        activeContent = null;
    }

    chatsList.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleCancel);

    chatsList.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', (e) => {
        if (activeRow && e.buttons === 1) handleMove(e);
    });
    document.addEventListener('mouseup', (e) => {
        if (activeRow && e.buttons === 0) handleEnd(e);
    });
    document.addEventListener('mouseleave', handleCancel);
}

function setupSwipeOnMessages() {
    let msgStartX = 0, msgStartY = 0, msgCurrentX = 0, msgCurrentY = 0;
    let swipedMessage = null;
    let swipedBubble = null;
    /** Порог (px), после которого считаем жест намеренным горизонтальным свайпом — не трогаем скролл до этого */
    const MSG_SWIPE_INTENT = 28;
    /** Порог (px) для срабатывания ответа — выше, чтобы не путать со скроллом */
    const MSG_SWIPE_THRESHOLD = 58;
    const MSG_SWIPE_MAX = 80;
    /** Свайп "зафиксирован" как горизонтальный — блокируем скролл только после этого */
    let swipeIntentCommitted = false;

    function resetBubbleTransform() {
        if (swipedBubble) {
            swipedBubble.style.transform = '';
            swipedBubble = null;
        }
        swipedMessage = null;
        swipeIntentCommitted = false;
    }

    function onlyResetVisual() {
        if (swipedBubble) {
            swipedBubble.style.transform = '';
            swipedBubble = null;
        }
        swipeIntentCommitted = false;
    }

    document.addEventListener('touchstart', (e) => {
        onlyResetVisual();
        swipedMessage = null;
        const msg = e.target.closest('.message');
        if (!msg) return;
        const bubble = msg.querySelector('.message-bubble');
        if (!bubble) return;
        msgStartX = e.touches[0].clientX;
        msgStartY = e.touches[0].clientY;
        msgCurrentX = msgStartX;
        msgCurrentY = msgStartY;
        swipedMessage = msg;
        swipedBubble = bubble;
        swipeIntentCommitted = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!swipedMessage || !swipedBubble || !e.touches.length) return;
        msgCurrentX = e.touches[0].clientX;
        msgCurrentY = e.touches[0].clientY;
        const diffX = msgCurrentX - msgStartX;
        const diffY = msgCurrentY - msgStartY;
        const absX = Math.abs(diffX);
        const absY = Math.abs(diffY);
        if (!swipeIntentCommitted && absX > MSG_SWIPE_INTENT && absX > absY) {
            swipeIntentCommitted = true;
        }
        if (swipeIntentCommitted && absX > absY) {
            e.preventDefault();
        }
        if (!swipeIntentCommitted) return;
        // Ответ по свайпу влево для всех сообщений (своих и чужих).
        if (diffX < 0) swipedBubble.style.transform = `translateX(${Math.max(-MSG_SWIPE_MAX, diffX)}px)`;
        else swipedBubble.style.transform = '';
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        const msg = swipedMessage;
        const bubble = swipedBubble;
        const diffX = msgCurrentX - msgStartX;
        // Свайп влево — ответ на сообщение (для своих и чужих).
        const triggered = msg && bubble && swipeIntentCommitted && (diffX < -MSG_SWIPE_THRESHOLD);
        if (triggered) {
            trackEvent('message_swipe_reply', { message_id: msg.dataset.messageId });
            const messageData = window.chatModule && typeof window.chatModule.getMessageDataFromElement === 'function'
                ? window.chatModule.getMessageDataFromElement(msg)
                : null;
            if (messageData && typeof window.chatModule.setReplyingTo === 'function') {
                window.chatModule.setReplyingTo(messageData);
            }
        }
        resetBubbleTransform();
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        resetBubbleTransform();
    });
}

// Экспорт для вызова showReactionPicker из longpress (если chat.js загружен позже)
window.showReactionPicker = function(e, messageId) {
    const picker = document.getElementById('reactionPicker');
    if (!picker) return;
    const reactionPickerMessageId = messageId;
    picker.dataset.messageId = messageId;
    picker.style.display = 'flex';
    picker.style.left = (e.clientX || 0) + 'px';
    picker.style.top = (e.clientY || 0) + 'px';
    picker.querySelectorAll('.reaction-picker-btn').forEach(btn => {
        btn.onclick = () => {
            const mid = picker.dataset.messageId;
            if (mid && window.chatModule && typeof window.chatModule.toggleReaction === 'function') {
                window.chatModule.toggleReaction(mid, btn.dataset.emoji, null);
            }
            picker.style.display = 'none';
        };
    });
};
