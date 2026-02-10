// Жесты: долгое нажатие (longpress), свайпы

const LONG_PRESS_MS = 500;
let longPressTimer = null;
let touchStartX = 0, touchStartY = 0;

document.addEventListener('DOMContentLoaded', () => {
    setupLongPress();
    setupDeleteChatModal();
    setupSwipeOnChatItems();
    setupSwipeOnMessages();
});

/** Модальное окно подтверждения удаления чата (вместо нативного confirm) */
function setupDeleteChatModal() {
    const modal = document.getElementById('modalDeleteChat');
    const btnCancel = document.getElementById('modalDeleteChatCancel');
    const btnConfirm = document.getElementById('modalDeleteChatConfirm');
    const btnClose = document.getElementById('modalDeleteChatClose');
    if (!modal || !btnCancel || !btnConfirm) return;

    let pendingConvId = null;
    let pendingRow = null;

    function closeModal() {
        modal.style.display = 'none';
        if (pendingRow) delete pendingRow.dataset.swipeTriggered;
        pendingConvId = null;
        pendingRow = null;
    }

    function onConfirm() {
        const convId = pendingConvId;
        if (convId != null && window.chatModule && typeof window.chatModule.deleteConversation === 'function') {
            window.chatModule.deleteConversation(convId);
        }
        closeModal();
    }

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', closeModal);
    btnClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    window.showDeleteChatConfirm = function (convId, row) {
        pendingConvId = convId;
        pendingRow = row;
        modal.style.display = 'flex';
    };
}

function setupLongPress() {
    document.addEventListener('touchstart', (e) => {
        const target = e.target.closest('.message-bubble');
        if (!target) return;
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
    let startX = 0, currentX = 0;
    let activeRow = null;
    let activeContent = null;
    const SWIPE_THRESHOLD = 60;

    function getActionWidth(row) {
        const action = row ? row.querySelector('.chat-item-action-delete') : null;
        return action ? action.offsetWidth : 256;
    }

    function getClientX(e) {
        if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
        return e.clientX;
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
        const { row, content } = getRowAndContent(e.target);
        if (!row || !content) return;
        activeRow = row;
        activeContent = content;
        startX = getClientX(e);
        currentX = startX;
    }

    function handleMove(e) {
        if (!activeRow || !activeContent) return;
        currentX = getClientX(e);
        const diff = currentX - startX;
        applyTransform(activeContent, diff, getActionWidth(activeRow));
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
            trackEvent('chat_swipe_left', { conversation_id: row.dataset.conversationId });
            row.dataset.swipeTriggered = '1';
            const convId = parseInt(row.dataset.conversationId, 10);
            setTimeout(() => {
                if (typeof window.showDeleteChatConfirm === 'function') {
                    window.showDeleteChatConfirm(convId, row);
                } else {
                    if (confirm('Удалить этот чат?')) {
                        if (window.chatModule && typeof window.chatModule.deleteConversation === 'function') {
                            window.chatModule.deleteConversation(convId);
                        }
                    }
                    delete row.dataset.swipeTriggered;
                }
            }, 0);
        } else if (diff > SWIPE_THRESHOLD) {
            trackEvent('chat_swipe_right', { conversation_id: row.dataset.conversationId });
        }
    }

    function handleCancel() {
        if (activeContent) resetTransform(activeContent);
        activeRow = null;
        activeContent = null;
    }

    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: true });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleCancel);

    document.addEventListener('mousedown', handleStart);
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
    const MSG_SWIPE_THRESHOLD = 45;
    const MSG_SWIPE_MAX = 80;

    function resetBubbleTransform() {
        if (swipedBubble) {
            swipedBubble.style.transform = '';
            swipedBubble = null;
        }
        swipedMessage = null;
    }

    function onlyResetVisual() {
        if (swipedBubble) {
            swipedBubble.style.transform = '';
            swipedBubble = null;
        }
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
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!swipedMessage || !swipedBubble || !e.touches.length) return;
        msgCurrentX = e.touches[0].clientX;
        msgCurrentY = e.touches[0].clientY;
        const diffX = msgCurrentX - msgStartX;
        const diffY = msgCurrentY - msgStartY;
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 15) {
            e.preventDefault();
        }
        const isOwn = swipedMessage.classList.contains('own');
        if (isOwn) {
            if (diffX < 0) swipedBubble.style.transform = `translateX(${Math.max(-MSG_SWIPE_MAX, diffX)}px)`;
            else swipedBubble.style.transform = '';
        } else {
            if (diffX > 0) swipedBubble.style.transform = `translateX(${Math.min(MSG_SWIPE_MAX, diffX)}px)`;
            else swipedBubble.style.transform = '';
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        const msg = swipedMessage;
        const bubble = swipedBubble;
        const diffX = msgCurrentX - msgStartX;
        const isOwn = msg ? msg.classList.contains('own') : false;
        const triggered = msg && bubble && (isOwn ? diffX < -MSG_SWIPE_THRESHOLD : diffX > MSG_SWIPE_THRESHOLD);
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
        onlyResetVisual();
        swipedMessage = null;
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
