// Логика работы чата
function useTwemoji() {
    return document.body && document.body.dataset.twemojiEnabled === '1' && typeof twemoji !== 'undefined';
}
function chatLang(key, fallback) {
    const C = typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.chat;
    return (C && C[key] !== undefined && C[key] !== '') ? C[key] : (fallback || '');
}
function e2eeLang(key, fallback) {
    const E = typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.e2ee;
    return (E && E[key] !== undefined && E[key] !== '') ? E[key] : (fallback || '');
}

/** Локализовать текст сообщения о звонке (для списка чатов и для message-content). */
function localizeCallMessageContent(content) {
    if (!content || typeof content !== 'string') return content;
    const L = (typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.call) || {};
    const durationLabel = L.duration || 'duration ';
    const completedLabel = L.completed || 'completed';
    const completedForAllLabel = L.completed_for_all || 'ended for all';
    let rest = content.trim();
    let label = rest;
    let prefixMatched = false;
    if (/^Group video call|^Групповой видеозвонок/i.test(rest)) {
        label = L.group_video || 'Group video call';
        rest = rest.replace(/^Group video call|^Групповой видеозвонок\s*,?\s*/gi, '');
        prefixMatched = true;
    } else if (/^Group voice call|^Групповой голосовой звонок/i.test(rest)) {
        label = L.group_voice || 'Group voice call';
        rest = rest.replace(/^Group voice call|^Групповой голосовой звонок\s*,?\s*/gi, '');
        prefixMatched = true;
    } else if (/^Group call|^Групповой звонок/i.test(rest)) {
        label = L.group_voice || 'Group call';
        rest = rest.replace(/^Group call|^Групповой звонок\s*,?\s*/gi, '');
        prefixMatched = true;
    } else if (/^Video call|^Видеозвонок/i.test(rest)) {
        label = L.video || 'Video call';
        rest = rest.replace(/^Video call|^Видеозвонок\s*,?\s*/gi, '');
        prefixMatched = true;
    } else if (/^Voice call|^Голосовой звонок/i.test(rest)) {
        label = L.voice || 'Voice call';
        rest = rest.replace(/^Voice call|^Голосовой звонок\s*,?\s*/gi, '');
        prefixMatched = true;
    } else if (/^Call|^Звонок/i.test(rest)) {
        label = L.voice || 'Call';
        rest = rest.replace(/^Call|^Звонок\s*,?\s*/gi, '');
        prefixMatched = true;
    }
    rest = rest.replace(/ended for all|завершён\s+для\s+всех/gi, completedForAllLabel).replace(/,?\s*(duration|длительность)\s*/gi, ', ' + durationLabel.trim() + ' ').replace(/completed|завершён/g, completedLabel);
    if (!prefixMatched) return rest;
    return label + (rest ? '\n' + rest : '');
}
if (typeof window !== 'undefined') window.localizeCallMessageContent = localizeCallMessageContent;

let currentConversationId = null;
let lastMessageId = 0;
let conversations = [];
/** Кэш расшифрованных превью для цитат: [conversationId][messageId] = preview (чтобы reply_to показывал расшифрованный текст) */
let decryptedReplyPreviews = {};
/** Кэш расшифрованного текста сообщений по (conversationId -> messageId -> content) для пересылки E2EE в другой чат */
let decryptedMessageContentCache = {};
let contacts = [];
let currentSidebarTab = 'chats';

/** Поиск в чате: массив найденных .message и текущий индекс */
let chatSearchMatches = [];
let chatSearchCurrentIndex = -1;
let chatSearchInputTimeout = null;

/** Результаты поиска по тексту сообщений в переписках: null или { query, results: [{ conversation_id, message_id, content_preview }] } */
let messageSearchResults = null;
let messageSearchTimeout = null;

/** Кэш превью ссылок: url -> { title, description, image, url } */
const linkPreviewCache = new Map();

/** Извлечь первую ссылку http(s) из текста */
function extractFirstUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.trim().match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[.,;:!?]+$/, '') : null;
}

/** Превратить текст в HTML с кликабельными ссылками */
function linkify(text) {
    if (!text || typeof text !== 'string') return '';
    const urlRe = /(https?:\/\/[^\s<>"']+)/gi;
    const parts = [];
    let lastIndex = 0;
    let match;
    urlRe.lastIndex = 0;
    while ((match = urlRe.exec(text)) !== null) {
        parts.push(escapeHtml(text.slice(lastIndex, match.index)));
        const url = match[1].replace(/[.,;:!?]+$/, '');
        parts.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
        lastIndex = match.index + match[1].length;
    }
    parts.push(escapeHtml(text.slice(lastIndex)));
    return parts.join('');
}

/** Рекурсивно заменить маркеры стилей в уже экранированной строке (только теги b,i,u,s). Порядок: **, ~~, __, * */
function replaceTextStyleMarkup(escaped) {
    if (!escaped || typeof escaped !== 'string') return '';
    return escaped
        .replace(/\*\*([\s\S]+?)\*\*/g, (_, c) => '<b>' + replaceTextStyleMarkup(c) + '</b>')
        .replace(/~~([\s\S]+?)~~/g, (_, c) => '<s>' + replaceTextStyleMarkup(c) + '</s>')
        .replace(/__([\s\S]+?)__/g, (_, c) => '<u>' + replaceTextStyleMarkup(c) + '</u>')
        .replace(/\*([\s\S]+?)\*/g, (_, c) => '<i>' + replaceTextStyleMarkup(c) + '</i>');
}

/** Текст сообщения → безопасный HTML с тегами <b><i><u><s> (жирный, курсив, подчёркнутый, зачёркнутый) */
function parseTextStyles(text) {
    if (text == null || typeof text !== 'string') return '';
    const escaped = escapeHtml(text);
    return replaceTextStyleMarkup(escaped);
}

/** Обернуть URL в уже сформированном HTML (после parseTextStyles) в ссылки. URL могут быть экранированы (&amp;). */
function linkifyHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html.replace(/https?:\/\/[^\s<]+/g, (url) => {
        const href = url.replace(/&amp;/g, '&');
        return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
}

/** Убрать маркеры стилей из текста (для превью ответа/пересланного) */
function stripTextStyles(text) {
    if (text == null || typeof text !== 'string') return '';
    return text
        .replace(/\*\*(.+?)\*\*/g, (_, c) => stripTextStyles(c))
        .replace(/~~(.+?)~~/g, (_, c) => stripTextStyles(c))
        .replace(/__(.+?)__/g, (_, c) => stripTextStyles(c))
        .replace(/\*(.+?)\*/g, (_, c) => stripTextStyles(c));
}

/** HTML из contenteditable → markdown (** * __ ~~) для отправки на сервер */
function htmlToMarkdown(html) {
    if (html == null || typeof html !== 'string') return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        const inner = Array.from(node.childNodes).map(walk).join('');
        if (tag === 'b') return '**' + inner + '**';
        if (tag === 'i') return '*' + inner + '*';
        if (tag === 'u') return '__' + inner + '__';
        if (tag === 's' || tag === 'strike' || tag === 'del') return '~~' + inner + '~~';
        if (tag === 'br') return '\n';
        if (tag === 'div') return inner + '\n';
        return inner;
    }
    return walk(div).replace(/\n+$/, '');
}

/** На мобильной ширине используется textarea (вызов клавиатуры), иначе contenteditable */
function getActiveMessageInputElement() {
    const mobile = document.getElementById('messageInputMobile');
    if (mobile && window.matchMedia('(max-width: 768px)').matches) return mobile;
    return document.getElementById('messageInput');
}

/** Получить содержимое поля ввода в виде markdown (для отправки) */
function getMessageInputMarkdown() {
    const el = getActiveMessageInputElement();
    if (!el) return '';
    if (el.contentEditable === 'true') return htmlToMarkdown(el.innerHTML);
    return (el.value != null) ? el.value : '';
}

/** Установить содержимое поля ввода из markdown (после отправки или при редактировании) */
function setMessageInputContent(markdown) {
    const el = getActiveMessageInputElement();
    if (!el) return;
    if (el.contentEditable === 'true') {
        const md = (markdown || '').trim();
        el.innerHTML = md ? parseTextStyles(md) : '';
        updateMessageInputEmptyState(el);
    } else {
        el.value = markdown || '';
        if (el === document.getElementById('messageInputMobile')) {
            el.style.height = 'auto';
            if ((markdown || '').trim()) el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }
    }
}

/** Обновить класс empty у contenteditable (для placeholder) */
function updateMessageInputEmptyState(el) {
    if (!el) el = document.getElementById('messageInput');
    if (!el) return;
    const empty = !el.textContent || el.textContent.trim() === '';
    el.classList.toggle('empty', empty);
}

/** Собрать HTML карточки превью ссылки (содержимое в .message-link-preview, без обёртки-ссылки) */
function buildPreviewCardHtml(url, data) {
    const title = (data.title || '').trim();
    const desc = (data.description || '').trim();
    const img = (data.image || '').trim();
    const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return (img ? `<span class="message-link-preview-image" style="background-image:url(${escapeHtml(img)})"></span>` : '') +
        `<span class="message-link-preview-body">` +
        (title ? `<span class="message-link-preview-title">${escapeHtml(title)}</span>` : '') +
        (desc ? `<span class="message-link-preview-desc">${escapeHtml(desc)}</span>` : '') +
        `<a class="message-link-preview-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>` +
        `</span>`;
}

/** Загрузить превью по URL и вставить карточку в container */
async function fetchAndShowPreview(container, url) {
    const cached = linkPreviewCache.get(url);
    if (cached) {
        container.innerHTML = buildPreviewCardHtml(url, cached);
        container.classList.remove('message-link-preview-loading');
        return;
    }
    try {
        const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
        const data = await apiRequest(`${API_BASE}/api/link_preview.php?url=${encodeURIComponent(url)}`);
        if (data && data.data) {
            linkPreviewCache.set(url, data.data);
            container.innerHTML = buildPreviewCardHtml(url, data.data);
        } else {
            container.remove();
        }
    } catch (e) {
        container.remove();
    }
    container.classList.remove('message-link-preview-loading');
}

/** Найти в элементе блоки .message-link-preview с data-preview-url и загрузить для них превью */
function loadLinkPreviewsForElement(el) {
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
    if (!API_BASE) return;
    el.querySelectorAll('.message-link-preview[data-preview-url]').forEach(container => {
        const url = container.getAttribute('data-preview-url');
        if (url) fetchAndShowPreview(container, url);
    });
}

/** Извлечь ID беседы из hash (#/c/123) — для перехода из пуш-уведомления */
function getConversationIdFromHash() {
    const hash = (window.location.hash || '').trim();
    const m = hash.match(/^#\/c\/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
}

/** URL вида «список чатов» для History API */
function getListUrl() {
    const base = window.location.pathname + (window.location.search || '');
    return base + '#/';
}

/** URL вида «чат» для History API */
function getChatUrl(conversationId) {
    const base = window.location.pathname + (window.location.search || '');
    return base + '#/c/' + conversationId;
}

const CHAT_SCROLL_STORAGE_PREFIX = 'chatScroll_';

function saveConversationScroll(conversationId) {
    if (conversationId == null) return;
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    try {
        const pos = Math.max(0, chatMessages.scrollTop);
        sessionStorage.setItem(CHAT_SCROLL_STORAGE_PREFIX + conversationId, String(pos));
    } catch (e) { /* ignore */ }
}

function getSavedScrollPosition(conversationId) {
    if (conversationId == null) return null;
    try {
        const s = sessionStorage.getItem(CHAT_SCROLL_STORAGE_PREFIX + conversationId);
        if (s === null || s === '') return null;
        const n = parseInt(s, 10);
        return isNaN(n) ? null : Math.max(0, n);
    } catch (e) {
        return null;
    }
}

/** Показать вид «список чатов» (без добавления записи в history) */
function showListView() {
    if (currentConversationId != null) saveConversationScroll(currentConversationId);
    closeChatSearch();
    const chatWindow = document.getElementById('chatWindow');
    const chatEmpty = document.getElementById('chatEmpty');
    if (chatWindow) chatWindow.classList.add('is-hidden');
    if (chatEmpty) chatEmpty.classList.remove('is-hidden');
    document.body.classList.remove('mobile-chat-open');
    currentConversationId = null;
    lastMessageId = 0;
    document.querySelectorAll('.chat-item-row').forEach(row => row.classList.remove('active'));
    if (window.pushModule && typeof window.pushModule.notifyConversationFocus === 'function') {
        window.pushModule.notifyConversationFocus(null, false);
    }
    if (window.websocketModule && typeof window.websocketModule.subscribe === 'function') {
        window.websocketModule.subscribe(null);
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    loadContacts();
    setupEventListeners();

    // Навигация по истории: «назад» возвращает к предыдущему чату или к списку
    function applyViewFromUrl() {
        const conversationId = getConversationIdFromHash();
        if (conversationId != null) {
            openConversation(conversationId, { skipHistory: true });
        } else {
            showListView();
        }
    }
    if (window.history && window.history.pushState) {
        window.addEventListener('popstate', applyViewFromUrl);
    }
    window.addEventListener('pagehide', () => {
        if (currentConversationId != null) saveConversationScroll(currentConversationId);
    });

    loadConversations().then(() => {
        initChatsPanelScrollHideSearch();
        const conversationId = getConversationIdFromHash();
        if (window.history && window.history.replaceState) {
            // Всегда записываем в history вид «список», чтобы «назад» из чата вело к списку
            history.replaceState({ view: 'list' }, '', getListUrl());
        }
        if (conversationId != null) {
            // Открытие чата из URL (в т.ч. по клику на пуш): текущая запись уже «список», открываем чат (добавится запись в history)
            openConversation(conversationId);
            var params = new URLSearchParams(window.location.search);
            if (params.get('join_call') && window.Calls && typeof window.Calls.joinGroupCall === 'function') {
                setTimeout(function() {
                    window.Calls.joinGroupCall(conversationId).catch(function() {});
                }, 500);
                params.delete('join_call');
                var qs = params.toString();
                history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
            }
        }
    });

    syncMobileChatState();
    window.addEventListener('resize', syncMobileChatState);
    window.addEventListener('groupCallEnded', function(e) {
        var cid = e.detail && e.detail.conversation_id;
        if (cid && cid === currentConversationId) {
            var plaque = document.getElementById('chatGroupCallPlaque');
            if (plaque) plaque.classList.add('is-hidden');
        }
        loadConversations();
    });
    window.addEventListener('callEnded', function(e) {
        var cid = e.detail && e.detail.conversation_id;
        if (cid && cid === currentConversationId) {
            var plaque = document.getElementById('chatGroupCallPlaque');
            if (plaque) plaque.classList.add('is-hidden');
        }
        loadConversations();
    });
    window.addEventListener('focus', function refreshCallPlaqueIfVisible() {
        var plaque = document.getElementById('chatGroupCallPlaque');
        if (!plaque || plaque.classList.contains('is-hidden') || !currentConversationId || !window.Calls) return;
        var min = (typeof window.Calls.getIncomingCallMinimized === 'function') ? window.Calls.getIncomingCallMinimized() : null;
        var hasMinimizedIncoming = min && (min.conversation_id == currentConversationId || parseInt(min.conversation_id, 10) === parseInt(currentConversationId, 10));
        if (hasMinimizedIncoming) return;
        var getGroup = window.Calls.getGroupCallStatus;
        var getActive = window.Calls.getActiveCallStatus;
        if (getGroup) {
            getGroup(currentConversationId).then(function(status) {
                if (!status || !status.active) {
                    plaque.classList.add('is-hidden');
                }
            });
        }
        if (getActive) {
            getActive(currentConversationId).then(function(status) {
                if (!status || !status.active) {
                    plaque.classList.add('is-hidden');
                }
            });
        }
    });
    var plaqueContainer = document.getElementById('chatGroupCallPlaque');
    if (plaqueContainer) {
        plaqueContainer.addEventListener('click', function(e) {
            var joinBtn = e.target.closest('#chatGroupCallPlaqueJoin, .chat-group-call-plaque-join');
            var declineBtn = e.target.closest('#chatGroupCallPlaqueDecline, .chat-group-call-plaque-decline');
            if (!joinBtn && !declineBtn) return;
            var plaqueEl = document.getElementById('chatGroupCallPlaque');
            if (!plaqueEl || plaqueEl.classList.contains('is-hidden')) return;
            var pid = plaqueEl.dataset.pendingCallId;
            var mode = plaqueEl.dataset.plaqueMode || '';
            var apiBase = (typeof window !== 'undefined' && window.API_BASE) || '';
            if (joinBtn) {
                if (mode === 'minimized' && window.Calls && typeof window.Calls.acceptCallFromMinimized === 'function') {
                    window.Calls.acceptCallFromMinimized().catch(function(err) {
                        alert(err && err.message ? err.message : (typeof chatLang === 'function' ? chatLang('join_call_error', 'Could not join call') : 'Could not join call'));
                    });
                    return;
                }
                if (mode === 'active' && pid && window.Calls && window.Calls.joinOngoingCall) {
                    var callerUuid = plaqueEl.dataset.callerUuid || '';
                    var withVideo = plaqueEl.dataset.withVideo === '1';
                    var cid = currentConversationId;
                    if (!cid) return;
                    if (window.Calls.showCallPanelForJoining) {
                        window.Calls.showCallPanelForJoining(parseInt(pid, 10), callerUuid, cid, withVideo);
                    }
                    window.Calls.joinOngoingCall(parseInt(pid, 10), callerUuid, cid, withVideo)
                        .then(function() {})
                        .catch(function(err) {
                            alert(err && err.message ? err.message : (typeof chatLang === 'function' ? chatLang('join_call_error', 'Could not join call') : 'Could not join call'));
                        });
                }
                if (window.Calls && window.Calls.joinGroupCall && !mode) {
                    var cid = currentConversationId;
                    if (cid) window.Calls.joinGroupCall(cid).catch(function(err) { alert(err && err.message ? err.message : 'Could not join call'); });
                }
                return;
            }
            if (declineBtn && pid && apiBase) {
                if (mode === 'minimized') {
                    fetch(apiBase + '/api/calls.php?action=call_decline', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ call_id: parseInt(pid, 10) })
                    }).then(function() {
                        if (window.Calls && typeof window.Calls.clearIncomingCallMinimized === 'function') {
                            window.Calls.clearIncomingCallMinimized();
                        }
                        if (window.chatModule && window.chatModule.loadConversations) window.chatModule.loadConversations();
                        plaqueEl.classList.add('is-hidden');
                        delete plaqueEl.dataset.pendingCallId;
                        delete plaqueEl.dataset.plaqueMode;
                    }).catch(function() {});
                } else {
                    fetch(apiBase + '/api/calls.php?action=end', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ call_id: parseInt(pid, 10) })
                    }).then(function() {
                        plaqueEl.classList.add('is-hidden');
                        delete plaqueEl.dataset.pendingCallId;
                        delete plaqueEl.dataset.plaqueMode;
                        delete plaqueEl.dataset.callerUuid;
                        delete plaqueEl.dataset.withVideo;
                    }).catch(function() {});
                }
            }
        });
    }
    trackEvent('chat_page_view');
});

// Синхронизация состояния «мобильный чат открыт» при ресайзе
function syncMobileChatState() {
    const chatWindow = document.getElementById('chatWindow');
    const isChatVisible = chatWindow && !chatWindow.classList.contains('is-hidden');
    if (window.innerWidth <= 768 && isChatVisible) {
        document.body.classList.add('mobile-chat-open');
    } else if (window.innerWidth > 768) {
        document.body.classList.remove('mobile-chat-open');
    }
}

// ——— Поиск текста в переписке ———
function escapeRegex(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearChatSearchHighlights() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.querySelectorAll('.message').forEach(msg => msg.classList.remove('chat-search-current'));
    container.querySelectorAll('.chat-search-highlight').forEach(mark => {
        const parent = mark.parentNode;
        if (parent) parent.replaceChild(document.createTextNode(mark.textContent), mark);
    });
}

function highlightTextInElement(container, query) {
    if (!query || !container) return;
    const escaped = escapeRegex(query);
    const regex = new RegExp('(' + escaped + ')', 'gi');
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(node => {
        const text = node.textContent;
        if (!text || !regex.test(text)) return;
        regex.lastIndex = 0;
        const parts = text.split(regex);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === '') continue;
            if (i % 2 === 1) {
                const mark = document.createElement('mark');
                mark.className = 'chat-search-highlight';
                mark.textContent = parts[i];
                fragment.appendChild(mark);
            } else {
                fragment.appendChild(document.createTextNode(parts[i]));
            }
        }
        const parent = node.parentNode;
        if (parent) parent.replaceChild(fragment, node);
    });
}

function updateChatSearchUI() {
    const counterEl = document.getElementById('chatSearchCounter');
    const prevBtn = document.getElementById('chatSearchPrev');
    const nextBtn = document.getElementById('chatSearchNext');
    const total = chatSearchMatches.length;
    const noneLabel = chatLang('search_none', 'No results');
    const counterLabel = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.search_counter) ? window.__LANG__.chat.search_counter : '%d of %d';
    if (counterEl) {
        counterEl.textContent = total === 0 ? noneLabel : counterLabel.replace(/%d/, String(chatSearchCurrentIndex + 1)).replace(/%d/, String(total));
    }
    if (prevBtn) prevBtn.disabled = total === 0 || chatSearchCurrentIndex <= 0;
    if (nextBtn) nextBtn.disabled = total === 0 || chatSearchCurrentIndex >= total - 1;
    chatSearchMatches.forEach((msg, i) => msg.classList.toggle('chat-search-current', i === chatSearchCurrentIndex));
    const current = chatSearchMatches[chatSearchCurrentIndex];
    if (current) {
        current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function runChatSearch() {
    const input = document.getElementById('chatSearchInput');
    const container = document.getElementById('chatMessages');
    if (!input || !container) return;
    const query = input.value.trim();
    clearChatSearchHighlights();
    chatSearchMatches = [];
    chatSearchCurrentIndex = -1;
    if (query.length === 0) {
        updateChatSearchUI();
        return;
    }
    const q = query.toLowerCase();
    const messages = container.querySelectorAll('.message');
    messages.forEach(msg => {
        const content = msg.querySelector('.message-content');
        if (!content) return;
        const text = content.textContent || '';
        if (text.toLowerCase().indexOf(q) !== -1) {
            chatSearchMatches.push(msg);
        }
    });
    if (chatSearchMatches.length > 0) {
        chatSearchCurrentIndex = 0;
        chatSearchMatches.forEach(msg => {
            const content = msg.querySelector('.message-content');
            if (content) highlightTextInElement(content, query);
        });
    }
    updateChatSearchUI();
}

function closeChatSearch() {
    const bar = document.getElementById('chatSearchBar');
    const input = document.getElementById('chatSearchInput');
    if (bar) bar.classList.add('is-hidden');
    if (input) input.value = '';
    clearChatSearchHighlights();
    chatSearchMatches = [];
    chatSearchCurrentIndex = -1;
    const counterEl = document.getElementById('chatSearchCounter');
    const prevBtn = document.getElementById('chatSearchPrev');
    const nextBtn = document.getElementById('chatSearchNext');
    if (counterEl) counterEl.textContent = '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Кнопка нового чата
    const btnNewChat = document.getElementById('btnNewChat');
    if (btnNewChat) {
        btnNewChat.addEventListener('click', showNewChatModal);
    }

    // Кнопка «назад» и клик по аватарке/инфо в шапке чата — открыть профиль или инфо о группе
    const chatHeader = document.getElementById('chatHeader');
    if (chatHeader) {
        chatHeader.addEventListener('click', (e) => {
            if (e.target.closest('.chat-header-back')) closeMobileChat();
            const avatarEl = e.target.closest('.chat-header-avatar');
            const infoEl = e.target.closest('.chat-header-info');
            if (avatarEl) {
                if (avatarEl.dataset.isGroup === 'true') openGroupInfoModal();
                else if (avatarEl.dataset.userUuid) openUserProfileModal(avatarEl.dataset.userUuid);
            }
            if (infoEl) {
                if (infoEl.dataset.isGroup === 'true') openGroupInfoModal();
                else if (infoEl.dataset.userUuid) openUserProfileModal(infoEl.dataset.userUuid);
            }
        });
        chatHeader.addEventListener('keydown', (e) => {
            const avatarEl = e.target.closest('.chat-header-avatar');
            const infoEl = e.target.closest('.chat-header-info');
            const target = avatarEl || infoEl;
            if (target && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                if (target.dataset.isGroup === 'true') openGroupInfoModal();
                else if (target.dataset.userUuid) openUserProfileModal(target.dataset.userUuid);
            }
        });
    }

    // Поиск в переписке: кнопка лупы в шапке (делегирование, т.к. шапка пересоздаётся)
    const chatWindow = document.getElementById('chatWindow');
    if (chatWindow) {
        chatWindow.addEventListener('click', (e) => {
            if (e.target.closest('#chatHeaderSearchBtn')) {
                const bar = document.getElementById('chatSearchBar');
                const input = document.getElementById('chatSearchInput');
                if (bar && input) {
                    bar.classList.remove('is-hidden');
                    input.focus();
                    if (input.value.trim()) runChatSearch();
                }
            }
        });
    }

    const chatSearchInput = document.getElementById('chatSearchInput');
    const chatSearchPrev = document.getElementById('chatSearchPrev');
    const chatSearchNext = document.getElementById('chatSearchNext');
    const chatSearchClose = document.getElementById('chatSearchClose');
    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', () => {
            clearTimeout(chatSearchInputTimeout);
            chatSearchInputTimeout = setTimeout(runChatSearch, 200);
        });
        chatSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeChatSearch();
                chatSearchInput.blur();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    if (chatSearchMatches.length && chatSearchCurrentIndex > 0) {
                        chatSearchCurrentIndex--;
                        updateChatSearchUI();
                    }
                } else {
                    if (chatSearchMatches.length && chatSearchCurrentIndex < chatSearchMatches.length - 1) {
                        chatSearchCurrentIndex++;
                        updateChatSearchUI();
                    } else if (chatSearchMatches.length === 0 && chatSearchInput.value.trim()) runChatSearch();
                }
            }
        });
    }
    if (chatSearchPrev) chatSearchPrev.addEventListener('click', () => {
        if (chatSearchMatches.length && chatSearchCurrentIndex > 0) {
            chatSearchCurrentIndex--;
            updateChatSearchUI();
        }
    });
    if (chatSearchNext) chatSearchNext.addEventListener('click', () => {
        if (chatSearchMatches.length && chatSearchCurrentIndex < chatSearchMatches.length - 1) {
            chatSearchCurrentIndex++;
            updateChatSearchUI();
        }
    });
    if (chatSearchClose) chatSearchClose.addEventListener('click', closeChatSearch);

    // Вкладки Беседы / Контакты
    const tabChats = document.getElementById('tabChats');
    const tabContacts = document.getElementById('tabContacts');
    if (tabChats) tabChats.addEventListener('click', () => switchSidebarTab('chats'));
    if (tabContacts) tabContacts.addEventListener('click', () => switchSidebarTab('contacts'));

    // Делегирование кликов по списку чатов (ID беседы из кликнутой строки)
    setupChatListDelegation();

    // Поиск контактов в сайдбаре
    const contactsSearch = document.getElementById('contactsSearch');
    if (contactsSearch) {
        contactsSearch.addEventListener('input', filterContacts);
    }
    
    // Поиск чатов
    const chatsSearch = document.getElementById('chatsSearch');
    if (chatsSearch) {
        chatsSearch.addEventListener('input', filterChats);
    }
    
    // Отправка сообщения
    const btnSend = document.getElementById('btnSend');
    const messageInput = document.getElementById('messageInput');
    
    if (btnSend) {
        btnSend.addEventListener('click', sendMessage);
    }
    
    if (messageInput) {
        updateMessageInputEmptyState(messageInput);

        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
                return;
            }
            // Горячие клавиши форматирования (e.code — по физической клавише, работает в любой раскладке)
            let formatCmd = null;
            if (e.ctrlKey || e.metaKey) {
                if (e.code === 'KeyB') formatCmd = 'bold';
                else if (e.code === 'KeyI') formatCmd = 'italic';
                else if (e.code === 'KeyU') formatCmd = 'underline';
                else if (e.altKey && e.code === 'KeyX') formatCmd = 'strikeThrough';
            }
            if (formatCmd) {
                e.preventDefault();
                const sel = window.getSelection();
                const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
                const inInput = range && messageInput.contains(range.commonAncestorContainer);
                setTimeout(() => {
                    const activeInput = getActiveMessageInputElement();
                    if (activeInput) activeInput.focus();
                    if (inInput && range) {
                        try {
                            sel.removeAllRanges();
                            sel.addRange(range);
                        } catch (err) { /* ignore */ }
                    }
                    document.execCommand(formatCmd, false, null);
                }, 0);
                return;
            }
        });

        messageInput.addEventListener('input', function() {
            updateMessageInputEmptyState(this);
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        messageInput.addEventListener('paste', (e) => {
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;

            // Проверяем, есть ли в буфере изображение
            let pastedImageFile = null;
            if (clipboardData.files && clipboardData.files.length > 0) {
                for (let i = 0; i < clipboardData.files.length; i++) {
                    const f = clipboardData.files[i];
                    if (f.type && f.type.indexOf('image/') === 0) {
                        pastedImageFile = f;
                        break;
                    }
                }
            }
            if (pastedImageFile && currentConversationId) {
                e.preventDefault();
                uploadAndSendFile(pastedImageFile);
                return;
            }

            // Обычная вставка текста
            e.preventDefault();
            const text = clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text || '');
        });
    }

    // Мобильный textarea: Enter — отправка, авто-высота; touchstart→focus чтобы клавиатура открылась в том же жесте (iOS)
    const messageInputMobile = document.getElementById('messageInputMobile');
    const chatInputWrapper = document.querySelector('.chat-input-wrapper');
    if (messageInputMobile) {
        messageInputMobile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        messageInputMobile.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
        // Явный focus при touch в области ввода — на iOS клавиатура часто открывается только если focus вызван в том же жесте
        if (chatInputWrapper) {
            chatInputWrapper.addEventListener('touchstart', function(e) {
                if (!window.matchMedia('(max-width: 768px)').matches) return;
                const t = e.target;
                if (t.closest('.btn-send') || t.closest('#chatInputActions') || t.closest('.chat-input-actions-trigger')) return;
                if (t.closest('#messageInputMobile') || t.closest('.chat-input-mobile-label') || t.closest('.chat-input-wrapper')) {
                    messageInputMobile.focus();
                }
            }, { passive: true });
        }
    }

    // Кнопка прикрепления файла
    const btnAttach = document.getElementById('btnAttach');
    if (btnAttach) {
        btnAttach.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*,video/mp4,video/webm,application/pdf,.doc,.docx,.txt';
            input.addEventListener('change', handleFileSelect);
            input.click();
        });
    }

    // Мобильное меню действий ввода: открытие/закрытие по клику на триггер и снаружи
    const chatInputActions = document.getElementById('chatInputActions');
    const chatInputActionsTrigger = document.getElementById('chatInputActionsTrigger');
    if (chatInputActions && chatInputActionsTrigger) {
        const closeActionsMenu = () => {
            chatInputActions.classList.remove('open');
            chatInputActionsTrigger.setAttribute('aria-expanded', 'false');
        };
        chatInputActionsTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = chatInputActions.classList.toggle('open');
            chatInputActionsTrigger.setAttribute('aria-expanded', open);
        });
        document.addEventListener('click', (e) => {
            if (!chatInputActions.contains(e.target)) closeActionsMenu();
        });
        [btnAttach, document.getElementById('btnEmoji'), document.getElementById('btnSticker')].forEach(btn => {
            if (btn) btn.addEventListener('click', closeActionsMenu);
        });
    }

    // Закрытие модального окна
    const modalNewChat = document.getElementById('modalNewChat');
    const modalNewChatClose = document.getElementById('modalNewChatClose');
    if (modalNewChatClose) {
        modalNewChatClose.addEventListener('click', () => {
            if (modalNewChat) modalNewChat.classList.add('is-hidden');
        });
    }
    if (modalNewChat) {
        modalNewChat.addEventListener('click', (e) => {
            if (e.target === modalNewChat) modalNewChat.classList.add('is-hidden');
        });
    }

    const modalGroupInfo = document.getElementById('modalGroupInfo');
    const modalGroupInfoClose = document.getElementById('modalGroupInfoClose');
    if (modalGroupInfoClose) {
        modalGroupInfoClose.addEventListener('click', () => {
            if (modalGroupInfo) modalGroupInfo.classList.add('is-hidden');
        });
    }
    if (modalGroupInfo) {
        modalGroupInfo.addEventListener('click', (e) => {
            if (e.target === modalGroupInfo) modalGroupInfo.classList.add('is-hidden');
            const removeBtn = e.target.closest('.group-info-member-remove');
            const leaveBtn = e.target.closest('.group-info-member-leave');
            if (removeBtn || leaveBtn) {
                const userUuid = (removeBtn || leaveBtn).dataset.userUuid;
                if (!userUuid || !currentConversationId) return;
                (async () => {
                    try {
                        await apiRequest(`${API_BASE}/api/conversations.php?id=${currentConversationId}&user_uuid=${encodeURIComponent(userUuid)}`, { method: 'DELETE' });
                        const conv = window._lastGroupInfoConv;
                        if (conv && conv.participants) {
                            conv.participants = conv.participants.filter(p => p.uuid !== userUuid);
                        }
                        if (window.E2EE_KEYS && E2EE_KEYS.clearGroupKeyCache) {
                            E2EE_KEYS.clearGroupKeyCache(currentConversationId);
                        }
                        if (userUuid === (document.body.dataset.userUuid || '')) {
                            modalGroupInfo.classList.add('is-hidden');
                            await loadConversations();
                            showListView();
                        } else {
                            openGroupInfoModal();
                        }
                    } catch (err) {
                        console.error(err);
                        alert(err.message || chatLang('action_failed', 'Could not perform action'));
                    }
                })();
            }
        });
    }

    const groupInfoAddMembersBtn = document.getElementById('groupInfoAddMembersBtn');
    if (groupInfoAddMembersBtn) {
        groupInfoAddMembersBtn.addEventListener('click', () => openAddGroupMembersModal());
    }

    const modalAddGroupMembers = document.getElementById('modalAddGroupMembers');
    const modalAddGroupMembersClose = document.getElementById('modalAddGroupMembersClose');
    const btnAddGroupMembersCancel = document.getElementById('btnAddGroupMembersCancel');
    if (modalAddGroupMembersClose) modalAddGroupMembersClose.addEventListener('click', () => { if (modalAddGroupMembers) modalAddGroupMembers.classList.add('is-hidden'); });
    if (btnAddGroupMembersCancel) btnAddGroupMembersCancel.addEventListener('click', () => { if (modalAddGroupMembers) modalAddGroupMembers.classList.add('is-hidden'); });
    if (modalAddGroupMembers) {
        modalAddGroupMembers.addEventListener('click', (e) => { if (e.target === modalAddGroupMembers) modalAddGroupMembers.classList.add('is-hidden'); });
    }
    const btnAddGroupMembersConfirm = document.getElementById('btnAddGroupMembersConfirm');
    if (btnAddGroupMembersConfirm) {
        btnAddGroupMembersConfirm.addEventListener('click', () => submitAddGroupMembers());
    }
    const addGroupMembersSearch = document.getElementById('addGroupMembersSearch');
    if (addGroupMembersSearch) {
        let addGroupSearchTimeout;
        addGroupMembersSearch.addEventListener('input', () => {
            clearTimeout(addGroupSearchTimeout);
            addGroupSearchTimeout = setTimeout(() => loadAddGroupMembersUserList(addGroupMembersSearch.value.trim()), 300);
        });
    }

    const modalUserProfile = document.getElementById('modalUserProfile');
    const modalCallParticipants = document.getElementById('modalCallParticipants');
    const modalCallParticipantsClose = document.getElementById('modalCallParticipantsClose');
    if (modalCallParticipantsClose && modalCallParticipants) {
        modalCallParticipantsClose.addEventListener('click', () => { modalCallParticipants.classList.add('is-hidden'); });
    }
    if (modalCallParticipants) {
        modalCallParticipants.addEventListener('click', (e) => {
            if (e.target === modalCallParticipants) modalCallParticipants.classList.add('is-hidden');
        });
    }

    const modalUserProfileClose = document.getElementById('modalUserProfileClose');
    if (modalUserProfileClose) {
        modalUserProfileClose.addEventListener('click', () => {
            if (modalUserProfile) modalUserProfile.classList.add('is-hidden');
        });
    }

    const modalForwardTo = document.getElementById('modalForwardTo');
    const modalForwardToClose = document.getElementById('modalForwardToClose');
    if (modalForwardToClose) {
        modalForwardToClose.addEventListener('click', () => {
            if (modalForwardTo) modalForwardTo.classList.add('is-hidden');
        });
    }
    if (modalForwardTo) {
        modalForwardTo.addEventListener('click', (e) => {
            if (e.target === modalForwardTo) modalForwardTo.classList.add('is-hidden');
        });
    }

    // --- E2EE: восстановление ключей и настройка пароля (этап 4) ---
    const modalE2EERestore = document.getElementById('modalE2EERestore');
    const modalE2EERestoreClose = document.getElementById('modalE2EERestoreClose');
    const modalE2EERestoreHint = document.getElementById('modalE2EERestoreHint');
    const modalE2EERestoreError = document.getElementById('modalE2EERestoreError');
    const modalE2EERestoreRateLimited = document.getElementById('modalE2EERestoreRateLimited');
    const modalE2EERestorePassword = document.getElementById('modalE2EERestorePassword');
    const modalE2EERestoreSkip = document.getElementById('modalE2EERestoreSkip');
    const modalE2EERestoreSubmit = document.getElementById('modalE2EERestoreSubmit');
    window.addEventListener('e2ee-need-restore', function (e) {
        const rateLimited = e.detail && e.detail.rate_limited;
        if (modalE2EERestoreError) modalE2EERestoreError.classList.add('is-hidden');
        if (modalE2EERestoreRateLimited) modalE2EERestoreRateLimited.classList.toggle('is-hidden', !rateLimited);
        if (modalE2EERestoreSubmit) modalE2EERestoreSubmit.disabled = !!rateLimited;
        if (modalE2EERestoreSkip) modalE2EERestoreSkip.classList.remove('is-hidden');
        if (modalE2EERestorePassword) modalE2EERestorePassword.value = '';
        if (modalE2EERestore) modalE2EERestore.classList.remove('is-hidden');
    });
    function closeE2EERestoreModal() {
        if (modalE2EERestore) modalE2EERestore.classList.add('is-hidden');
        if (modalE2EERestoreError) modalE2EERestoreError.classList.add('is-hidden');
        setTimeout(function () { initChatsPanelScrollHideSearch(); }, 100);
    }
    if (modalE2EERestoreClose) modalE2EERestoreClose.addEventListener('click', closeE2EERestoreModal);
    if (modalE2EERestore) {
        modalE2EERestore.addEventListener('click', function (ev) {
            if (ev.target === modalE2EERestore) closeE2EERestoreModal();
        });
    }
    if (modalE2EERestoreSkip) {
        modalE2EERestoreSkip.addEventListener('click', function () {
            closeE2EERestoreModal();
            if (window.E2EE_KEYS) {
                E2EE_KEYS.init(true).catch(function () {});
            }
        });
    }
    if (modalE2EERestoreSubmit) {
        modalE2EERestoreSubmit.addEventListener('click', function () {
            const password = modalE2EERestorePassword ? modalE2EERestorePassword.value : '';
            if (!password.trim()) {
                if (modalE2EERestoreError) {
                    modalE2EERestoreError.textContent = e2eeLang('enter_password', 'Enter password');
                    modalE2EERestoreError.classList.remove('is-hidden');
                }
                return;
            }
            if (modalE2EERestoreError) modalE2EERestoreError.classList.add('is-hidden');
            modalE2EERestoreSubmit.disabled = true;
            E2EE_KEYS.restoreFromServerWithPassword(password).then(function (result) {
                modalE2EERestoreSubmit.disabled = false;
                if (result.ok) {
                    closeE2EERestoreModal();
                    E2EE_KEYS.init(false);
                    E2EE_KEYS.uploadMyPublicKey();
                    decryptedReplyPreviews = {};
                    decryptedMessageContentCache = {};
                    renderConversations();
                    if (currentConversationId) {
                        lastMessageId = 0;
                        loadMessages();
                    }
                    return;
                }
                if (result.rate_limited) {
                    if (modalE2EERestoreRateLimited) modalE2EERestoreRateLimited.classList.remove('is-hidden');
                    return;
                }
                if (modalE2EERestoreError) {
                    modalE2EERestoreError.textContent = e2eeLang('wrong_password', 'Wrong password. Try again.');
                    modalE2EERestoreError.classList.remove('is-hidden');
                }
            });
        });
    }

    // --- E2EE п. 5.3: разблокировка по WebAuthn / PIN ---
    const e2eeUnlockOverlay = document.getElementById('e2eeUnlockOverlay');
    const e2eeUnlockError = document.getElementById('e2eeUnlockError');
    const e2eeUnlockBio = document.getElementById('e2eeUnlockBio');
    const e2eeUnlockPin = document.getElementById('e2eeUnlockPin');
    const e2eeUnlockPinBtn = document.getElementById('e2eeUnlockPinBtn');
    window.addEventListener('e2ee-device-locked', function () {
        if (e2eeUnlockOverlay) e2eeUnlockOverlay.classList.remove('is-hidden');
        if (e2eeUnlockError) { e2eeUnlockError.classList.add('is-hidden'); e2eeUnlockError.textContent = ''; }
        if (e2eeUnlockPin) e2eeUnlockPin.value = '';
        if (e2eeUnlockBio) e2eeUnlockBio.classList.toggle('is-hidden', !(window.E2EE_WEBAUTHN_LOCK && E2EE_WEBAUTHN_LOCK.isWebAuthnSupported()));
    });
    function hideE2EEUnlockOverlay() {
        if (e2eeUnlockOverlay) e2eeUnlockOverlay.classList.add('is-hidden');
        window.dispatchEvent(new CustomEvent('e2ee-device-unlocked'));
        setTimeout(function () { initChatsPanelScrollHideSearch(); }, 100);
    }
    if (e2eeUnlockBio) {
        e2eeUnlockBio.addEventListener('click', function () {
            if (!window.E2EE_WEBAUTHN_LOCK) return;
            if (e2eeUnlockError) { e2eeUnlockError.classList.add('is-hidden'); e2eeUnlockError.textContent = ''; }
            E2EE_WEBAUTHN_LOCK.performWebAuthnAssertion().then(function (ok) {
                if (ok && e2eeUnlockPin) e2eeUnlockPin.focus();
                else if (!ok && e2eeUnlockError) {
                    e2eeUnlockError.textContent = e2eeLang('restore_failed', 'Verification failed. Enter PIN.');
                    e2eeUnlockError.classList.remove('is-hidden');
                }
            });
        });
    }
    function doUnlockWithPin() {
        const pin = e2eeUnlockPin ? e2eeUnlockPin.value : '';
        if (!pin || !window.E2EE_WEBAUTHN_LOCK) return;
        if (e2eeUnlockError) e2eeUnlockError.classList.add('is-hidden');
        if (e2eeUnlockPinBtn) e2eeUnlockPinBtn.disabled = true;
        E2EE_WEBAUTHN_LOCK.unlockWithPin(pin).then(function (result) {
            if (e2eeUnlockPinBtn) e2eeUnlockPinBtn.disabled = false;
            if (result.ok) hideE2EEUnlockOverlay();
            else if (e2eeUnlockError) {
                e2eeUnlockError.textContent = result.error || e2eeLang('wrong_pin', 'Wrong PIN');
                e2eeUnlockError.classList.remove('is-hidden');
            }
        });
    }
    if (e2eeUnlockPinBtn) e2eeUnlockPinBtn.addEventListener('click', doUnlockWithPin);
    if (e2eeUnlockPin) {
        e2eeUnlockPin.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doUnlockWithPin();
        });
    }

    const modalE2EEKeyBackup = document.getElementById('modalE2EEKeyBackup');
    const modalE2EEKeyBackupClose = document.getElementById('modalE2EEKeyBackupClose');
    const modalE2EEKeyBackupError = document.getElementById('modalE2EEKeyBackupError');
    const modalE2EEKeyBackupSuccess = document.getElementById('modalE2EEKeyBackupSuccess');
    const modalE2EEKeyBackupPassword = document.getElementById('modalE2EEKeyBackupPassword');
    const modalE2EEKeyBackupPassword2 = document.getElementById('modalE2EEKeyBackupPassword2');
    const modalE2EEKeyBackupCancel = document.getElementById('modalE2EEKeyBackupCancel');
    const modalE2EEKeyBackupSave = document.getElementById('modalE2EEKeyBackupSave');
    const btnE2EERestoreKeys = document.getElementById('btnE2EERestoreKeys');
    if (btnE2EERestoreKeys) {
        btnE2EERestoreKeys.addEventListener('click', function () {
            const profileModal = document.getElementById('modalUserProfile');
            if (profileModal) profileModal.classList.add('is-hidden');
            window.dispatchEvent(new CustomEvent('e2ee-need-restore', { detail: { rate_limited: false } }));
        });
    }
    const profileSettingsRestoreKeys = document.getElementById('profileSettingsRestoreKeys');
    if (profileSettingsRestoreKeys) {
        profileSettingsRestoreKeys.addEventListener('click', function () {
            if (typeof window.closeProfileSettingsModal === 'function') window.closeProfileSettingsModal();
            window.dispatchEvent(new CustomEvent('e2ee-need-restore', { detail: { rate_limited: false } }));
        });
    }
    const profileSettingsKeyBackup = document.getElementById('profileSettingsKeyBackup');
    if (profileSettingsKeyBackup) {
        profileSettingsKeyBackup.addEventListener('click', function () {
            if (typeof window.closeProfileSettingsModal === 'function') window.closeProfileSettingsModal();
            const modalKeyBackup = document.getElementById('modalE2EEKeyBackup');
            if (modalKeyBackup) modalKeyBackup.classList.remove('is-hidden');
        });
    }
    const btnE2EEKeyBackup = document.getElementById('btnE2EEKeyBackup');
    if (btnE2EEKeyBackup) {
        btnE2EEKeyBackup.addEventListener('click', function () {
            if (modalE2EEKeyBackupError) modalE2EEKeyBackupError.classList.add('is-hidden');
            if (modalE2EEKeyBackupSuccess) modalE2EEKeyBackupSuccess.classList.add('is-hidden');
            if (modalE2EEKeyBackupPassword) modalE2EEKeyBackupPassword.value = '';
            if (modalE2EEKeyBackupPassword2) modalE2EEKeyBackupPassword2.value = '';
            if (modalE2EEKeyBackup) modalE2EEKeyBackup.classList.remove('is-hidden');
        });
    }
    function closeE2EEKeyBackupModal() {
        if (modalE2EEKeyBackup) modalE2EEKeyBackup.classList.add('is-hidden');
    }
    if (modalE2EEKeyBackupClose) modalE2EEKeyBackupClose.addEventListener('click', closeE2EEKeyBackupModal);
    if (modalE2EEKeyBackup) {
        modalE2EEKeyBackup.addEventListener('click', function (ev) {
            if (ev.target === modalE2EEKeyBackup) closeE2EEKeyBackupModal();
        });
    }
    if (modalE2EEKeyBackupCancel) modalE2EEKeyBackupCancel.addEventListener('click', closeE2EEKeyBackupModal);
    if (modalE2EEKeyBackupSave) {
        modalE2EEKeyBackupSave.addEventListener('click', function () {
            const p1 = modalE2EEKeyBackupPassword ? modalE2EEKeyBackupPassword.value : '';
            const p2 = modalE2EEKeyBackupPassword2 ? modalE2EEKeyBackupPassword2.value : '';
            if (modalE2EEKeyBackupError) modalE2EEKeyBackupError.classList.add('is-hidden');
            if (modalE2EEKeyBackupSuccess) modalE2EEKeyBackupSuccess.classList.add('is-hidden');
            if (!p1) {
                if (modalE2EEKeyBackupError) {
                    modalE2EEKeyBackupError.textContent = e2eeLang('enter_key_backup_password', 'Enter password');
                    modalE2EEKeyBackupError.classList.remove('is-hidden');
                }
                return;
            }
            if (p1 !== p2) {
                if (modalE2EEKeyBackupError) {
                    modalE2EEKeyBackupError.textContent = e2eeLang('passwords_mismatch', 'Passwords do not match');
                    modalE2EEKeyBackupError.classList.remove('is-hidden');
                }
                return;
            }
            if (!window.E2EE_KEYS || !E2EE_KEYS.hasStoredKeyPair()) {
                if (modalE2EEKeyBackupError) {
                    modalE2EEKeyBackupError.textContent = e2eeLang('login_first', 'Log in and open the chat first.');
                    modalE2EEKeyBackupError.classList.remove('is-hidden');
                }
                return;
            }
            modalE2EEKeyBackupSave.disabled = true;
            E2EE_KEYS.createAndSaveKeyBackup(p1).then(function (ok) {
                modalE2EEKeyBackupSave.disabled = false;
                if (ok) {
                    if (modalE2EEKeyBackupSuccess) {
                        modalE2EEKeyBackupSuccess.textContent = e2eeLang('key_backup_saved', 'Key backup saved.');
                        modalE2EEKeyBackupSuccess.classList.remove('is-hidden');
                    }
                } else {
                    if (modalE2EEKeyBackupError) {
                        modalE2EEKeyBackupError.textContent = e2eeLang('key_backup_failed', 'Could not save. Try later.');
                        modalE2EEKeyBackupError.classList.remove('is-hidden');
                    }
                }
            });
        });
    }

    // Блокировка на устройстве (п. 5.3): включить / выключить / установить PIN
    const userProfileDeviceLockEnable = document.getElementById('userProfileDeviceLockEnable');
    const userProfileDeviceLockDisable = document.getElementById('userProfileDeviceLockDisable');
    const userProfileDeviceLockSetPin = document.getElementById('userProfileDeviceLockSetPin');
    const userProfileDeviceLockPin = document.getElementById('userProfileDeviceLockPin');
    const userProfileDeviceLockPin2 = document.getElementById('userProfileDeviceLockPin2');
    const userProfileDeviceLockPinSubmit = document.getElementById('userProfileDeviceLockPinSubmit');
    const userProfileDeviceLockPinCancel = document.getElementById('userProfileDeviceLockPinCancel');
    const userProfileDeviceLockError = document.getElementById('userProfileDeviceLockError');
    const userProfileDeviceLockInactive = document.getElementById('userProfileDeviceLockInactive');
    const userProfileDeviceLockActive = document.getElementById('userProfileDeviceLockActive');
    function updateDeviceLockUI() {
        if (window.E2EE_WEBAUTHN_LOCK) {
            const active = E2EE_WEBAUTHN_LOCK.isDeviceLockActive();
            if (userProfileDeviceLockInactive) userProfileDeviceLockInactive.classList.toggle('is-hidden', !active);
            if (userProfileDeviceLockActive) userProfileDeviceLockActive.classList.toggle('is-hidden', active);
            if (userProfileDeviceLockSetPin) userProfileDeviceLockSetPin.classList.add('is-hidden');
            if (userProfileDeviceLockError) userProfileDeviceLockError.classList.add('is-hidden');
        }
        var persistCheckbox = document.getElementById('profilePersistKeysCheckbox');
        if (persistCheckbox && window.E2EE_KEYS && typeof window.E2EE_KEYS.getPersistKeys === 'function') {
            persistCheckbox.checked = window.E2EE_KEYS.getPersistKeys();
        }
    }
    if (typeof window !== 'undefined') window.updateDeviceLockUI = updateDeviceLockUI;
    if (userProfileDeviceLockEnable) {
        userProfileDeviceLockEnable.addEventListener('click', function () {
            if (userProfileDeviceLockInactive) userProfileDeviceLockInactive.classList.add('is-hidden');
            if (userProfileDeviceLockSetPin) userProfileDeviceLockSetPin.classList.remove('is-hidden');
            if (userProfileDeviceLockError) userProfileDeviceLockError.classList.add('is-hidden');
            if (userProfileDeviceLockPin) userProfileDeviceLockPin.value = '';
            if (userProfileDeviceLockPin2) userProfileDeviceLockPin2.value = '';
        });
    }
    if (userProfileDeviceLockPinCancel) {
        userProfileDeviceLockPinCancel.addEventListener('click', updateDeviceLockUI);
    }
    if (userProfileDeviceLockPinSubmit) {
        userProfileDeviceLockPinSubmit.addEventListener('click', function () {
            const pin = userProfileDeviceLockPin ? userProfileDeviceLockPin.value : '';
            const pin2 = userProfileDeviceLockPin2 ? userProfileDeviceLockPin2.value : '';
            if (userProfileDeviceLockError) userProfileDeviceLockError.classList.add('is-hidden');
            if (!pin || pin.length < 4) {
                if (userProfileDeviceLockError) {
                    userProfileDeviceLockError.textContent = e2eeLang('pin_min_4', 'PIN at least 4 characters');
                    userProfileDeviceLockError.classList.remove('is-hidden');
                }
                return;
            }
            if (pin !== pin2) {
                if (userProfileDeviceLockError) {
                    userProfileDeviceLockError.textContent = e2eeLang('pin_mismatch', 'PINs do not match');
                    userProfileDeviceLockError.classList.remove('is-hidden');
                }
                return;
            }
            if (!window.E2EE_WEBAUTHN_LOCK) return;
            userProfileDeviceLockPinSubmit.disabled = true;
            E2EE_WEBAUTHN_LOCK.enableDeviceLock(pin).then(function (result) {
                userProfileDeviceLockPinSubmit.disabled = false;
                if (result.ok) updateDeviceLockUI();
                else if (userProfileDeviceLockError) {
                    userProfileDeviceLockError.textContent = result.error || chatLang('load_error', 'Error');
                    userProfileDeviceLockError.classList.remove('is-hidden');
                }
            });
        });
    }
    if (userProfileDeviceLockDisable) {
        userProfileDeviceLockDisable.addEventListener('click', function () {
            if (!window.E2EE_WEBAUTHN_LOCK) return;
            E2EE_WEBAUTHN_LOCK.disableDeviceLock();
            updateDeviceLockUI();
        });
    }

    var profilePersistKeysCheckbox = document.getElementById('profilePersistKeysCheckbox');
    if (profilePersistKeysCheckbox) {
        profilePersistKeysCheckbox.addEventListener('change', function () {
            if (window.E2EE_KEYS && typeof window.E2EE_KEYS.setPersistKeys === 'function') {
                window.E2EE_KEYS.setPersistKeys(profilePersistKeysCheckbox.checked);
            }
        });
    }

    // Панель выбора сообщений для пересылки: Отмена / Переслать
    const forwardSelectionCancel = document.getElementById('forwardSelectionCancel');
    const forwardSelectionForward = document.getElementById('forwardSelectionForward');
    if (forwardSelectionCancel) {
        forwardSelectionCancel.addEventListener('click', () => exitForwardSelectionMode());
    }
    const forwardSelectionDelete = document.getElementById('forwardSelectionDelete');
    if (forwardSelectionDelete) {
        forwardSelectionDelete.addEventListener('click', () => {
            const ids = getForwardSelectedIds();
            if (ids.length === 0) {
                alert(chatLang('select_one_message', 'Выберите хотя бы одно сообщение'));
                return;
            }
            const confirmMsg = chatLang('delete_selected_confirm', 'Удалить выбранные сообщения?');
            if (!confirm(confirmMsg + (ids.length > 1 ? ' (' + ids.length + ')' : ''))) return;
            (async () => {
                const currentUserUuid = document.body.dataset.userUuid || '';
                const chatMessages = document.getElementById('chatMessages');
                const ownIds = ids.filter(id => {
                    const msgEl = chatMessages && chatMessages.querySelector(`.message[data-message-id="${id}"]`);
                    return msgEl && msgEl.dataset.userUuid === currentUserUuid;
                });
                const skippedCount = ids.length - ownIds.length;
                let failed = 0;
                for (const id of ownIds) {
                    try {
                        const response = await apiRequest(`${API_BASE}/api/messages.php?id=${id}`, { method: 'DELETE' });
                        const msgEl = document.querySelector(`.message[data-message-id="${id}"]`);
                        if (msgEl) {
                            const permanent = response && response.data && response.data.permanent === true;
                            if (permanent) msgEl.remove();
                            else {
                                const bubble = msgEl.querySelector('.message-bubble');
                                if (bubble) {
                                    bubble.innerHTML = '<div class="message-content message-deleted">' + (window.__LANG__?.chat?.message_deleted || 'Message deleted') + '</div>';
                                    bubble.classList.add('message-deleted-bubble');
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Delete message error:', err);
                        failed++;
                    }
                }
                exitForwardSelectionMode();
                if (failed > 0) alert(chatLang('delete_message_error', 'Could not delete message'));
                if (skippedCount > 0) alert(chatLang('delete_only_own_hint', 'Удалять можно только свои сообщения.'));
            })();
        });
    }
    if (forwardSelectionForward) {
        forwardSelectionForward.addEventListener('click', () => {
            const ids = getForwardSelectedIds();
            if (ids.length === 0) {
                alert(chatLang('select_one_message', 'Выберите хотя бы одно сообщение'));
                return;
            }
            forwardMessageIdsToSend = ids;
            openForwardToModal();
            exitForwardSelectionMode();
        });
    }
    if (modalUserProfile) {
        modalUserProfile.addEventListener('click', (e) => {
            if (e.target === modalUserProfile) modalUserProfile.classList.add('is-hidden');
        });
    }

    // Клик по изображению в сообщении — открыть превью на весь экран; по аватарке — профиль пользователя
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.addEventListener('change', (e) => {
            if (e.target.classList.contains('message-forward-checkbox')) {
                updateForwardSelectionBar();
            }
        });
        chatMessages.addEventListener('click', (e) => {
            const img = e.target.closest('.message-image');
            if (img && img.src) {
                e.preventDefault();
                e.stopPropagation();
                openImagePreview(img.src);
                return;
            }
            const avatarEl = e.target.closest('.message-avatar-clickable[data-user-uuid]');
            if (avatarEl && avatarEl.dataset.userUuid) {
                e.preventDefault();
                e.stopPropagation();
                const currentUuid = document.body.dataset.userUuid || '';
                if (avatarEl.dataset.userUuid !== currentUuid) openUserProfileModal(avatarEl.dataset.userUuid);
                return;
            }
            const usernameLink = e.target.closest('.message-username-link[data-user-uuid]');
            if (usernameLink && usernameLink.dataset.userUuid) {
                e.preventDefault();
                e.stopPropagation();
                const currentUuid = document.body.dataset.userUuid || '';
                if (usernameLink.dataset.userUuid !== currentUuid) openUserProfileModal(usernameLink.dataset.userUuid);
                return;
            }
            const participantsLink = e.target.closest('.message-call-participants-link');
            if (participantsLink && participantsLink.dataset.groupCallId) {
                e.preventDefault();
                e.stopPropagation();
                openCallParticipantsModal(parseInt(participantsLink.dataset.groupCallId, 10));
            }
        });
    }

    // Плавающий блок с датой при скролле чата
    setupChatDateFloating();
    setupScrollToBottomButton();

    // Переключение типа беседы в модалке (личная / групповая / внешняя)
    document.querySelectorAll('.btn-chat-type').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-chat-type').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const type = btn.dataset.type;
            const privateEl = document.getElementById('newChatPrivate');
            const groupEl = document.getElementById('newChatGroup');
            const externalEl = document.getElementById('newChatExternal');
            const externalLinkWrap = document.getElementById('newChatExternalLinkWrap');
            if (privateEl) privateEl.classList.toggle('is-hidden', type !== 'private');
            if (groupEl) groupEl.classList.toggle('is-hidden', type !== 'group');
            if (externalEl) externalEl.classList.toggle('is-hidden', type !== 'external');
            if (externalLinkWrap) externalLinkWrap.classList.add('is-hidden');
            if (type === 'private') loadModalUserList();
            if (type === 'group') {
                resetGroupChatForm();
                loadModalGroupUserList();
            }
        });
    });

    // Поиск пользователей в модалке нового чата
    const newChatUserSearch = document.getElementById('newChatUserSearch');
    if (newChatUserSearch) {
        let searchTimeout;
        newChatUserSearch.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => loadModalUserList(newChatUserSearch.value.trim()), 300);
        });
    }

    // Групповой чат: поиск участников
    const newChatGroupUserSearch = document.getElementById('newChatGroupUserSearch');
    if (newChatGroupUserSearch) {
        let groupSearchTimeout;
        newChatGroupUserSearch.addEventListener('input', () => {
            clearTimeout(groupSearchTimeout);
            groupSearchTimeout = setTimeout(() => loadModalGroupUserList(newChatGroupUserSearch.value.trim()), 300);
        });
    }

    // Групповой чат: название и кнопка создания
    const newChatGroupName = document.getElementById('newChatGroupName');
    const btnCreateGroup = document.getElementById('btnCreateGroup');
    if (newChatGroupName && btnCreateGroup) {
        const updateCreateGroupBtn = () => {
            const name = newChatGroupName.value.trim();
            const count = groupSelectedParticipants.size;
            btnCreateGroup.disabled = !name || count === 0;
        };
        newChatGroupName.addEventListener('input', updateCreateGroupBtn);
        btnCreateGroup.addEventListener('click', submitCreateGroupChat);
    }

    // Внешняя беседа: создание и показ ссылки-приглашения
    const btnCreateExternal = document.getElementById('btnCreateExternal');
    const newChatExternalName = document.getElementById('newChatExternalName');
    const newChatExternalLinkWrap = document.getElementById('newChatExternalLinkWrap');
    const newChatExternalLinkUrl = document.getElementById('newChatExternalLinkUrl');
    const newChatExternalLinkCopy = document.getElementById('newChatExternalLinkCopy');
    const newChatExternalOpenChat = document.getElementById('newChatExternalOpenChat');
    if (btnCreateExternal) {
        btnCreateExternal.addEventListener('click', async function() {
            const name = (newChatExternalName && newChatExternalName.value.trim()) || '';
            this.disabled = true;
            try {
                const data = await apiRequest(`${API_BASE}/api/conversations.php`, {
                    method: 'POST',
                    body: JSON.stringify({ type: 'external', name: name || chatLang('external_call', 'External call'), with_video: true })
                });
                const conversationId = data.data.conversation_id;
                const inviteUrl = data.data.invite_url || '';
                const groupCallId = data.data.group_call_id;
                if (newChatExternalLinkUrl) newChatExternalLinkUrl.value = inviteUrl;
                if (newChatExternalLinkWrap) {
                    newChatExternalLinkWrap.classList.remove('is-hidden');
                    newChatExternalLinkWrap.dataset.conversationId = String(conversationId);
                    newChatExternalLinkWrap.dataset.groupCallId = groupCallId ? String(groupCallId) : '';
                }
            } catch (err) {
                alert(err.message || chatLang('create_conversation_error', 'Could not create external conversation.'));
            }
            this.disabled = false;
        });
    }
    if (newChatExternalLinkCopy && newChatExternalLinkUrl) {
        newChatExternalLinkCopy.addEventListener('click', function() {
            newChatExternalLinkUrl.select();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(newChatExternalLinkUrl.value).then(() => {
                    const btn = this;
                    btn.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.copied_btn) || 'Copied';
                    setTimeout(() => { btn.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.copy_btn) || 'Copy'; }, 2000);
                });
            } else {
                try {
                    document.execCommand('copy');
                    this.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.copied_btn) || 'Copied';
                    setTimeout(() => { this.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.copy_btn) || 'Copy'; }, 2000);
                } catch (e) {}
            }
        });
    }
    if (newChatExternalOpenChat && newChatExternalLinkWrap) {
        newChatExternalOpenChat.addEventListener('click', function() {
            const cid = newChatExternalLinkWrap.dataset.conversationId;
            if (cid) {
                const modal = document.getElementById('modalNewChat');
                if (modal) modal.classList.add('is-hidden');
                loadConversations().then(() => {
                    openConversation(parseInt(cid, 10));
                    switchSidebarTab('chats');
                    if (window.Calls && typeof window.Calls.joinGroupCall === 'function') {
                        window.Calls.joinGroupCall(parseInt(cid, 10)).catch(function(err) {
                            console.warn('Join external call:', err);
                        });
                    }
                });
            }
        });
    }
    
    // Эмодзи-панель (список загружается при первом открытии из api/emojis.php)
    const btnEmoji = document.getElementById('btnEmoji');
    const emojiPanel = document.getElementById('emojiPanel');
    if (btnEmoji && emojiPanel) {
        btnEmoji.addEventListener('click', async () => {
            const stickerPanel = document.getElementById('stickerPanel');
            if (stickerPanel) stickerPanel.style.display = 'none';
            const willShow = emojiPanel.classList.contains('is-hidden');
            if (willShow && !inlineEmojiListCache) {
                await loadInlineEmojiList();
            }
            initEmojiPanel();
            emojiPanel.classList.toggle('is-hidden', !willShow);
        });
        const emojiSearch = document.getElementById('emojiPanelSearch');
        const emojiSortByUsage = document.getElementById('emojiPanelSortByUsage');
        if (emojiSearch) emojiSearch.addEventListener('input', () => renderEmojiPanelGrid());
        if (emojiSortByUsage) {
            emojiSortByUsage.addEventListener('click', () => {
                const pressed = emojiSortByUsage.getAttribute('aria-pressed') === 'true';
                emojiSortByUsage.setAttribute('aria-pressed', pressed ? 'false' : 'true');
                renderEmojiPanelGrid();
            });
        }
    }
    
    // Панель стикеров (при открытии загружаем список заново — учитываются настройки категорий и видимости из админки)
    const btnSticker = document.getElementById('btnSticker');
    const stickerPanel = document.getElementById('stickerPanel');
    if (btnSticker && stickerPanel) {
        btnSticker.addEventListener('click', async () => {
            if (emojiPanel) emojiPanel.classList.add('is-hidden');
            const willShow = stickerPanel.classList.contains('is-hidden');
            if (willShow) {
                stickerPanel.style.display = '';
                await initStickerPanel();
            }
            stickerPanel.classList.toggle('is-hidden', !willShow);
        });
    }

    // Закрытие эмодзи/стикер-панелей: клик снаружи или выход курсора с панели
    function hideEmojiStickerPanels(e) {
        const inPanel = emojiPanel && (emojiPanel.contains(e.target) || stickerPanel && stickerPanel.contains(e.target));
        const onToggle = (e.target === btnEmoji || e.target === btnSticker) || (btnEmoji && btnEmoji.contains(e.target)) || (btnSticker && btnSticker.contains(e.target));
        if (!inPanel && !onToggle) {
            if (emojiPanel) emojiPanel.classList.add('is-hidden');
            if (stickerPanel) stickerPanel.classList.add('is-hidden');
        }
    }
    document.addEventListener('click', hideEmojiStickerPanels);
    if (emojiPanel) {
        emojiPanel.addEventListener('mouseleave', () => { emojiPanel.classList.add('is-hidden'); });
    }
    if (stickerPanel) {
        stickerPanel.addEventListener('mouseleave', () => { stickerPanel.classList.add('is-hidden'); });
        const stickerSearch = document.getElementById('stickerPanelSearch');
        const stickerSortByUsage = document.getElementById('stickerPanelSortByUsage');
        if (stickerSearch) stickerSearch.addEventListener('input', () => renderStickers());
        if (stickerSortByUsage) {
            stickerSortByUsage.addEventListener('click', () => {
                const pressed = stickerSortByUsage.getAttribute('aria-pressed') === 'true';
                stickerSortByUsage.setAttribute('aria-pressed', pressed ? 'false' : 'true');
                renderStickers();
            });
        }
    }
    
    // Пикер реакций: список эмодзи загружается с API (по убыванию использования), клик — через делегирование
    const reactionPicker = document.getElementById('reactionPicker');
    const reactionPickerEmojis = document.getElementById('reactionPickerEmojis');
    if (reactionPicker && reactionPickerEmojis) {
        loadReactionEmojiList();
        loadInlineEmojiList();
        reactionPickerEmojis.addEventListener('click', (e) => {
            const btn = e.target.closest('.reaction-picker-btn');
            if (!btn || btn.tagName !== 'BUTTON') return;
            e.preventDefault();
            e.stopPropagation();
            const msgId = reactionPickerMessageId;
            let list = Array.isArray(reactionEmojiListCache) && reactionEmojiListCache.length ? reactionEmojiListCache : REACTION_EMOJI_FALLBACK;
            if (list.length === 1 && typeof list[0] === 'string' && list[0].length > 4) list = splitEmojiStringToArray(list[0]);
            const idx = typeof btn.dataset.index !== 'undefined' ? parseInt(btn.dataset.index, 10) : -1;
            const emoji = (idx >= 0 && list[idx]) ? list[idx] : (btn.dataset.emoji || (btn.textContent && btn.textContent.trim().length <= 10 ? btn.textContent.trim() : '') || '');
            if (msgId && emoji) toggleReaction(msgId, emoji, null);
            reactionPicker.classList.add('is-hidden');
        });
        const reactionPickerDelete = document.getElementById('reactionPickerDelete');
        if (reactionPickerDelete) {
            reactionPickerDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                const msgId = reactionPickerMessageId;
                if (msgId) deleteMessage(msgId);
            });
        }
        const reactionPickerReply = document.getElementById('reactionPickerReply');
        if (reactionPickerReply) {
            const doReply = (e) => {
                if (e) e.stopPropagation();
                if (reactionPickerMessage) setReplyingTo(reactionPickerMessage);
            };
            reactionPickerReply.addEventListener('click', (e) => { e.stopPropagation(); doReply(e); });
            reactionPickerReply.addEventListener('touchend', (e) => {
                e.preventDefault();
                doReply(e);
            }, { passive: false });
        }
        const reactionPickerForward = document.getElementById('reactionPickerForward');
        if (reactionPickerForward) {
            reactionPickerForward.addEventListener('click', (e) => {
                e.stopPropagation();
                if (reactionPickerMessageId) {
                    forwardMessageIdsToSend = [reactionPickerMessageId];
                    openForwardToModal();
                }
                if (reactionPicker) reactionPicker.classList.add('is-hidden');
            });
        }
        const reactionPickerSaveSticker = document.getElementById('reactionPickerSaveSticker');
        if (reactionPickerSaveSticker) {
            reactionPickerSaveSticker.addEventListener('click', async (e) => {
                e.stopPropagation();
                const msgId = reactionPickerMessageId;
                if (reactionPicker) reactionPicker.classList.add('is-hidden');
                if (!msgId) return;
                try {
                    const r = await apiRequest(`${API_BASE}/api/stickers.php?action=add_from_message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message_id: msgId })
                    });
                    if (r.success) {
                        if (typeof trackEvent === 'function') trackEvent('sticker_saved_from_message', { message_id: msgId });
                        showToast('GIF добавлен в стикеры (категория GIF)');
                    } else {
                        alert(r.error || chatLang('load_error', 'Error'));
                    }
                } catch (err) {
                    const msg = err && err.message ? err.message : chatLang('save_error', 'Save error');
                    alert(msg.includes('error') || msg.includes('Error') ? msg : (chatLang('load_error', 'Error') + ': ') + msg);
                }
            });
        }
        const reactionPickerSelect = document.getElementById('reactionPickerSelect');
        if (reactionPickerSelect) {
            reactionPickerSelect.addEventListener('click', (e) => {
                e.stopPropagation();
                const msgId = reactionPickerMessageId;
                if (reactionPicker) reactionPicker.classList.add('is-hidden');
                if (msgId) {
                    enterForwardSelectionMode();
                    const chatMessages = document.getElementById('chatMessages');
                    const cb = chatMessages && chatMessages.querySelector(`.message-forward-checkbox[data-message-id="${msgId}"]`);
                    if (cb) {
                        cb.checked = true;
                        updateForwardSelectionBar();
                    }
                }
            });
        }
        document.addEventListener('click', (e) => {
            if (reactionPicker.style.display !== 'none' && !reactionPicker.contains(e.target) && !e.target.closest('.message-bubble')) {
                reactionPicker.classList.add('is-hidden');
            }
        });
        // В мобильном режиме: при начале выделения текста скрывать пикер реакций
        document.addEventListener('selectionchange', () => {
            if (window.innerWidth > 768) return;
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0) {
                reactionPicker.classList.add('is-hidden');
            }
        });
    }

    // Контекстное меню беседы: скрыть для себя / удалить для всех
    const conversationContextMenu = document.getElementById('conversationContextMenu');
    const conversationContextMenuDeleteHide = document.getElementById('conversationContextMenuDeleteHide');
    const conversationContextMenuDeleteForAll = document.getElementById('conversationContextMenuDeleteForAll');
    if (conversationContextMenuDeleteHide) {
        conversationContextMenuDeleteHide.addEventListener('click', () => {
            if (conversationContextMenuConvId != null) deleteConversation(conversationContextMenuConvId, false);
        });
    }
    if (conversationContextMenuDeleteForAll) {
        conversationContextMenuDeleteForAll.addEventListener('click', () => {
            if (conversationContextMenuConvId != null) deleteConversation(conversationContextMenuConvId, true);
        });
    }
    document.addEventListener('click', (e) => {
        if (conversationContextMenu && !conversationContextMenu.classList.contains('is-hidden') && !conversationContextMenu.contains(e.target) && !e.target.closest('.chat-item-row')) {
            hideConversationContextMenu();
        }
    });
}

let chatDateFloatingHideTimer = null;
const CHAT_DATE_FLOATING_HIDE_MS = 1500;

function setupChatDateFloating() {
    const container = document.getElementById('chatMessages');
    const floatingEl = document.getElementById('chatDateFloating');
    const textEl = document.getElementById('chatDateFloatingText');
    if (!container || !floatingEl || !textEl) return;

    function updateFloatingDate() {
        const messages = container.querySelectorAll('.message[data-created-at]');
        if (messages.length === 0) return;
        const rect = container.getBoundingClientRect();
        const top = rect.top;
        const bottom = rect.bottom;
        for (const msg of messages) {
            const r = msg.getBoundingClientRect();
            if (r.bottom >= top && r.top <= bottom) {
                const createdAt = msg.dataset.createdAt;
                if (createdAt) {
                    textEl.textContent = formatMessageDate(createdAt);
                    floatingEl.classList.add('visible');
                }
                break;
            }
        }
        clearTimeout(chatDateFloatingHideTimer);
        chatDateFloatingHideTimer = setTimeout(() => {
            floatingEl.classList.remove('visible');
        }, CHAT_DATE_FLOATING_HIDE_MS);
    }

    container.addEventListener('scroll', updateFloatingDate, { passive: true });
}

// Быстрые эмодзи для панели (fallback при недоступности API)
const EMOJI_LIST = '😀😃😄😁😅😂🤣😊😇🙂😉😍🥰😘😗😙😚😋😛😜🤪😝🤑🤗🤭🤫🤔😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈💀☠️💩🤡👻💪👍👎👊✊🤛🤜👏🙌👐🤲🤝🙏✌️🤞🤟🤘🤙👌🤌🤏👈👉👆👇☝️❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉️☸️✡️🔯🕎☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️🉑☢️☣️📴📳🈶🈚🈸🈺🈷️✴️🆚💮🉐㊙️㊗️🈴🈵🈹🈲🅰️🅱️🆎🆑🅾️🆘❌⭕🛑⛔📛🚫💯💢♨️🚷🚯🚳🚱🔞📵🚭❗❕❓❔‼️⁉️🔅🔆〽️⚠️🚸🔱⚜️🔰♻️✅🈯💹❇️✳️❎🌐💠Ⓜ️🌀💤🏧🚾♿🅿️🛗🈳🈂️🛂🛃🛄🛅🚹🚺🚼⚧️🚻🚮🎦📶🈁🔣ℹ️🔤🔡🔠🆖🆗🆙🆒🆕🆓0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟🔢#️⃣*️⃣⏏️▶️⏸️⏯️⏹️⏺️⏭️⏮️⏩⏪⏫⏬◀️🔼🔽➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️↪️↩️⤴️⤵️🔀🔁🔂🔄🔃🎵🎶➕➖➗✖️♾️💲💱™️©️®️';

/** Кэш списка эмодзи для inline-панели (из api/emojis.php): массив { emoji, keywords, usage_count }. */
let inlineEmojiListCache = null;

function getEmojiPanelSearchQuery() {
    const el = document.getElementById('emojiPanelSearch');
    return (el && el.value) ? el.value.trim().toLowerCase() : '';
}

function getEmojiPanelSortByUsage() {
    const el = document.getElementById('emojiPanelSortByUsage');
    return el && el.getAttribute('aria-pressed') === 'true';
}

/** Нормализовать элемент кэша к объекту { emoji, keywords, usage_count }. */
function normalizeEmojiItem(item) {
    if (typeof item === 'string') {
        return { emoji: item, keywords: '', usage_count: 0 };
    }
    return {
        emoji: item.emoji || '',
        keywords: (item.keywords || '').toLowerCase(),
        usage_count: typeof item.usage_count === 'number' ? item.usage_count : 0
    };
}

function renderEmojiPanelGrid() {
    const grid = document.getElementById('emojiPanelGrid');
    if (!grid) return;
    const searchQuery = getEmojiPanelSearchQuery();
    const sortByUsage = getEmojiPanelSortByUsage();
    let list = Array.isArray(inlineEmojiListCache) && inlineEmojiListCache.length
        ? inlineEmojiListCache.map(normalizeEmojiItem)
        : splitEmojiStringToArray(EMOJI_LIST).map(function (e) { return { emoji: e, keywords: '', usage_count: 0 }; });
    if (searchQuery) {
        list = list.filter(function (item) {
            const text = (item.keywords + ' ' + item.emoji).toLowerCase();
            return text.indexOf(searchQuery) !== -1;
        });
    }
    if (sortByUsage) {
        list = list.filter(function (item) { return item.usage_count > 0; });
        list.sort(function (a, b) { return (b.usage_count || 0) - (a.usage_count || 0); });
    }
    grid.innerHTML = '';
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const emoji = item.emoji;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-panel-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', (function (em) {
            return function () {
                const input = getActiveMessageInputElement();
                if (input) {
                    input.focus();
                    if (input.contentEditable === 'true') {
                        document.execCommand('insertText', false, em);
                    } else {
                        const start = input.selectionStart;
                        const end = input.selectionEnd;
                        const text = input.value;
                        input.value = text.substring(0, start) + em + text.substring(end);
                        input.selectionStart = input.selectionEnd = start + em.length;
                    }
                }
            };
        })(emoji));
        grid.appendChild(btn);
    }
    if (useTwemoji()) twemoji.parse(grid, { folder: 'svg', ext: '.svg', className: 'twemoji' });
}

function initEmojiPanel() {
    renderEmojiPanelGrid();
}

let stickersCache = [];
/** Порядок категорий стикеров (для группировки и прокрутки к группе). */
let stickerCategoriesOrder = [];

/** Запуск анимации поворота и «разлёта» эмодзи для сообщения-стикера по id (при добавлении в чат и по клику). */
function triggerStickerShakeForMessage(messageId) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const msgEl = chatMessages.querySelector(`.message[data-message-id="${messageId}"]`);
    const bubble = msgEl && msgEl.querySelector('.message-bubble');
    if (!bubble) return;
    const emojiSticker = bubble.querySelector('.message-sticker-emoji');
    const isEmojiSticker = !!emojiSticker;
    let runsLeft = 2; /* воспроизвести анимацию два раза */
    const run = () => {
        bubble.classList.remove('message-sticker-shake');
        void bubble.offsetHeight; /* reflow, чтобы анимация перезапустилась при повторном вызове */
        bubble.classList.add('message-sticker-shake');
        setTimeout(() => bubble.classList.remove('message-sticker-shake'), 2000);

        /* Разлёт 7 копий эмодзи в разные стороны (только для эмодзи-стикеров) */
        if (isEmojiSticker && emojiSticker) {
            const emojiChar = (emojiSticker.querySelector('img.twemoji') && emojiSticker.querySelector('img.twemoji').alt) || emojiSticker.textContent || emojiSticker.innerText || '';
            if (emojiChar) {
                const bubbleRect = bubble.getBoundingClientRect();
                const stickerRect = emojiSticker.getBoundingClientRect();
                const burst = document.createElement('div');
                burst.className = 'message-sticker-burst';
                burst.style.left = (stickerRect.left - bubbleRect.left) + 'px';
                burst.style.top = (stickerRect.top - bubbleRect.top) + 'px';
                burst.style.width = stickerRect.width + 'px';
                burst.style.height = stickerRect.height + 'px';
                const maxDistance = 90;
                const count = 6 + Math.floor(Math.random() * 5); /* от 6 до 10 */
                for (let i = 0; i < count; i++) {
                    const angle = i * (2 * Math.PI / count);
                    const distance = Math.random() * maxDistance; /* случайное расстояние, не дальше max */
                    const tx = Math.sin(angle) * distance;
                    const ty = -Math.cos(angle) * distance;
                    const rot = (Math.random() * 360 - 180);
                    const scale = 0.35 + Math.random() * 0.45;
                    const spin = (Math.random() > 0.5 ? 720 : -720);
                    const xSign = Math.random() > 0.5 ? 1 : -1;
                    const ySign = Math.random() > 0.5 ? 1 : -1;
                    const span = document.createElement('span');
                    span.className = 'message-sticker-burst-emoji';
                    span.textContent = emojiChar;
                    span.style.setProperty('--burst-tx', tx + 'px');
                    span.style.setProperty('--burst-ty', ty + 'px');
                    span.style.setProperty('--burst-rotate', rot + 'deg');
                    span.style.setProperty('--burst-spin', spin + 'deg');
                    span.style.setProperty('--burst-spin-40', (spin * 0.4) + 'deg');
                    span.style.setProperty('--burst-x-sign', String(xSign));
                    span.style.setProperty('--burst-y-sign', String(ySign));
                    span.style.setProperty('--burst-scale', String(scale));
                    span.style.animationDelay = (Math.random() * 0.08) + 's';
                    burst.appendChild(span);
                }
                bubble.appendChild(burst);
                if (useTwemoji()) twemoji.parse(burst, { folder: 'svg', ext: '.svg', className: 'twemoji' });
                setTimeout(() => burst.remove(), 1600);
            }
        }
        runsLeft--;
        if (runsLeft > 0 && isEmojiSticker) setTimeout(run, 400);
    };
    /* При первом появлении в чате даём время на отрисовку, чтобы анимация была видна (в т.ч. при добавлении через WebSocket) */
    if (!msgEl.dataset.stickerShakeDone) {
        msgEl.dataset.stickerShakeDone = '1';
        setTimeout(run, 120);
    } else {
        run();
    }
}

async function initStickerPanel() {
    const grid = document.getElementById('stickerPanelGrid');
    const categoriesEl = document.getElementById('stickerCategories');
    if (!grid) return;
    try {
        const data = await apiRequest(`${API_BASE}/api/stickers.php`);
        stickersCache = data.data.stickers || [];
        const categories = Array.isArray(data.data.categories) && data.data.categories.length
            ? data.data.categories
            : (stickersCache.length ? [...new Set(stickersCache.map(s => s.category || chatLang('all_category', 'Все')))] : []);
        stickerCategoriesOrder = categories;
        if (categoriesEl) {
            categoriesEl.innerHTML = categories.map(cat =>
                `<button type="button" class="sticker-category-btn" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
            ).join('');
            categoriesEl.querySelectorAll('.sticker-category-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    categoriesEl.querySelectorAll('.sticker-category-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const section = document.getElementById('sticker-group-' + encodeURIComponent(btn.dataset.category));
                    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        }
        const defaultCategory = categories.includes('GIF') ? 'GIF' : (categories[0] || null);
        if (categoriesEl && defaultCategory) {
            const defaultBtn = categoriesEl.querySelector(`.sticker-category-btn[data-category="${defaultCategory}"]`);
            if (defaultBtn) defaultBtn.classList.add('active');
        }
        renderStickers();
        const gridEl = document.getElementById('stickerPanelGrid');
        if (gridEl) {
            gridEl.addEventListener('scroll', updateStickerCategoryActiveByScroll);
        }
    } catch (e) {
        if (categoriesEl) {
            categoriesEl.innerHTML = '';
        }
        stickerCategoriesOrder = [];
        grid.innerHTML = '<div class="sticker-panel-empty">' + chatLang('load_error', 'Error loading stickers') + '</div>';
    }
}

function updateStickerCategoryActiveByScroll() {
    const grid = document.getElementById('stickerPanelGrid');
    const categoriesEl = document.getElementById('stickerCategories');
    if (!grid || !categoriesEl) return;
    const groups = grid.querySelectorAll('.sticker-panel-category-group');
    if (!groups.length) return;
    const scrollTop = grid.scrollTop;
    const mid = scrollTop + grid.clientHeight / 2;
    let current = null;
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const top = g.offsetTop;
        const bottom = top + g.offsetHeight;
        if (top <= mid && bottom > mid) {
            current = g;
            break;
        }
        if (top <= mid) current = g;
    }
    if (!current) current = groups[0];
    const cat = current.getAttribute('data-category');
    if (cat == null) return;
    categoriesEl.querySelectorAll('.sticker-category-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.category === cat);
    });
}

function getStickerPanelSearchQuery() {
    const el = document.getElementById('stickerPanelSearch');
    return (el && el.value) ? el.value.trim().toLowerCase() : '';
}

function getStickerPanelSortByUsage() {
    const el = document.getElementById('stickerPanelSortByUsage');
    return el && el.getAttribute('aria-pressed') === 'true';
}

function renderStickers() {
    const grid = document.getElementById('stickerPanelGrid');
    if (!grid) return;
    let list = stickersCache.slice();
    const searchQuery = getStickerPanelSearchQuery();
    if (searchQuery) {
        list = list.filter(s => {
            const name = (s.name || '').toLowerCase();
            const cat = (s.category || '').toLowerCase();
            const emoji = (s.emoji || '').toLowerCase();
            return name.indexOf(searchQuery) !== -1 || cat.indexOf(searchQuery) !== -1 || emoji.indexOf(searchQuery) !== -1;
        });
    }
    const sortByUsage = getStickerPanelSortByUsage();
    if (sortByUsage) {
        list = list.filter(s => (s.usage_count || 0) > 0);
        list.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    }
    const isVideo = (p) => (p || '').match(/\.(mp4|webm|mov)(\?|$)/i);
    const categories = stickerCategoriesOrder.length ? stickerCategoriesOrder : [...new Set(list.map(s => s.category || '').filter(Boolean))];
    const byCategory = {};
    list.forEach(s => {
        const cat = s.category || '';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(s);
    });
    let html = '';
    categories.forEach(cat => {
        const items = byCategory[cat];
        if (!items || !items.length) return;
        const groupId = 'sticker-group-' + encodeURIComponent(cat);
        html += `<div class="sticker-panel-category-group" id="${groupId}" data-category="${escapeHtml(cat)}">`;
        html += `<div class="sticker-panel-group-label">${escapeHtml(cat)}</div>`;
        html += '<div class="sticker-panel-group-items">';
        items.forEach(s => {
            let content;
            if (s.emoji) {
                content = `<span class="sticker-emoji">${s.emoji}</span>`;
            } else if (s.url && isVideo(s.file_path || s.url)) {
                content = `<video src="${escapeHtml(s.url)}" class="sticker-img sticker-video" muted loop playsinline></video>`;
            } else {
                content = `<img src="${escapeHtml(s.url || '')}" alt="${escapeHtml(s.name)}" class="sticker-img">`;
            }
            html += `<button type="button" class="sticker-panel-item" data-sticker-id="${s.id}" data-emoji="${escapeHtml(s.emoji || '')}" data-url="${escapeHtml(s.url || '')}" data-path="${escapeHtml(s.file_path || '')}">${content}</button>`;
        });
        html += '</div></div>';
    });
    grid.innerHTML = html || '<div class="sticker-panel-empty">' + (searchQuery || list.length === 0 ? chatLang('chat.no_chats_found', 'Ничего не найдено') : '') + '</div>';
    grid.querySelectorAll('.sticker-panel-item').forEach(btn => {
        btn.addEventListener('click', () => sendSticker(btn.dataset));
    });
    if (useTwemoji()) twemoji.parse(grid, { folder: 'svg', ext: '.svg', className: 'twemoji' });
    updateStickerCategoryActiveByScroll();
}

async function sendSticker(dataset) {
    if (!currentConversationId) return;
    const stickerPanelEl = document.getElementById('stickerPanel');
    if (stickerPanelEl) {
        stickerPanelEl.classList.add('is-hidden');
    }
    const emoji = dataset.emoji;
    const url = dataset.url;
    const filePath = dataset.path && dataset.path.indexOf('emoji:') === 0 ? null : (url || dataset.path);
    try {
        const body = {
            conversation_id: currentConversationId,
            type: 'sticker',
            content: emoji || '',
            file_path: filePath || (emoji ? 'emoji:' + emoji : null),
            file_name: null,
            file_size: null
        };
        if (replyingToMessage && replyingToMessage.id) body.reply_to_id = replyingToMessage.id;
        const data = await apiRequest(`${API_BASE}/api/messages.php`, { method: 'POST', body: JSON.stringify(body) });
        if (data.data.message) {
            const chatMessages = document.getElementById('chatMessages');
            const msg = data.data.message;
            if (chatMessages && !chatMessages.querySelector(`.message[data-message-id="${msg.id}"]`)) {
                renderMessages([msg], false);
                triggerStickerShakeForMessage(msg.id);
            }
            requestAnimationFrame(() => scrollToBottom());
        }
        clearReplyingTo();
        loadConversations();
        trackEvent('sticker_sent', { sticker_id: dataset.stickerId });
    } catch (err) {
        console.error(err);
        alert(chatLang('sticker_send_error', 'Error sending sticker'));
    }
}

let reactionPickerMessageId = null;
/** Полный объект сообщения при открытом пикере (для кнопки «Ответить») */
let reactionPickerMessage = null;

/** Кэш списка эмодзи для реакций (от API, по убыванию использования). */
let reactionEmojiListCache = null;
/** Расширенный набор при недоступности API (403/сеть), чтобы не ограничиваться 6 кнопками. */
const REACTION_EMOJI_FALLBACK = [
    '👍', '❤️', '😂', '😮', '😢', '🙏', '😀', '😃', '😄', '😊', '😍', '🤔', '😐', '😒', '🙄', '😌', '😴', '😷', '🤒', '😵', '🤠', '😎', '😕', '😟', '😳', '😦', '😭', '😱', '😤', '😡', '💀', '💩', '👎', '👏', '🙌', '✌️', '🤞', '👌', '💛', '💚', '💙', '💜', '💔', '💕', '✅', '❌', '⭕', '❗', '❓'
];

async function loadReactionEmojiList() {
    try {
        const r = await fetch(`${API_BASE}/api/reactions.php?list_emojis=1`, { credentials: 'include' });
        const data = r.ok ? await r.json().catch(() => null) : null;
        if (data && data.data && Array.isArray(data.data.emojis)) {
            reactionEmojiListCache = data.data.emojis.map((x) => x.emoji);
            return;
        }
        if (r.status === 403) {
            console.warn(
                'Reactions API: 403 Forbidden. On server run: sudo chown http:users api/reactions.php && sudo chmod 644 api/reactions.php'
            );
        }
    } catch (err) {
        console.debug('Reaction emoji list load failed, using fallback:', err);
    }
    reactionEmojiListCache = REACTION_EMOJI_FALLBACK;
}

async function loadInlineEmojiList() {
    try {
        const r = await fetch(`${API_BASE}/api/emojis.php`, { credentials: 'include' });
        const data = r.ok ? await r.json().catch(() => null) : null;
        if (data && data.data && Array.isArray(data.data.emojis)) {
            inlineEmojiListCache = data.data.emojis.map((x) => ({
                emoji: x.emoji,
                keywords: x.keywords || '',
                usage_count: typeof x.usage_count === 'number' ? x.usage_count : 0
            }));
            return;
        }
    } catch (e) {}
    const fallback = splitEmojiStringToArray(EMOJI_LIST);
    inlineEmojiListCache = fallback.map((e) => ({ emoji: e, keywords: '', usage_count: 0 }));
}

function splitEmojiStringToArray(str) {
    if (typeof str !== 'string' || !str) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(str)].map((s) => s.segment);
    }
    return Array.from(str);
}

function fillReactionPicker() {
    const container = document.getElementById('reactionPickerEmojis');
    if (!container) return;
    let list = Array.isArray(reactionEmojiListCache) && reactionEmojiListCache.length ? reactionEmojiListCache : REACTION_EMOJI_FALLBACK;
    if (list.length === 1 && typeof list[0] === 'string' && list[0].length > 4) {
        list = splitEmojiStringToArray(list[0]);
    }
    container.innerHTML = list
        .map((emoji, i) => `<button type="button" class="reaction-picker-btn" data-index="${i}" data-emoji="${escapeHtml(emoji)}">${emoji}</button>`)
        .join('');
    if (useTwemoji()) twemoji.parse(container, { folder: 'svg', ext: '.svg', className: 'twemoji' });
}

// Состояние «ответ на сообщение»: { id, username, content_preview }
let replyingToMessage = null;

// ID сообщений для пересылки (один или несколько)
let forwardMessageIdsToSend = [];

// Режим выбора сообщений для пересылки (несколько)
let forwardSelectionMode = false;

// Выбранные участники для нового группового чата
let groupSelectedParticipants = new Set();

function getMessageContentPreview(msg) {
    if (!msg) return '';
    if (msg.type === 'image') return '[Изображение]';
    if (msg.type === 'file') return msg.file_name ? '[Файл: ' + msg.file_name + ']' : '[Файл]';
    if (msg.type === 'sticker') return '[Стикер]';
    if (msg.type === 'call') return '[Звонок]';
    const text = stripTextStyles((msg.content || '').trim());
    return text.length > 100 ? text.slice(0, 100) + '…' : text;
}

/** Собрать данные сообщения из DOM (для ответа при открытии пикера с long-press / свайпе) */
function getMessageDataFromElement(msgEl) {
    if (!msgEl) return null;
    const id = parseInt(msgEl.dataset.messageId, 10);
    if (!id || !Number.isFinite(id)) return null;
    const username = (msgEl.dataset.username || '').trim();
    let content_preview = (msgEl.dataset.contentPreview || '').trim();
    if (!content_preview) {
        const contentEl = msgEl.querySelector('.message-content');
        if (contentEl) {
            const text = (contentEl.innerText || contentEl.textContent || '').replace(/\s+/g, ' ').trim();
            content_preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
        }
        if (!content_preview) content_preview = '[Сообщение]';
    }
    return { id, username, content_preview };
}

function setReplyingTo(message) {
    if (!message) return;
    replyingToMessage = {
        id: message.id,
        username: message.username || '',
        content_preview: message.content_preview !== undefined ? message.content_preview : getMessageContentPreview(message)
    };
    updateReplyPreviewUI();
    const input = getActiveMessageInputElement();
    if (input) input.focus();
    const picker = document.getElementById('reactionPicker');
    if (picker) picker.classList.add('is-hidden');
}

function clearReplyingTo() {
    replyingToMessage = null;
    updateReplyPreviewUI();
}

function updateReplyPreviewUI() {
    const wrap = document.getElementById('chatInputReplyPreview');
    if (!wrap) return;
    if (!replyingToMessage) {
        wrap.classList.add('is-hidden');
        wrap.innerHTML = '';
        return;
    }
    const username = escapeHtml(replyingToMessage.username || '');
    const preview = escapeHtml(replyingToMessage.content_preview || '');
    wrap.innerHTML = `
        <span class="chat-input-reply-text">${escapeHtml(chatLang('reply_to', 'Ответ на'))} <strong>${username}</strong>: ${preview}</span>
        <button type="button" class="chat-input-reply-cancel" id="chatInputReplyCancel" aria-label="${escapeHtml(chatLang('cancel_reply', 'Cancel reply'))}">${escapeHtml(chatLang('cancel_reply', 'Cancel reply'))}</button>
    `;
    wrap.classList.remove('is-hidden');
    const cancelBtn = document.getElementById('chatInputReplyCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); clearReplyingTo(); });
}

function showReactionPicker(e, messageId, message) {
    const picker = document.getElementById('reactionPicker');
    if (!picker) return;
    if (!message && messageId) {
        const msgEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
        message = msgEl ? getMessageDataFromElement(msgEl) : null;
    }
    const msgEl = (e && e.target) ? e.target.closest('.message') : document.querySelector(`.message[data-message-id="${messageId}"]`);
    const messageType = (message && message.type) || (msgEl && msgEl.dataset.messageType) || 'text';
    if (messageType === 'call') return; // Реакции на звонки запрещены
    fillReactionPicker();
    reactionPickerMessageId = messageId;
    reactionPickerMessage = message || null;
    const isOwn = msgEl ? msgEl.classList.contains('own') : false;
    const deleteBtn = document.getElementById('reactionPickerDelete');
    if (deleteBtn) deleteBtn.classList.toggle('is-hidden', !isOwn);
    const forwardBtn = document.getElementById('reactionPickerForward');
    if (forwardBtn) forwardBtn.classList.toggle('is-hidden', messageType === 'call');
    const selectBtn = document.getElementById('reactionPickerSelect');
    if (selectBtn) selectBtn.classList.toggle('is-hidden', messageType === 'call');
    const isAdmin = document.body.dataset.isAdmin === '1';
    const fp = (message && (message.file_path || message.file_name || '')) || (msgEl && msgEl.dataset.filePath) || '';
    const isGif = /\.gif(\?|$)/i.test(fp);
    const saveStickerBtn = document.getElementById('reactionPickerSaveSticker');
    if (saveStickerBtn) {
        saveStickerBtn.classList.toggle('is-hidden', !(isAdmin && (messageType === 'image' || messageType === 'file') && isGif));
    }
    picker.classList.remove('is-hidden');
    picker.style.left = (e.clientX || 0) + 'px';
    picker.style.top = (e.clientY || 0) + 'px';
    const rect = picker.getBoundingClientRect();
    if (rect.right > window.innerWidth) picker.style.left = (window.innerWidth - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) picker.style.top = (window.innerHeight - rect.height) + 'px';
}

let conversationContextMenuConvId = null;

function showConversationContextMenu(e, conversationId) {
    const menu = document.getElementById('conversationContextMenu');
    if (!menu) return;
    conversationContextMenuConvId = conversationId;
    menu.classList.remove('is-hidden');
    menu.style.left = (e.clientX || 0) + 'px';
    menu.style.top = (e.clientY || 0) + 'px';
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height) + 'px';
}

function hideConversationContextMenu() {
    const menu = document.getElementById('conversationContextMenu');
    if (menu) menu.classList.add('is-hidden');
    conversationContextMenuConvId = null;
}

async function deleteConversation(conversationId, forEveryone = false) {
    if (!conversationId) return;
    hideConversationContextMenu();
    const url = `${API_BASE}/api/conversations.php?id=${conversationId}${forEveryone ? '&for_everyone=1' : ''}`;
    try {
        await apiRequest(url, { method: 'DELETE' });
        if (currentConversationId === conversationId) {
            currentConversationId = null;
            lastMessageId = 0;
            if (window.pushModule && typeof window.pushModule.notifyConversationFocus === 'function') {
                window.pushModule.notifyConversationFocus(null, false);
            }
            document.getElementById('chatEmpty').classList.remove('is-hidden');
            document.getElementById('chatWindow').classList.add('is-hidden');
            document.body.classList.remove('mobile-chat-open');
        }
        loadConversations();
        const profileModal = document.getElementById('modalUserProfile');
        if (profileModal) profileModal.classList.add('is-hidden');
    } catch (err) {
        console.error('Delete conversation error:', err);
        alert(err.message || chatLang('delete_conversation_error', 'Could not delete conversation'));
    }
}

async function deleteMessage(messageId) {
    if (!messageId) return;
    const picker = document.getElementById('reactionPicker');
    if (picker) picker.classList.add('is-hidden');
    reactionPickerMessageId = null;
    try {
        const response = await apiRequest(`${API_BASE}/api/messages.php?id=${messageId}`, { method: 'DELETE' });
        const msgEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (msgEl) {
            const permanent = response && response.data && response.data.permanent === true;
            if (permanent) {
                msgEl.remove();
            } else {
                const bubble = msgEl.querySelector('.message-bubble');
                if (bubble) {
                    bubble.innerHTML = '<div class="message-content message-deleted">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.message_deleted ? window.__LANG__.chat.message_deleted : 'Message deleted') + '</div>';
                    bubble.classList.add('message-deleted-bubble');
                }
            }
        }
    } catch (err) {
        console.error('Delete message error:', err);
        alert(err.message || chatLang('delete_message_error', 'Could not delete message'));
    }
}

// Время последнего обновления реакций по сообщениям (от POST) — polling не перезаписывает их 3 с
window.__reactionUpdateTime = window.__reactionUpdateTime || {};

/** Один элемент реакции: при count === 1 добавляется аватар автора. Доступно глобально для websocket/polling. */
function buildOneReactionHtml(r) {
    const own = r.has_own ? ' own-reaction' : '';
    const countHtml = r.count > 1 ? `<span class="message-reaction-count">${r.count}</span>` : '';
    let avatarHtml = '';
    if (r.count === 1 && (r.single_avatar || r.single_username || r.single_user_uuid)) {
        const title = (r.single_username || '').trim() ? escapeHtml(r.single_username) : chatLang('reaction', 'Reaction');
        const uuid = (r.single_user_uuid || '').trim();
        const dataUuid = uuid ? ` data-user-uuid="${escapeHtml(uuid)}"` : '';
        if (r.single_avatar) {
            avatarHtml = `<span class="message-reaction-avatar"${dataUuid} title="${title}"><img src="${escapeHtml(r.single_avatar)}" alt=""></span>`;
        } else {
            const letter = (r.single_username || '?').trim().substring(0, 1);
            avatarHtml = `<span class="message-reaction-avatar message-reaction-avatar-placeholder"${dataUuid} title="${title}">${escapeHtml(letter)}</span>`;
        }
    }
    return `<span class="message-reaction${own}" data-emoji="${escapeHtml(r.emoji)}">${r.emoji}${avatarHtml}${countHtml}</span>`;
}
if (typeof window !== 'undefined') window.buildOneReactionHtml = buildOneReactionHtml;

function renderMessageReactions(msgEl, messageId, reactions) {
    if (!msgEl) return;
    const wrap = msgEl.querySelector('.message-reactions');
    if (wrap) wrap.remove();
    const list = Array.isArray(reactions) ? reactions : [];
    if (list.length > 0) {
        const div = document.createElement('div');
        div.className = 'message-reactions';
        div.innerHTML = list.map(r => buildOneReactionHtml(r)).join('');
        msgEl.querySelector('.message-bubble').appendChild(div);
        if (useTwemoji()) twemoji.parse(div, { folder: 'svg', ext: '.svg', className: 'twemoji' });
        div.querySelectorAll('.message-reaction').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.message-reaction-avatar')) return;
                toggleReaction(messageId, el.dataset.emoji, null);
            });
        });
    }
    window.__reactionUpdateTime = window.__reactionUpdateTime || {};
    window.__reactionUpdateTime[String(messageId)] = Date.now();
}

async function toggleReaction(messageId, emoji, reactionId) {
    const currentUserUuid = document.body.dataset.userUuid || '';
    const picker = document.getElementById('reactionPicker');
    if (picker) picker.classList.add('is-hidden');
    const emojiStr = (typeof emoji === 'string' && emoji.trim()) ? emoji.trim() : '';
    if (!messageId || !emojiStr || emojiStr.length > 10) return;
    const msgId = parseInt(messageId, 10) || 0;
    let response = null;
    try {
        const bodyForm = `message_id=${encodeURIComponent(msgId)}&emoji=${encodeURIComponent(emojiStr)}`;
        response = await apiRequest(`${API_BASE}/api/reactions.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: bodyForm
        });
    } catch (err) {
        const isSynologyBlock = err && err.responseText && (err.responseText.indexOf('Synology') >= 0 || err.responseText.indexOf('<!DOCTYPE') >= 0);
        if (isSynologyBlock) {
            try {
                response = await apiRequest(
                    `${API_BASE}/api/reactions.php?action=toggle&message_id=${encodeURIComponent(msgId)}&emoji=${encodeURIComponent(emojiStr)}`
                );
            } catch (getErr) {
                if (getErr && getErr.responseText) console.warn('Reactions GET fallback ответ:', getErr.responseText);
                response = null;
            }
        }
        if (!response) {
            console.error('Reaction error:', err && err.message ? err.message : err);
        }
    }
    try {
        if (response) {
            let reactions = response.data && Array.isArray(response.data.reactions) ? response.data.reactions : null;
            if (!reactions && currentConversationId) {
                const data = await apiRequest(`${API_BASE}/api/reactions.php?conversation_id=${currentConversationId}&message_ids=${messageId}`);
                const reactionsByMessage = data.data.reactions || {};
                reactions = reactionsByMessage[messageId] || [];
            }
            const msgEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (msgEl && Array.isArray(reactions)) renderMessageReactions(msgEl, messageId, reactions);
        }
    } catch (_) {}
    if (!response) {
        try {
            const msgEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (msgEl && currentConversationId) {
                const data = await apiRequest(`${API_BASE}/api/reactions.php?conversation_id=${currentConversationId}&message_ids=${messageId}`);
                const reactions = (data.data.reactions || {})[messageId] || [];
                if (Array.isArray(reactions)) renderMessageReactions(msgEl, messageId, reactions);
            }
        } catch (refreshErr) {
            console.error('Failed to refresh reactions:', refreshErr);
        }
    }
}

// Очередь подтверждения доставки (batch + debounce)
let markDeliveredQueue = { conversationId: null, messageIds: new Set(), timer: null };

async function flushMarkDelivered() {
    if (!markDeliveredQueue.conversationId || markDeliveredQueue.messageIds.size === 0) return;
    const convId = markDeliveredQueue.conversationId;
    const ids = Array.from(markDeliveredQueue.messageIds);
    markDeliveredQueue.conversationId = null;
    markDeliveredQueue.messageIds.clear();
    if (markDeliveredQueue.timer) {
        clearTimeout(markDeliveredQueue.timer);
        markDeliveredQueue.timer = null;
    }
    try {
        await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify({ action: 'mark_delivered', conversation_id: convId, message_ids: ids })
        });
    } catch (e) { /* игнорируем */ }
}

/** immediate=true — отправить сразу (для openConversation: доставка до mark_read, чтобы отобразить ✓) */
function markDelivered(conversationId, messageIds, immediate = false) {
    if (!conversationId || !messageIds || messageIds.length === 0) return immediate ? Promise.resolve() : undefined;
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    const currentUserUuid = document.body.dataset.userUuid || '';
    const filtered = ids.filter(id => id > 0);
    if (filtered.length === 0) return immediate ? Promise.resolve() : undefined;
    if (markDeliveredQueue.conversationId !== conversationId) {
        if (markDeliveredQueue.conversationId) flushMarkDelivered();
        markDeliveredQueue.conversationId = conversationId;
    }
    filtered.forEach(id => markDeliveredQueue.messageIds.add(id));
    if (immediate) {
        if (markDeliveredQueue.timer) {
            clearTimeout(markDeliveredQueue.timer);
            markDeliveredQueue.timer = null;
        }
        return flushMarkDelivered();
    }
    if (markDeliveredQueue.timer) clearTimeout(markDeliveredQueue.timer);
    markDeliveredQueue.timer = setTimeout(() => {
        markDeliveredQueue.timer = null;
        flushMarkDelivered();
    }, 300);
}

// Отметка реакций в беседе как просмотренных (убирает неувиденные из бейджа в списке чатов)
async function markReactionsSeen(conversationId) {
    if (!conversationId) return;
    try {
        const data = await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify({ conversation_id: conversationId, action: 'mark_reactions_seen' })
        });
        const conv = conversations.find(c => c.id == conversationId);
        if (conv && data.data && data.data.unseen_reactions_count !== undefined) {
            conv.unseen_reactions_count = data.data.unseen_reactions_count;
            renderConversations();
        }
    } catch (e) {
        console.warn('markReactionsSeen:', e);
    }
}

// Отметка беседы как прочитанной (убирает chat-item-unread)
async function markConversationAsRead(conversationId) {
    if (!conversationId) return;
    try {
        await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify({ conversation_id: conversationId, action: 'mark_read' })
        });
        await loadConversations();
    } catch (e) {
        console.warn('markConversationAsRead:', e);
    }
}

// Отметка сообщений как прочитанных до message_id (включительно); возвращает новый unread_count
async function markReadUpTo(conversationId, messageId) {
    if (!conversationId || !messageId) return null;
    try {
        const data = await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify({ conversation_id: conversationId, message_id: messageId, action: 'mark_read_up_to' })
        });
        const unreadCount = (data.data && data.data.unread_count !== undefined) ? data.data.unread_count : null;
        const conv = conversations.find(c => c.id == conversationId);
        if (conv) {
            if (unreadCount !== null) {
                const prev = (conv.unread_count | 0);
                conv.unread_count = Math.min(prev, unreadCount);
            }
            if (data.data && data.data.unseen_reactions_count !== undefined) conv.unseen_reactions_count = data.data.unseen_reactions_count;
            renderConversations();
            updateScrollToBottomUnreadBadge();
        }
        if (currentConversationId == conversationId) {
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) updateMessagesReadStatusInDom(chatMessages, messageId);
        }
        return unreadCount;
    } catch (e) {
        console.warn('markReadUpTo:', e);
        return null;
    }
}

let reactionsSeenObserver = null;
const reactionsSeenMessageIds = new Set();

/** Пометить увиденными реакции на своих сообщениях, которые уже в зоне видимости (при открытии чата с малым числом сообщений) */
function markVisibleReactionsAsSeen(container) {
    if (!container || !currentConversationId) return;
    const convId = currentConversationId;
    const containerRect = container.getBoundingClientRect();
    const ownWithReactions = container.querySelectorAll('.message.own .message-reactions');
    ownWithReactions.forEach(wrap => {
        const msgEl = wrap.closest('.message');
        if (!msgEl || !msgEl.dataset.messageId) return;
        const messageId = parseInt(msgEl.dataset.messageId, 10);
        if (!messageId || reactionsSeenMessageIds.has(messageId)) return;
        const rect = msgEl.getBoundingClientRect();
        const visible = !(rect.bottom < containerRect.top || rect.top > containerRect.bottom);
        if (!visible) return;
        reactionsSeenMessageIds.add(messageId);
        markReactionsSeenForMessage(convId, messageId);
    });
}

/** Наблюдение за своими сообщениями с реакциями: при появлении в зоне видимости отмечаем реакции как просмотренные */
function setupReactionsSeenObserver(container) {
    if (!container || !currentConversationId) return;
    if (reactionsSeenObserver) {
        reactionsSeenObserver.disconnect();
        reactionsSeenObserver = null;
    }
    reactionsSeenMessageIds.clear();
    const convId = currentConversationId;
    const ownWithReactions = container.querySelectorAll('.message.own .message-reactions');
    const messageEls = [];
    ownWithReactions.forEach(wrap => {
        const msgEl = wrap.closest('.message');
        if (msgEl && msgEl.dataset.messageId) messageEls.push(msgEl);
    });
    if (messageEls.length === 0) return;
    reactionsSeenObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            const messageId = parseInt(el.dataset.messageId, 10);
            if (!messageId || reactionsSeenMessageIds.has(messageId)) continue;
            reactionsSeenMessageIds.add(messageId);
            markReactionsSeenForMessage(convId, messageId);
        }
    }, { root: container, rootMargin: '50px', threshold: 0.1 });
    messageEls.forEach(el => reactionsSeenObserver.observe(el));
}

async function markReactionsSeenForMessage(conversationId, messageId) {
    if (!conversationId || !messageId) return;
    try {
        const data = await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify({ conversation_id: conversationId, message_id: messageId, action: 'mark_reactions_seen_for_message' })
        });
        const count = (data.data && data.data.unseen_reactions_count !== undefined) ? data.data.unseen_reactions_count : null;
        const conv = conversations.find(c => c.id == conversationId);
        if (conv && count !== null) {
            conv.unseen_reactions_count = count;
            renderConversations();
        }
    } catch (e) {
        console.warn('markReactionsSeenForMessage:', e);
    }
}

let unreadObserver = null;
/** Флаг: пользователь уже прокручивал ленту в этой сессии чата */
let hasUserScrolledInConversation = false;
/** При открытии чата восстанавливали скролл — тогда помечаем прочитанным только после прокрутки пользователем */
let hasRestoredScrollThisSession = false;
/** До этого времени (timestamp) события scroll считаются программными при открытии чата и не включают «пользователь прокрутил» */
let programmaticScrollUntil = 0;

/** Пометить прочитанными непрочитанные сообщения, которые уже в зоне видимости (при открытии чата с малым числом сообщений) */
function markVisibleUnreadAsRead(container) {
    if (!container || !currentConversationId) return;
    const unreadList = container.querySelectorAll('.message[data-read-by-me="0"]');
    if (unreadList.length === 0) return;
    const containerRect = container.getBoundingClientRect();
    let maxVisibleId = 0;
    unreadList.forEach(msgEl => {
        const el = msgEl.querySelector('.message-time-row') || msgEl;
        const rect = el.getBoundingClientRect();
        const visible = !(rect.bottom < containerRect.top || rect.top > containerRect.bottom);
        if (visible) {
            const id = parseInt(msgEl.dataset.messageId, 10);
            if (id && id > maxVisibleId) maxVisibleId = id;
        }
    });
    if (maxVisibleId === 0) return;
    const convId = currentConversationId;
    unreadList.forEach(msgEl => {
        const id = parseInt(msgEl.dataset.messageId, 10);
        if (id && id <= maxVisibleId) {
            msgEl.dataset.readByMe = '1';
            const target = msgEl.querySelector('.message-time-row') || msgEl;
            if (unreadObserver && target) unreadObserver.unobserve(target);
        }
    });
    markReadUpTo(convId, maxVisibleId);
}

/** Наблюдение за непрочитанными: когда блок времени отправки (.message-time-row) попадает в viewport — отмечаем прочитанным; отправитель видит ✓✓
 *  options.checkVisibleNow === false — при восстановлении скролла: помечаем только после прокрутки пользователем */
function setupUnreadObserver(container, options) {
    if (!container || !currentConversationId) return;
    if (unreadObserver) {
        unreadObserver.disconnect();
        unreadObserver = null;
    }
    const convId = currentConversationId;
    const restoredScroll = (options && options.checkVisibleNow === false);
    if (restoredScroll) hasRestoredScrollThisSession = true;
    const unreadMessages = container.querySelectorAll('.message[data-read-by-me="0"]');
    if (unreadMessages.length > 0) {
        const targetsToObserve = [];
        unreadMessages.forEach(msgEl => {
            const timeRow = msgEl.querySelector('.message-time-row');
            targetsToObserve.push(timeRow || msgEl);
        });
        unreadObserver = new IntersectionObserver((entries) => {
            if (hasRestoredScrollThisSession && !hasUserScrolledInConversation) return;
            let maxMessageId = 0;
            const toUnobserve = [];
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const msgEl = entry.target.closest ? entry.target.closest('.message') : entry.target;
                if (!msgEl || msgEl.dataset.readByMe !== '0') continue;
                const messageId = parseInt(msgEl.dataset.messageId, 10);
                if (!messageId) continue;
                if (messageId > maxMessageId) maxMessageId = messageId;
                msgEl.dataset.readByMe = '1';
                toUnobserve.push(entry.target);
            }
            toUnobserve.forEach(target => { if (unreadObserver) unreadObserver.unobserve(target); });
            if (maxMessageId > 0) markReadUpTo(convId, maxMessageId);
        }, { root: container, rootMargin: '0px', threshold: 0 });
        targetsToObserve.forEach(el => { if (el) unreadObserver.observe(el); });
    }
}

// Загрузка списка чатов (и контактов для объединённого списка)
async function loadConversations() {
    try {
        const data = await apiRequest(`${API_BASE}/api/conversations.php`);
        conversations = data.data.conversations || [];
        // Расшифровать превью последнего сообщения для E2EE-чатов (в чате сообщения расшифровываются, в списке — нет)
        const encryptedConvs = conversations.filter(c => c.last_message_encrypted === 1 || c.last_message_encrypted === '1');
        if (encryptedConvs.length > 0 && window.E2EE_KEYS && E2EE_KEYS.isSupported) {
            await Promise.all(encryptedConvs.map(async (conv) => {
                const msg = { content: conv.last_message || '', encrypted: 1 };
                const decrypted = await ensureMessagesDecryptedForConversation(conv.id, [msg]);
                conv.decrypted_last_message_preview = decrypted[0] && decrypted[0].content != null ? decrypted[0].content : null;
            }));
        }
        await loadContacts();
        renderConversations();
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

// Контакты, с которыми никогда не велась беседа (нет в списке conversations)
function getContactsWithoutConversation() {
    return contacts.filter(c => !conversations.some(conv =>
        conv.type === 'private' && conv.other_user && (conv.other_user.uuid === c.uuid)));
}

// Отображение объединённого списка бесед и контактов (контакты без переписки — отдельной плашкой)
function renderConversations() {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList) return;

    const contactsWithoutConv = getContactsWithoutConversation();
    const hasConversations = conversations.length > 0;
    const hasContactsOnly = contactsWithoutConv.length > 0;

    if (!hasConversations && !hasContactsOnly) {
        chatsList.innerHTML = '<div class="chats-empty-placeholder">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.no_chats ? window.__LANG__.chat.no_chats : 'No chats') + '</div>';
        return;
    }

    const contactsWithoutChatLabel = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.contacts_without_chat) || 'Контакты без переписки';

    let html = '';

    if (hasConversations) {
        html += conversations.map(conv => {
        const avatar = conv.avatar || conv.other_user?.avatar;
        const name = conv.name || conv.other_user?.display_name || conv.other_user?.username || chatLang('conversation_default', 'Беседа');
        const lastMessageType = conv.last_message_type || '';
        const lastMessageFilePath = conv.last_message_file_path || '';
        const isGifSticker = lastMessageType === 'sticker' && /\.gif(\?|$)/i.test(lastMessageFilePath);
        const isEncrypted = conv.last_message_encrypted === 1 || conv.last_message_encrypted === '1';
        const rawContent = (isEncrypted && conv.decrypted_last_message_preview != null) ? conv.decrypted_last_message_preview : conv.last_message;
        const lastMessage = isEncrypted && conv.decrypted_last_message_preview == null
            ? chatLang('encrypted_message', 'Зашифрованное сообщение')
            : lastMessageType === 'image'
                ? ('🖼️ ' + chatLang('image', 'Изображение'))
                : lastMessageType === 'sticker'
                    ? (isGifSticker ? '🖼️ GIF' : ('🖼️ ' + chatLang('sticker', 'Стикер')))
                    : lastMessageType === 'call'
                        ? (typeof localizeCallMessageContent === 'function' ? localizeCallMessageContent(rawContent || '') : (rawContent || chatLang('no_messages', 'No messages')))
                        : (rawContent || chatLang('no_messages', 'No messages'));
        const time = conv.last_message_time ? formatTime(conv.last_message_time) : '';
        const unreadCount = (conv.unread_count || 0);
        const unseenReactionsCount = (conv.unseen_reactions_count || 0);
        const unread = unreadCount > 0 ? `<div class="chat-item-unread">${unreadCount}</div>` : '';
        const unseenReactions = unseenReactionsCount > 0 ? `<div class="chat-item-unseen-reactions" title="${escapeHtml((window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.reaction) ? window.__LANG__.chat.reaction : 'Reactions')}">👍 ${unseenReactionsCount}</div>` : '';
        const isGroup = conv.type === 'group';
        const incomingCall = !!(conv.incoming_1_1_call && conv.incoming_1_1_call !== '0');
        const minimizedState = (window.Calls && typeof window.Calls.getIncomingCallMinimized === 'function') ? window.Calls.getIncomingCallMinimized() : null;
        const incomingMinimized = !!(incomingCall && minimizedState && (minimizedState.conversation_id === conv.id || parseInt(minimizedState.conversation_id, 10) === parseInt(conv.id, 10)));
        const incomingCallIcon = incomingMinimized && minimizedState && minimizedState.with_video ? '📹' : '📞';
        const incomingCallIconClass = incomingMinimized && minimizedState && minimizedState.with_video ? 'chat-item-incoming-call-icon-video' : 'chat-item-incoming-call-icon-audio';
        const avatarClass = isGroup ? 'chat-item-avatar chat-item-avatar-group' : 'chat-item-avatar';
        const avatarHtml = avatar
            ? `<img src="${escapeHtml(avatar)}" alt="">`
            : escapeHtml(name.charAt(0).toUpperCase());
        const activeClass = currentConversationId == conv.id ? 'active' : '';
        const incomingCallLabel = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.incoming_call) || 'Incoming call';
        const incomingCallBadge = incomingCall ? '<span class="chat-item-incoming-call ' + (incomingMinimized ? incomingCallIconClass : '') + '" title="' + escapeHtml(incomingCallLabel) + '" aria-label="' + escapeHtml(incomingCallLabel) + '">' + (incomingMinimized ? incomingCallIcon : '📞') + '</span>' : '';
        const lastMsgClass = lastMessageType === 'call' ? ' chat-item-last-message-is-call' : '';
        const rowMinimizedClass = incomingMinimized ? ' chat-item-row-incoming-call-minimized' : '';
        const searchable = [name, (conv.other_user && conv.other_user.username) || ''].filter(Boolean).join(' ');
        return `
            <div class="chat-item-row ${activeClass}${rowMinimizedClass}" data-conversation-id="${conv.id}" data-searchable="${escapeHtml(searchable)}">
                <div class="chat-item-action-delete" aria-hidden="true">
                    <span class="chat-item-action-icon">🗑</span>
                    <span class="chat-item-action-label">${(window.__LANG__ && window.__LANG__.common && window.__LANG__.common.delete) || 'Delete'}</span>
                </div>
                <div class="chat-item chat-item-swipe-content">
                    <div class="${avatarClass}">${avatarHtml}</div>
                    <div class="chat-item-info">
                        <div class="chat-item-name">${escapeHtml(name)}</div>
                        <div class="chat-item-last-message${lastMsgClass}">${parseTextStyles(lastMessage)}</div>
                    </div>
                    <div class="chat-item-meta">
                        ${incomingCallBadge}
                        ${time && !unreadCount && !unseenReactionsCount && !incomingCall ? `<div class="chat-item-time">${time}</div>` : ''}
                        ${(unseenReactions || unread) ? `<div class="chat-item-badges">${unseenReactions}${unread}</div>` : ''}
            </div>
        </div>
    </div>
        `;
        }).join('');
    }

    if (hasContactsOnly) {
        html += `<div class="chats-list-section contacts-without-chat" id="contactsWithoutChatSection">
            <div class="chats-list-section-header">${escapeHtml(contactsWithoutChatLabel)}</div>`;
        contactsWithoutConv.forEach(user => {
            const name = user.display_name || user.username || 'Пользователь';
            const avatarHtml = user.avatar
                ? `<img src="${escapeHtml(user.avatar)}" alt="">`
                : escapeHtml(name.charAt(0).toUpperCase());
            const status = getActivityStatus(user.last_seen ?? null);
            const searchable = [user.display_name || '', user.username || ''].filter(Boolean).join(' ') || name;
            html += `
            <div class="chat-item-row contact-only-row" data-user-uuid="${escapeHtml(user.uuid || '')}" data-searchable="${escapeHtml(searchable)}">
                <div class="chat-item chat-item-swipe-content">
                    <div class="chat-item-avatar">${avatarHtml}</div>
                    <div class="chat-item-info">
                        <div class="chat-item-name">${escapeHtml(name)}</div>
                        <div class="chat-item-last-message chat-item-contact-status">${escapeHtml(status)}</div>
                    </div>
                </div>
            </div>`;
        });
        html += '</div>';
    }

    chatsList.innerHTML = html;

    // Обработчики клика и контекстное меню — см. setupChatListDelegation()
}

/** Отрисовка списка чатов по результатам поиска по сообщениям: только беседы с совпадениями, сниппет вместо последнего сообщения */
function renderConversationsWithMessageSearch(results) {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList || !results || results.length === 0) {
        if (chatsList) {
            const emptyLabel = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.search_none) ? window.__LANG__.chat.search_none : 'Ничего не найдено';
            chatsList.innerHTML = '<div class="chats-empty-placeholder">' + escapeHtml(emptyLabel) + '</div>';
        }
        return;
    }
    const snippetByConv = new Map();
    for (const r of results) {
        const cid = parseInt(r.conversation_id, 10);
        if (!snippetByConv.has(cid)) snippetByConv.set(cid, r.content_preview || '');
    }
    const convIds = new Set(snippetByConv.keys());
    const convsToShow = conversations.filter(c => convIds.has(parseInt(c.id, 10)));
    if (convsToShow.length === 0) {
        const emptyLabel = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.search_none) ? window.__LANG__.chat.search_none : 'Ничего не найдено';
        chatsList.innerHTML = '<div class="chats-empty-placeholder">' + escapeHtml(emptyLabel) + '</div>';
        return;
    }
    const searchResultsLabel = chatLang('search_in_messages', 'По сообщениям');
    let html = '<div class="chats-list-section"><div class="chats-list-section-header">' + escapeHtml(searchResultsLabel) + '</div>';
    convsToShow.forEach(conv => {
        const avatar = conv.avatar || conv.other_user?.avatar;
        const name = conv.name || conv.other_user?.display_name || conv.other_user?.username || chatLang('conversation_default', 'Беседа');
        const lastMessage = snippetByConv.get(parseInt(conv.id, 10)) || '';
        const isGroup = conv.type === 'group';
        const avatarClass = isGroup ? 'chat-item-avatar chat-item-avatar-group' : 'chat-item-avatar';
        const avatarHtml = avatar
            ? `<img src="${escapeHtml(avatar)}" alt="">`
            : escapeHtml(name.charAt(0).toUpperCase());
        const activeClass = currentConversationId == conv.id ? 'active' : '';
        const searchable = [name, (conv.other_user && conv.other_user.username) || ''].filter(Boolean).join(' ');
        html += `
            <div class="chat-item-row ${activeClass}" data-conversation-id="${conv.id}" data-searchable="${escapeHtml(searchable)}">
                <div class="chat-item-action-delete" aria-hidden="true">
                    <span class="chat-item-action-icon">🗑</span>
                    <span class="chat-item-action-label">${(window.__LANG__ && window.__LANG__.common && window.__LANG__.common.delete) || 'Delete'}</span>
                </div>
                <div class="chat-item chat-item-swipe-content">
                    <div class="${avatarClass}">${avatarHtml}</div>
                    <div class="chat-item-info">
                        <div class="chat-item-name">${escapeHtml(name)}</div>
                        <div class="chat-item-last-message">${escapeHtml(lastMessage)}</div>
                    </div>
                </div>
            </div>`;
    });
    html += '</div>';
    chatsList.innerHTML = html;
}

// Делегирование кликов по списку чатов: ID беседы берём из строки, на которую кликнули
function setupChatListDelegation() {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList) return;
    chatsList.removeEventListener('click', chatsList._chatItemClickHandler);
    chatsList.removeEventListener('contextmenu', chatsList._chatItemContextHandler);
    function onListClick(e) {
        const row = e.target.closest('.chat-item-row');
        if (!row) return;
        const content = row.querySelector('.chat-item-swipe-content');
        if (!content || !content.contains(e.target)) return;
        if (row.dataset.swipeTriggered === '1') return;
        const userUuid = row.dataset.userUuid;
        if (userUuid) {
            createOrOpenPrivateChat(userUuid);
            return;
        }
        const conversationId = parseInt(row.dataset.conversationId, 10);
        if (!conversationId) return;
        openConversation(conversationId);
    }
    function onListContextMenu(e) {
        const row = e.target.closest('.chat-item-row');
        if (!row) return;
        if (row.dataset.userUuid) return; // контекстное меню только для бесед
        const content = row.querySelector('.chat-item-swipe-content');
        if (!content || !content.contains(e.target)) return;
        e.preventDefault();
        const conversationId = parseInt(row.dataset.conversationId, 10);
        if (conversationId) showConversationContextMenu(e, conversationId);
    }
    chatsList._chatItemClickHandler = onListClick;
    chatsList._chatItemContextHandler = onListContextMenu;
    chatsList.addEventListener('click', onListClick);
    chatsList.addEventListener('contextmenu', onListContextMenu);
    if (typeof window.initChatSwipe === 'function') window.initChatSwipe();
}

// Закрытие окна чата (на мобильном — возврат к списку чатов). Использует history.back(), по popstate вызывается showListView().
function closeMobileChat() {
    if (currentConversationId != null && window.history && window.history.length > 1) {
        history.back();
    } else {
        showListView();
    }
}

// Открытие беседы. options.skipHistory === true — не добавлять запись в history (при срабатывании «назад»).
async function openConversation(conversationId, options) {
    if (window.Calls && typeof window.Calls.getIncomingCallMinimized === 'function' && typeof window.Calls.restoreIncomingModal === 'function') {
        var min = window.Calls.getIncomingCallMinimized();
        if (min && (min.conversation_id === conversationId || parseInt(min.conversation_id, 10) === parseInt(conversationId, 10))) {
            window.Calls.restoreIncomingModal();
        }
    }
    if (currentConversationId != null) saveConversationScroll(currentConversationId);
    exitForwardSelectionMode();
    closeChatSearch();
    currentConversationId = conversationId;
    hasUserScrolledInConversation = false;
    hasRestoredScrollThisSession = false;
    programmaticScrollUntil = Date.now() + 350;
    lastMessageId = 0;
    clearReplyingTo();
    if (window.pushModule && typeof window.pushModule.notifyConversationFocus === 'function') {
        window.pushModule.notifyConversationFocus(conversationId, document.hasFocus());
    }
    if (window.websocketModule && typeof window.websocketModule.subscribe === 'function') {
        window.websocketModule.subscribe(conversationId);
    }
    
    // Обновление активного чата в списке
    document.querySelectorAll('.chat-item-row').forEach(row => {
        row.classList.toggle('active', parseInt(row.dataset.conversationId, 10) == conversationId);
    });
    
    // Показ окна чата
    document.getElementById('chatEmpty').classList.add('is-hidden');
    document.getElementById('chatWindow').classList.remove('is-hidden');
    
    // На мобильном — скрыть навбар и сайдбар (показать только окно чата)
    if (window.innerWidth <= 768) {
        document.body.classList.add('mobile-chat-open');
    }
    
    // Загрузка информации о беседе (c.id может быть строкой из API)
    const conversation = conversations.find(c => c.id == conversationId);
    if (conversation) {
        updateChatHeader(conversation);
        updateChatInputState(conversation);
    }
    
// Загрузка сообщений
    await loadMessages();

    const chatMessages = document.getElementById('chatMessages');
    const savedScroll = getSavedScrollPosition(conversationId);
    const restoreScroll = savedScroll !== null && savedScroll > 0;
    requestAnimationFrame(() => {
        if (!chatMessages) return;
        if (restoreScroll) {
            hasRestoredScrollThisSession = true;
            chatMessages.scrollTop = 0;
            requestAnimationFrame(() => {
                chatMessages.scrollTop = Math.min(savedScroll, Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight));
                updateScrollToBottomButtonVisibility();
            });
            setupUnreadObserver(chatMessages, { checkVisibleNow: false });
        } else {
            hasRestoredScrollThisSession = false;
            scrollToBottom();
            updateScrollToBottomButtonVisibility();
            setupUnreadObserver(chatMessages);
        }
    });

    if (window.history && window.history.pushState && (!options || !options.skipHistory)) {
        history.pushState({ conversationId: conversationId }, '', getChatUrl(conversationId));
    }

    trackEvent('conversation_open', { conversation_id: conversationId });
}

// Показать форму ввода или сообщение о удалённом собеседнике
function updateChatInputState(conversation) {
    const inputForm = document.getElementById('chatInputForm');
    const deletedMsg = document.getElementById('chatInputDeletedMessage');
    if (!inputForm || !deletedMsg) return;
    const isExternalCall = conversation.type === 'external';
    const canSend = !isExternalCall && ((conversation.participant_count || 0) >= 2);
    inputForm.classList.toggle('is-hidden', !canSend);
    deletedMsg.classList.toggle('is-hidden', canSend);
    if (deletedMsg && isExternalCall) {
        deletedMsg.textContent = chatLang('external_call_info', 'External call — audio/video only. Sending messages is not available.');
    }
}

// Обновление заголовка чата
function updateChatHeader(conversation) {
    const chatHeader = document.getElementById('chatHeader');
    if (!chatHeader) return;
    
    const ou = conversation.other_user;
    const name = conversation.name || ou?.display_name || ou?.username || chatLang('conversation_default', 'Беседа');
    const avatar = conversation.avatar || ou?.avatar;
    const isGroup = conversation.type === 'group' || conversation.type === 'external';
    const participantsCountStr = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.participants_count) ? String(window.__LANG__.chat.participants_count).replace('%d', conversation.participant_count) : (conversation.participant_count + ' participants');
    const status = isGroup
        ? (conversation.participant_count ? participantsCountStr : (conversation.type === 'external' ? chatLang('external_call', 'External call') : chatLang('group_type', 'Group')))
        : (ou?.status && ou.status.trim() ? ou.status.trim() : getActivityStatus(ou?.last_seen ?? null));
    const avatarHtml = avatar
        ? `<img src="${escapeHtml(avatar)}" alt="">`
        : `<span>${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
    const avatarHeaderClass = isGroup ? 'chat-header-avatar chat-header-avatar-group' : 'chat-header-avatar';
    const headerClickable = isGroup || (ou?.uuid);
    const avatarWrapperClass = avatarHeaderClass + (headerClickable ? ' chat-header-avatar-clickable' : '');
    const avatarDataAttrs = isGroup ? ' data-is-group="true"' : (ou?.uuid ? ` data-user-uuid="${escapeHtml(ou.uuid)}"` : '');
    const infoDataAttrs = isGroup ? ' data-is-group="true"' : (ou?.uuid ? ` data-user-uuid="${escapeHtml(ou.uuid)}"` : '');
    const infoClickableClass = headerClickable ? ' chat-header-info-clickable' : '';
    const headerInfoLabel = conversation.type === 'external' ? chatLang('conversation_info', 'Conversation info') : (isGroup ? chatLang('group_info', 'Group info') : chatLang('profile_peer', 'Contact profile'));
    const infoAriaAttrs = headerClickable ? ` role="button" tabindex="0" aria-label="${escapeHtml(headerInfoLabel)}" title="${escapeHtml(headerInfoLabel)}"` : '';
    const showCallButtons = !isGroup && ou && ou.uuid;
    const CallL = window.__LANG__ && window.__LANG__.call;
    const voiceLabel = (CallL && CallL.voice) || 'Voice call';
    const videoLabel = (CallL && CallL.video) || 'Video call';
    const groupVoiceLabel = (CallL && CallL.group_voice) || 'Group voice call';
    const groupVideoLabel = (CallL && CallL.group_video) || 'Group video call';
    const callButtons = showCallButtons
        ? `<button type="button" class="chat-header-call chat-header-call-voice" id="chatHeaderCallVoice" aria-label="${escapeHtml(voiceLabel)}" title="${escapeHtml(voiceLabel)}" data-conversation-id="${conversation.id}" data-callee-uuid="${escapeHtml(ou.uuid)}">📞</button><button type="button" class="chat-header-call chat-header-call-video" id="chatHeaderCallVideo" aria-label="${escapeHtml(videoLabel)}" title="${escapeHtml(videoLabel)}" data-conversation-id="${conversation.id}" data-callee-uuid="${escapeHtml(ou.uuid)}">📹</button>`
        : '';
    const showGroupCallButtons = conversation.type === 'group';
    const groupCallButtons = showGroupCallButtons
        ? `<button type="button" class="chat-header-call chat-header-call-voice" id="chatHeaderGroupCallVoice" aria-label="${escapeHtml(groupVoiceLabel)}" title="${escapeHtml(groupVoiceLabel)}" data-conversation-id="${conversation.id}">📞</button><button type="button" class="chat-header-call chat-header-call-video" id="chatHeaderGroupCallVideo" aria-label="${escapeHtml(groupVideoLabel)}" title="${escapeHtml(groupVideoLabel)}" data-conversation-id="${conversation.id}">📹</button>`
        : '';
    const backLabel = (window.__LANG__ && window.__LANG__.common && window.__LANG__.common.back) || 'Back';
    const settingsLabel = (window.__LANG__ && window.__LANG__.common && window.__LANG__.common.settings) || 'Settings';
    const searchLabel = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.search_in_chat) || 'Search in chat';
    chatHeader.innerHTML = `
        <button type="button" class="chat-header-back" id="chatHeaderBack" aria-label="${escapeHtml(backLabel)}" title="${escapeHtml(backLabel)}"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
        <div class="${avatarWrapperClass}"${avatarDataAttrs} role="button" tabindex="0" aria-label="${headerInfoLabel}" title="${headerInfoLabel}">${avatarHtml}</div>
        <div class="chat-header-info${infoClickableClass}"${infoDataAttrs}${infoAriaAttrs}>
            <div class="chat-header-name">${escapeHtml(name)}</div>
            <div class="chat-header-status">${status}</div>
        </div>
        <button type="button" class="chat-header-settings" id="chatHeaderSettings" aria-label="${escapeHtml(settingsLabel)}" title="${escapeHtml(settingsLabel)}"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
        <button type="button" class="chat-header-search-btn" id="chatHeaderSearchBtn" aria-label="${escapeHtml(searchLabel)}" title="${escapeHtml(searchLabel)}"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
        ${callButtons}
        ${groupCallButtons}
    `;
    if (callButtons) {
        chatHeader.querySelector('#chatHeaderCallVoice').addEventListener('click', function() {
            const cid = parseInt(this.dataset.conversationId, 10);
            const callee = this.dataset.calleeUuid;
            if (cid && callee && window.Calls && window.Calls.startCall) window.Calls.startCall(cid, callee, false);
        });
        chatHeader.querySelector('#chatHeaderCallVideo').addEventListener('click', function() {
            const cid = parseInt(this.dataset.conversationId, 10);
            const callee = this.dataset.calleeUuid;
            if (cid && callee && window.Calls && window.Calls.startCall) window.Calls.startCall(cid, callee, true);
        });
    }
    if (groupCallButtons) {
        chatHeader.querySelector('#chatHeaderGroupCallVoice').addEventListener('click', function() {
            const cid = parseInt(this.dataset.conversationId, 10);
            if (cid && window.Calls && window.Calls.startGroupCall) {
                window.Calls.startGroupCall(cid, false).catch(function(err) {
                    alert(err.message || (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.start_group_call_error) || 'Could not start group call');
                });
            }
        });
        chatHeader.querySelector('#chatHeaderGroupCallVideo').addEventListener('click', function() {
            const cid = parseInt(this.dataset.conversationId, 10);
            if (cid && window.Calls && window.Calls.startGroupCall) {
                window.Calls.startGroupCall(cid, true).catch(function(err) {
                    alert(err.message || (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.start_group_call_error) || 'Could not start group call');
                });
            }
        });
    }
    const chatHeaderSettings = chatHeader.querySelector('#chatHeaderSettings');
    if (chatHeaderSettings) {
        chatHeaderSettings.addEventListener('click', function() {
            if (typeof window.openProfileSettings === 'function') window.openProfileSettings();
        });
    }
    const plaque = document.getElementById('chatGroupCallPlaque');
    const plaqueText = plaque ? plaque.querySelector('.chat-group-call-plaque-text') : null;
    if (plaque) plaque.classList.add('is-hidden');
    if (isGroup) {
        if (plaqueText) plaqueText.textContent = chatLang('group_call_in_progress', 'Group call in progress');
        if (plaque) {
            delete plaque.dataset.plaqueMode;
            delete plaque.dataset.pendingCallId;
            delete plaque.dataset.callerUuid;
            delete plaque.dataset.withVideo;
        }
        const declineBtn = document.getElementById('chatGroupCallPlaqueDecline');
        if (declineBtn) declineBtn.classList.add('is-hidden');
        const joinBtn = document.getElementById('chatGroupCallPlaqueJoin');
        if (joinBtn) joinBtn.textContent = chatLang('join', 'Join');
        if (window.Calls && window.Calls.getGroupCallStatus) {
            window.Calls.getGroupCallStatus(conversation.id).then(function(status) {
                const plaqueEl = document.getElementById('chatGroupCallPlaque');
                if (plaqueEl && status && status.active && !(window.Calls && window.Calls.isInGroupCall && window.Calls.isInGroupCall())) plaqueEl.classList.remove('is-hidden');
            });
        }
    } else {
        var min = (window.Calls && typeof window.Calls.getIncomingCallMinimized === 'function') ? window.Calls.getIncomingCallMinimized() : null;
        var isMinimizedIncoming = min && (min.conversation_id == conversation.id || parseInt(min.conversation_id, 10) === parseInt(conversation.id, 10));
        if (isMinimizedIncoming && plaque) {
            if (plaqueText) plaqueText.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.incoming_call) || 'Incoming call';
            plaque.dataset.pendingCallId = String(min.call_id);
            plaque.dataset.plaqueMode = 'minimized';
            var declineBtn = document.getElementById('chatGroupCallPlaqueDecline');
            var joinBtn = document.getElementById('chatGroupCallPlaqueJoin');
            if (declineBtn) declineBtn.classList.remove('is-hidden');
            if (joinBtn) {
                joinBtn.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.accept) || 'Accept';
            }
            plaque.style.display = 'flex';
            plaque.classList.remove('is-hidden');
        } else if (window.Calls && window.Calls.getActiveCallStatus) {
            window.Calls.getActiveCallStatus(conversation.id).then(function(status) {
                if (!status || !status.active || !status.i_am_callee) return;
                if (window.Calls.isInCall && window.Calls.isInCall()) return;
                if (isMinimizedIncoming) return;
                const plaqueEl = document.getElementById('chatGroupCallPlaque');
                if (!plaqueEl) return;
                if (plaqueText) plaqueText.textContent = (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.incoming_call) || 'Incoming call';
                plaqueEl.dataset.pendingCallId = String(status.call_id);
                plaqueEl.dataset.plaqueMode = 'active';
                plaqueEl.dataset.callerUuid = status.caller_uuid || '';
                plaqueEl.dataset.withVideo = status.with_video ? '1' : '0';
                const declineBtn = document.getElementById('chatGroupCallPlaqueDecline');
                if (declineBtn) declineBtn.classList.remove('is-hidden');
                const joinBtn = document.getElementById('chatGroupCallPlaqueJoin');
                if (joinBtn) joinBtn.textContent = chatLang('connect', 'Connect');
                plaqueEl.style.display = 'flex';
                plaqueEl.classList.remove('is-hidden');
            });
        }
    }
}

function onGroupCallStarted(data) {
    if (!data || !data.conversation_id) return;
    if (currentConversationId === data.conversation_id) {
        const plaque = document.getElementById('chatGroupCallPlaque');
        if (plaque && !(window.Calls && window.Calls.isInGroupCall && window.Calls.isInGroupCall())) plaque.classList.remove('is-hidden');
    }
}

// Открытие модального окна «Участники группового звонка»
async function openCallParticipantsModal(groupCallId) {
    if (!groupCallId) return;
    const modal = document.getElementById('modalCallParticipants');
    const loadingEl = document.getElementById('callParticipantsLoading');
    const listEl = document.getElementById('callParticipantsList');
    const errorEl = document.getElementById('callParticipantsError');
    if (!modal || !loadingEl || !listEl || !errorEl) return;

    loadingEl.classList.remove('is-hidden');
    listEl.classList.add('is-hidden');
    errorEl.classList.add('is-hidden');
    errorEl.textContent = '';
    modal.classList.remove('is-hidden');

    try {
        const url = `${API_BASE}/api/calls.php?action=group_call_participants&group_call_id=${groupCallId}`;
        const data = await apiRequest(url);
        const participants = data.data?.participants || [];
        const guests = data.data?.guests || [];

        loadingEl.classList.add('is-hidden');
        listEl.classList.remove('is-hidden');

        const items = [];
        participants.forEach(function(p) {
            const displayName = p.display_name || (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.participant) || 'Participant';
            const leftAt = p.left_at ? ` (left ${typeof formatMessageTime === 'function' ? formatMessageTime(p.left_at) : p.left_at})` : '';
            const avatarUrl = p.avatar;
            const letter = displayName.trim().charAt(0).toUpperCase();
            const avatarBlock = avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="">` : `<span class="call-participant-avatar-placeholder">${escapeHtml(letter)}</span>`;
            items.push(`<div class="call-participant-item"><div class="call-participant-avatar">${avatarBlock}</div><span class="call-participant-name">${escapeHtml(displayName)}</span>${escapeHtml(leftAt)}</div>`);
        });
        guests.forEach(function(g) {
            const displayName = g.display_name || (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.guest) || 'Guest';
            const leftAt = g.left_at ? ` (left ${typeof formatMessageTime === 'function' ? formatMessageTime(g.left_at) : g.left_at})` : '';
            const letter = displayName.trim().charAt(0).toUpperCase();
            const avatarBlock = `<span class="call-participant-avatar-placeholder">${escapeHtml(letter)}</span>`;
            items.push(`<div class="call-participant-item call-participant-guest"><div class="call-participant-avatar">${avatarBlock}</div><span class="call-participant-name">${escapeHtml(displayName)}</span>${escapeHtml(leftAt)}</div>`);
        });
        listEl.innerHTML = items.length ? items.join('') : '<div class="call-participant-empty">' + (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.no_participants ? window.__LANG__.calls.no_participants : 'No participants') + '</div>';
    } catch (err) {
        console.error('Call participants load error:', err);
        loadingEl.classList.add('is-hidden');
        errorEl.textContent = err && err.message ? err.message : chatLang('load_participants_error', 'Не удалось загрузить список участников.');
        errorEl.classList.remove('is-hidden');
    }
}

// Открытие модального окна профиля пользователя (только просмотр, личная информация)
async function openUserProfileModal(userUuid) {
    if (!userUuid) return;
    const modal = document.getElementById('modalUserProfile');
    const loadingEl = document.getElementById('userProfileViewLoading');
    const contentEl = document.getElementById('userProfileViewContent');
    const errorEl = document.getElementById('userProfileViewError');
    const avatarEl = document.getElementById('userProfileViewAvatar');
    const displayNameEl = document.getElementById('userProfileViewDisplayName');
    const usernameEl = document.getElementById('userProfileViewUsername');
    const statusEl = document.getElementById('userProfileViewStatus');
    const lastSeenEl = document.getElementById('userProfileViewLastSeen');
    if (!modal || !loadingEl || !contentEl || !errorEl) return;

    loadingEl.classList.remove('is-hidden');
    contentEl.classList.add('is-hidden');
    errorEl.classList.add('is-hidden');
    errorEl.textContent = '';
    const e2eeElInit = document.getElementById('userProfileViewE2EE');
    if (e2eeElInit) e2eeElInit.classList.add('is-hidden');
    modal.classList.remove('is-hidden');

    try {
        const url = `${API_BASE}/api/users.php?uuid=${encodeURIComponent(userUuid)}`;
        const data = await apiRequest(url);
        const user = data.data?.user;
        if (!user) {
            errorEl.textContent = chatLang('load_profile_error', 'Не удалось загрузить профиль.');
            errorEl.style.display = 'block';
            return;
        }
        loadingEl.classList.add('is-hidden');
        contentEl.classList.remove('is-hidden');

        const displayName = user.display_name && user.display_name.trim() ? user.display_name.trim() : '—';
        const username = user.username || '—';
        const status = user.status && user.status.trim() ? user.status.trim() : '—';
        const lastSeen = typeof getActivityStatus === 'function' ? getActivityStatus(user.last_seen ?? null) : '—';

        if (avatarEl) {
            if (user.avatar) {
                avatarEl.innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="">`;
            } else {
                const letter = (displayName !== '—' ? displayName : username).toString().trim().charAt(0).toUpperCase() || '?';
                avatarEl.innerHTML = `<span class="user-profile-view-avatar-placeholder">${escapeHtml(letter)}</span>`;
            }
        }
        if (displayNameEl) displayNameEl.textContent = displayName;
        if (usernameEl) usernameEl.textContent = username;
        if (statusEl) statusEl.textContent = status;
        if (lastSeenEl) lastSeenEl.textContent = lastSeen;

        const notificationsWrap = document.getElementById('userProfileConversationNotifications');
        const notificationsToggle = document.getElementById('userProfileNotificationsToggle');
        const notificationsStatus = document.getElementById('userProfileNotificationsStatus');
        const conv = currentConversationId ? (conversations.find(c => c.id === currentConversationId)) : null;
        const isPrivateChatWithThisUser = conv && conv.type === 'private' && conv.other_user && conv.other_user.uuid === userUuid;
        const convWithUser = conversations.find(c => c.type === 'private' && c.other_user && c.other_user.uuid === userUuid);
        const e2eeEl = document.getElementById('userProfileViewE2EE');
        if (e2eeEl) e2eeEl.classList.toggle('is-hidden', !(isPrivateChatWithThisUser && window.E2EE_KEYS && E2EE_KEYS.isSupported));
        if (notificationsWrap) notificationsWrap.classList.toggle('is-hidden', !isPrivateChatWithThisUser);
        const currentUuid = document.body.dataset.userUuid || '';
        const actionsWrap = document.getElementById('userProfileConversationActions');
        const deleteConvBtn = document.getElementById('userProfileDeleteConversation');
        if (actionsWrap) actionsWrap.classList.toggle('is-hidden', !convWithUser || userUuid === currentUuid);
        if (convWithUser && userUuid !== currentUuid && deleteConvBtn) {
            deleteConvBtn.onclick = () => {
                if (typeof window.showDeleteChatConfirm === 'function') {
                    window.showDeleteChatConfirm(convWithUser.id, null);
                } else {
                    deleteConversation(convWithUser.id, false).then(() => { if (modal) modal.classList.add('is-hidden'); }).catch(() => {});
                }
            };
        }
        if (isPrivateChatWithThisUser && notificationsToggle && notificationsStatus) {
            let enabled = conv.notifications_enabled !== undefined ? !!conv.notifications_enabled : true;
            try {
                const convData = await apiRequest(`${API_BASE}/api/conversations.php?id=${currentConversationId}`);
                if (convData.data && convData.data.conversation && convData.data.conversation.notifications_enabled !== undefined) {
                    enabled = !!convData.data.conversation.notifications_enabled;
                }
            } catch (_) { /* оставляем значение по умолчанию */ }
            notificationsToggle.checked = enabled;
            notificationsStatus.textContent = (function() { var L = window.__LANG__ && window.__LANG__.notifications; return enabled ? (L && L.on) || 'On' : (L && L.off) || 'Off'; })();
            notificationsToggle.onchange = null;
            notificationsToggle.onchange = async function () {
                const enabled = notificationsToggle.checked;
                notificationsToggle.disabled = true;
                try {
                    await apiRequest(`${API_BASE}/api/conversations.php`, {
                        method: 'PATCH',
                        body: JSON.stringify({ conversation_id: currentConversationId, notifications_enabled: enabled })
                    });
                    if (notificationsStatus) { var L = window.__LANG__ && window.__LANG__.notifications; notificationsStatus.textContent = enabled ? (L && L.on) || 'On' : (L && L.off) || 'Off'; }
                    const idx = conversations.findIndex(c => c.id === currentConversationId);
                    if (idx >= 0) conversations[idx].notifications_enabled = enabled ? 1 : 0;
                } catch (e) {
                    console.error('Conversation notifications update error:', e);
                    notificationsToggle.checked = !enabled;
                }
                notificationsToggle.disabled = false;
            };
        }
    } catch (err) {
        console.error('User profile load error:', err);
        loadingEl.style.display = 'none';
        errorEl.textContent = err && err.message ? err.message : chatLang('load_error', 'Load error. Try again later.');
        errorEl.style.display = 'block';
    }
}

// Открытие модального окна «Информация о беседе» (группа или чат)
async function openGroupInfoModal() {
    if (!currentConversationId) return;
    const modal = document.getElementById('modalGroupInfo');
    const titleEl = document.getElementById('groupInfoModalTitle');
    const headerEl = document.getElementById('groupInfoHeader');
    const avatarEl = document.getElementById('groupInfoAvatar');
    const nameEl = document.getElementById('groupInfoName');
    const countEl = document.getElementById('groupInfoMemberCount');
    const listEl = document.getElementById('groupInfoMembersList');
    const membersSection = document.getElementById('groupInfoMembersSection');
    const notificationsToggle = document.getElementById('conversationNotificationsToggle');
    const notificationsStatus = document.getElementById('conversationNotificationsStatus');
    if (!modal || !nameEl || !listEl) return;

    listEl.innerHTML = '<div class="group-info-loading">' + (window.__LANG__ && window.__LANG__.common && window.__LANG__.common.loading || 'Loading…') + '</div>';
    if (countEl) countEl.textContent = '0';
    nameEl.textContent = '';
    avatarEl.innerHTML = '';
    if (titleEl) titleEl.textContent = chatLang('conversation_info', 'Информация о беседе');
    const groupE2eeElInit = document.getElementById('groupInfoE2EE');
    if (groupE2eeElInit) groupE2eeElInit.classList.add('is-hidden');
    if (notificationsToggle) notificationsToggle.checked = true;
    if (notificationsStatus) notificationsStatus.textContent = '';
    modal.classList.remove('is-hidden');

    try {
        const url = `${API_BASE}/api/conversations.php?id=${currentConversationId}`;
        const data = await apiRequest(url);
        const conv = data.data?.conversation;
        if (!conv) {
            listEl.innerHTML = '<div class="group-info-error">' + chatLang('load_error', 'Could not load data.') + '</div>';
            return;
        }

        const name = conv.name || (conv.type === 'group' ? chatLang('group', 'Group') : chatLang('chat', 'Chat'));
        nameEl.textContent = name;
        const avatarHtml = conv.avatar
            ? `<img src="${escapeHtml(conv.avatar)}" alt="">`
            : escapeHtml(name.charAt(0).toUpperCase());
        avatarEl.innerHTML = avatarHtml;

        if (titleEl) titleEl.textContent = conv.type === 'group' ? chatLang('group_info', 'Group info') : chatLang('chat_info', 'Chat info');
        const groupE2eeEl = document.getElementById('groupInfoE2EE');
        if (groupE2eeEl) groupE2eeEl.style.display = (conv.type === 'group' && window.E2EE_KEYS && E2EE_KEYS.isSupported) ? '' : 'none';
        if (notificationsToggle) notificationsToggle.checked = !!(conv.notifications_enabled !== undefined ? conv.notifications_enabled : 1);
        if (notificationsStatus) { var _L = window.__LANG__ && window.__LANG__.notifications; notificationsStatus.textContent = notificationsToggle.checked ? (_L && _L.on) || 'Включены' : (_L && _L.off) || 'Выключены'; }

        const addMembersBtn = document.getElementById('groupInfoAddMembersBtn');
        const isGroup = conv.type === 'group';
        const myRole = conv.my_role || 'member';
        const currentUserUuid = document.body.dataset.userUuid || '';
        if (addMembersBtn) {
            addMembersBtn.classList.toggle('is-hidden', !(isGroup && myRole === 'admin'));
        }
        window._lastGroupInfoConv = conv;

        if ((conv.type === 'group' || conv.type === 'external') && membersSection) {
            membersSection.classList.remove('is-hidden');
            const participants = conv.participants || [];
            if (countEl) countEl.textContent = String(participants.length);
            if (participants.length === 0) {
                listEl.innerHTML = '<div class="group-info-empty">' + (window.__LANG__ && window.__LANG__.calls && window.__LANG__.calls.no_participants ? window.__LANG__.calls.no_participants : 'No participants') + '</div>';
            } else {
                listEl.innerHTML = participants.map(p => {
                    const displayName = p.display_name || p.username || chatLang('user_default', 'Пользователь');
                    const avatarUrl = p.avatar;
                    const letter = displayName.trim().charAt(0).toUpperCase();
                    const avatarBlock = avatarUrl
                        ? `<img src="${escapeHtml(avatarUrl)}" alt="">`
                        : letter;
                    const roleLabel = p.role === 'admin' ? chatLang('role_admin', 'Administrator') : chatLang('role_participant', 'Participant');
                    const isSelf = p.uuid === currentUserUuid;
                    const canRemoveOther = isGroup && myRole === 'admin' && !isSelf;
                    const canLeave = isGroup && isSelf;
                    let actionBtn = '';
                    if (canLeave) {
                        actionBtn = '<button type="button" class="group-info-member-leave link-button" data-user-uuid="' + escapeHtml(p.uuid) + '">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.leave_group ? window.__LANG__.chat.leave_group : 'Leave group') + '</button>';
                    } else if (canRemoveOther) {
                        actionBtn = '<button type="button" class="group-info-member-remove link-button" data-user-uuid="' + escapeHtml(p.uuid) + '">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.remove_member ? window.__LANG__.chat.remove_member : 'Remove') + '</button>';
                    }
                    return `
                        <div class="group-info-member-item" data-user-uuid="${escapeHtml(p.uuid)}">
                            <div class="group-info-member-avatar">${avatarBlock}</div>
                            <span class="group-info-member-name">${escapeHtml(displayName)}</span>
                            <span class="group-info-member-role">${escapeHtml(roleLabel)}</span>
                            ${actionBtn ? '<span class="group-info-member-action">' + actionBtn + '</span>' : ''}
                        </div>
                    `;
                }).join('');
            }
        } else if (membersSection) {
            membersSection.classList.add('is-hidden');
        }

        if (notificationsToggle) {
            notificationsToggle.onchange = null;
            notificationsToggle.onchange = async function () {
                const enabled = notificationsToggle.checked;
                notificationsToggle.disabled = true;
                try {
                    await apiRequest(`${API_BASE}/api/conversations.php`, {
                        method: 'PATCH',
                        body: JSON.stringify({ conversation_id: currentConversationId, notifications_enabled: enabled })
                    });
                    if (notificationsStatus) { var _Ln2 = window.__LANG__ && window.__LANG__.notifications; notificationsStatus.textContent = enabled ? (_Ln2 && _Ln2.on) || 'Включены' : (_Ln2 && _Ln2.off) || 'Выключены'; }
                    const idx = conversations.findIndex(c => c.id === currentConversationId);
                    if (idx >= 0) conversations[idx].notifications_enabled = enabled ? 1 : 0;
                } catch (e) {
                    console.error('Conversation notifications update error:', e);
                    notificationsToggle.checked = !enabled;
                }
                notificationsToggle.disabled = false;
            };
        }
    } catch (err) {
        console.error('Conversation info load error:', err);
        listEl.innerHTML = '<div class="group-info-error">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.load_error ? window.__LANG__.chat.load_error : 'Load error. Try again later.') + '</div>';
    }
}

// Участники группы: из кэша или по API (для пересоздания ключа после ухода участника)
async function getGroupParticipantUuids(conversationId) {
    const conv = conversations.find(c => c.id == conversationId);
    if (conv && conv.participants && conv.participants.length) {
        return conv.participants.map(p => p.uuid || p.user_uuid);
    }
    try {
        const data = await apiRequest(`${API_BASE}/api/conversations.php?id=${conversationId}`);
        const participants = data.data?.conversation?.participants;
        if (participants && participants.length) {
            return participants.map(p => p.uuid || p.user_uuid);
        }
    } catch (e) {
        console.warn('getGroupParticipantUuids', e);
    }
    return [];
}

// Загрузка сообщений
/** Расшифровка сообщений с encrypted === 1 (личный или групповой чат E2EE). Возвращает тот же массив с подставленным content. */
async function ensureMessagesDecryptedForConversation(conversationId, messages) {
    if (!messages.length || !window.E2EE_KEYS || !E2EE_KEYS.isSupported) return messages;
    const conv = conversations.find(c => c.id == conversationId);
    if (!conv) return messages;
    let key = null;
    if (conv.type === 'private' && conv.other_user && conv.other_user.uuid) {
        key = await E2EE_KEYS.getOrCreateConversationKey(conversationId, conv.other_user.uuid);
    } else if (conv.type === 'group') {
        key = await E2EE_KEYS.getOrCreateGroupConversationKey(conversationId);
        if (!key) {
            const uuids = await getGroupParticipantUuids(conversationId);
            key = await E2EE_KEYS.ensureGroupKeyCreatedAndDistributed(conversationId, uuids);
        }
    }
    if (!key) {
        for (const m of messages) {
            if (m.encrypted === 1 || m.encrypted === '1') m.content = (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.encrypted_placeholder) ? window.__LANG__.chat.encrypted_placeholder : '[Message encrypted, key unavailable]';
        }
        return messages;
    }
    const decryptionKeys = conv.type === 'private' && E2EE_KEYS.getConversationDecryptionKeys ? E2EE_KEYS.getConversationDecryptionKeys(conversationId) : null;
    const unreadablePlaceholder = (typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.encrypted_placeholder) ? window.__LANG__.chat.encrypted_placeholder : '[Message encrypted, key unavailable]';
    for (const m of messages) {
        if (m.encrypted === 1 || m.encrypted === '1') {
            const dec = decryptionKeys && decryptionKeys.length > 0
                ? await E2EE_KEYS.decryptCiphertextWithKeys(m.content, decryptionKeys)
                : await E2EE_KEYS.decryptCiphertext(m.content, key);
            m.content = dec !== null ? dec : unreadablePlaceholder;
            if (dec !== null) {
                if (!decryptedMessageContentCache[conversationId]) decryptedMessageContentCache[conversationId] = {};
                decryptedMessageContentCache[conversationId][m.id] = m.content;
            }
        }
    }
    if (!decryptedReplyPreviews[conversationId]) decryptedReplyPreviews[conversationId] = {};
    for (const m of messages) {
        decryptedReplyPreviews[conversationId][m.id] = getMessageContentPreview(m);
    }
    return messages;
}

async function loadMessages() {
    if (!currentConversationId) return;
    
    const isInitial = lastMessageId === 0;
    if (isInitial) {
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) chatMessages.innerHTML = '';
    }
    
    try {
        const url = `${API_BASE}/api/messages.php?conversation_id=${currentConversationId}&last_message_id=${lastMessageId}&limit=50`;
        const data = await apiRequest(url);
        let messages = data.data.messages || [];
        messages = await ensureMessagesDecryptedForConversation(currentConversationId, messages);
        
        if (messages.length > 0) {
            renderMessages(messages, isInitial);
            lastMessageId = Math.max(...messages.map(m => m.id));
            const currentUserUuid = document.body.dataset.userUuid || '';
            const otherMessageIds = messages.filter(m => m.user_uuid !== currentUserUuid).map(m => m.id);
            if (otherMessageIds.length > 0) {
                // immediate=true при открытии чата: доставка до mark_read, чтобы автор увидел ✓ перед ✓✓
                await markDelivered(currentConversationId, otherMessageIds, isInitial);
            }
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        if (error && (error.status === 403 || (error.message && String(error.message).includes('403')))) {
            showListView();
            loadConversations();
            if (window.history && window.history.replaceState) {
                history.replaceState({ view: 'list' }, '', getListUrl());
            }
        }
    }
    const container = document.getElementById('chatMessages');
    if (container && currentConversationId) setupReactionsSeenObserver(container);
}

// Ключ даты для сравнения (YYYY-MM-DD)
function getDateKey(createdAt) {
    if (!createdAt) return '';
    const d = new Date(createdAt);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Последний элемент-сообщение в контейнере (игнорируя разделители дат)
function getLastMessageElement(container) {
    const messages = container.querySelectorAll('.message');
    return messages.length ? messages[messages.length - 1] : null;
}

// Последняя группа сообщений в контейнере (если последнее сообщение внутри группы)
function getLastMessageGroupElement(container) {
    const lastMsg = getLastMessageElement(container);
    return lastMsg ? lastMsg.closest('.message-group') : null;
}

// Разбивает список сообщений на блоки: дата, одиночное сообщение или группа (цепочка одного автора без перехода через 00:00)
function buildMessageBlocks(messages, isPrivateChat) {
    const blocks = [];
    let prevDateKey = '';
    let group = [];

    function flushGroup() {
        if (group.length === 1) {
            blocks.push({ type: 'single', message: group[0] });
        } else if (group.length > 1) {
            blocks.push({ type: 'group', messages: group.slice() });
        }
        group = [];
    }

    for (const message of messages) {
        const dateKey = getDateKey(message.created_at);
        if (dateKey && dateKey !== prevDateKey) {
            flushGroup();
            blocks.push({ type: 'date', createdAt: message.created_at });
            prevDateKey = dateKey;
        }
        const isOwn = message.user_uuid === (document.body.dataset.userUuid || '');
        const canGroup = !isPrivateChat && !isOwn;
        if (canGroup) {
            if (group.length > 0 && group[0].user_uuid !== message.user_uuid) {
                flushGroup();
            }
            group.push(message);
        } else {
            flushGroup();
            blocks.push({ type: 'single', message });
        }
    }
    flushGroup();
    return blocks;
}

// Создание элемента-разделителя даты (прозрачный фон, стилизуется через CSS)
function createDateSeparatorElement(createdAt) {
    const el = document.createElement('div');
    el.className = 'chat-date-separator';
    el.setAttribute('role', 'separator');
    el.textContent = typeof formatMessageDateFull === 'function' ? formatMessageDateFull(createdAt) : '';
    return el;
}

// Вставляет разделитель даты перед новым сообщением, если дата сменилась
function insertDateSeparatorIfNeeded(container, messageCreatedAt) {
    const lastMsg = getLastMessageElement(container);
    if (!lastMsg) return;
    const lastKey = getDateKey(lastMsg.dataset.createdAt);
    const newKey = getDateKey(messageCreatedAt);
    if (lastKey && newKey && lastKey !== newKey) {
        container.appendChild(createDateSeparatorElement(messageCreatedAt));
    }
}

// Отображение сообщений (options.skipScroll — не вызывать scrollToBottom, например при polling)
function renderMessages(messages, isInitial = false, options = {}) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const conversation = conversations.find(c => c.id == currentConversationId);
    const isPrivateChat = conversation && conversation.type === 'private';
    const currentUserUuid = document.body.dataset.userUuid || '';

    if (!isInitial) {
        // Добавление новых сообщений: по возможности вливаем в последнюю группу, иначе — блоки с учётом даты
        const lastGroup = getLastMessageGroupElement(chatMessages);
        const lastMsg = getLastMessageElement(chatMessages);
        let lastDateKey = lastMsg ? (getDateKey(lastMsg.dataset.createdAt) || '') : '';
        let i = 0;
        while (i < messages.length) {
            const msg = messages[i];
            const msgDateKey = getDateKey(msg.created_at) || '';
            const canMerge = lastGroup && lastMsg && lastMsg.dataset.userUuid === msg.user_uuid &&
                lastDateKey === msgDateKey && msg.user_uuid !== currentUserUuid;
            if (canMerge) {
                const bubblesWrap = lastGroup.querySelector('.message-group-bubbles');
                if (bubblesWrap) {
                    const el = createMessageElement(msg, currentUserUuid, null, { inGroup: true, isFirstInGroup: false });
                    bubblesWrap.appendChild(el);
                    if (msg.type === 'sticker') triggerStickerShakeForMessage(msg.id);
                    lastGroup.dataset.lastUserUuid = msg.user_uuid || '';
                    lastGroup.dataset.lastDateKey = msgDateKey;
                    lastDateKey = msgDateKey;
                    i++;
                    continue;
                }
            }
            break;
        }
        if (i < messages.length) {
            const remaining = messages.slice(i);
            const blocks = buildMessageBlocks(remaining, isPrivateChat);
            let lastMsgEl = getLastMessageElement(chatMessages);
            blocks.forEach(block => {
                if (block.type === 'date') {
                    chatMessages.appendChild(createDateSeparatorElement(block.createdAt));
                } else if (block.type === 'single') {
                    insertDateSeparatorIfNeeded(chatMessages, block.message.created_at);
                    chatMessages.appendChild(createMessageElement(block.message, currentUserUuid, lastMsgEl ? { user_uuid: lastMsgEl.dataset.userUuid } : null));
                    if (block.message.type === 'sticker') triggerStickerShakeForMessage(block.message.id);
                    lastMsgEl = getLastMessageElement(chatMessages);
                } else if (block.type === 'group') {
                    insertDateSeparatorIfNeeded(chatMessages, block.messages[0].created_at);
                    chatMessages.appendChild(createMessageGroupElement(block.messages, currentUserUuid));
                    block.messages.forEach(m => { if (m.type === 'sticker') triggerStickerShakeForMessage(m.id); });
                    lastMsgEl = getLastMessageElement(chatMessages);
                }
            });
        }
    } else {
        // Первоначальная загрузка: блоки (дата / одиночное / группа), группа не переходит через 00:00
        chatMessages.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const blocks = buildMessageBlocks(messages, isPrivateChat);
        let lastMsg = null;
        blocks.forEach(block => {
            if (block.type === 'date') {
                fragment.appendChild(createDateSeparatorElement(block.createdAt));
            } else if (block.type === 'single') {
                fragment.appendChild(createMessageElement(block.message, currentUserUuid, lastMsg ? { user_uuid: lastMsg.user_uuid } : null));
                lastMsg = block.message;
            } else if (block.type === 'group') {
                fragment.appendChild(createMessageGroupElement(block.messages, currentUserUuid));
                lastMsg = block.messages[block.messages.length - 1];
            }
        });
        chatMessages.appendChild(fragment);
    }

    if (!options.skipScroll) requestAnimationFrame(() => scrollToBottom());
    if (chatMessages && currentConversationId) setupUnreadObserver(chatMessages);
}

// Формирование tooltip и иконки статуса сообщения (для своих сообщений)
function buildMessageStatusHtml(message) {
    const deliveryCount = (message.delivery_count ?? 0) | 0;
    const readCount = (message.read_count ?? 0) | 0;
    const readDetails = message.read_details || [];
    const recipientCount = Math.max(1, (message.recipient_count ?? 1) | 0);
    let icon = '*';
    let statusClass = 'message-status-sent';
    let title = chatLang('sent', 'Отправлено');
    if (readCount > 0) {
        icon = '✓✓';
        statusClass = 'message-status-read';
        const detailLines = readDetails.map(r => `${r.username} — ${typeof formatMessageTime === 'function' ? formatMessageTime(r.read_at) : r.read_at}`).join('\n');
        title = `${readCount} из ${recipientCount} прочитали${detailLines ? '\n' + detailLines : ''}`;
    } else if (deliveryCount > 0) {
        icon = '✓';
        statusClass = 'message-status-delivered';
        title = chatLang('delivered', 'Доставлено');
    }
    return `<span class="message-status ${statusClass}" data-status="${statusClass.replace('message-status-', '')}" title="${escapeHtml(title)}">${escapeHtml(icon)}</span>`;
}

function updateMessageStatus(statusEl, data) {
    if (!statusEl) return;
    const deliveryCount = (data.delivery_count ?? 0) | 0;
    const readCount = (data.read_count ?? 0) | 0;
    const readDetails = data.read_details || [];
    const recipientCount = Math.max(1, (data.recipient_count ?? 1) | 0);
    let icon = '*';
    let statusClass = 'message-status-sent';
    let title = chatLang('sent', 'Отправлено');
    if (readCount > 0) {
        icon = '✓✓';
        statusClass = 'message-status-read';
        const detailLines = readDetails.map(r => `${r.username} — ${typeof formatMessageTime === 'function' ? formatMessageTime(r.read_at) : r.read_at}`).join('\n');
        title = `${readCount} из ${recipientCount} прочитали${detailLines ? '\n' + detailLines : ''}`;
    } else if (deliveryCount > 0) {
        icon = '✓';
        statusClass = 'message-status-delivered';
        title = chatLang('delivered', 'Доставлено');
    }
    statusEl.textContent = icon;
    statusEl.className = 'message-status ' + statusClass;
    statusEl.dataset.status = statusClass.replace('message-status-', '');
    statusEl.title = title;
}

/** Обновить в DOM статус прочтения (✓→✓✓) для своих сообщений с id <= upToMessageId после mark_read_up_to */
function updateMessagesReadStatusInDom(container, upToMessageId) {
    if (!container || !upToMessageId) return;
    const ownMessages = container.querySelectorAll('.message.own');
    ownMessages.forEach(msgEl => {
        const id = parseInt(msgEl.dataset.messageId, 10);
        if (!id || id > upToMessageId) return;
        const statusEl = msgEl.querySelector('.message-status');
        if (statusEl && statusEl.dataset.status !== 'read') {
            updateMessageStatus(statusEl, { read_count: 1, read_details: [], recipient_count: 1 });
        }
    });
}

// Создание элемента сообщения (prevMessage — для одиночных сообщений; options.inGroup — внутри группы, без своей аватарки)
function createMessageElement(message, currentUserUuid, prevMessage = null, options = {}) {
    const { inGroup = false, isFirstInGroup = false } = options;
    const isOwn = message.user_uuid === currentUserUuid;
    const conversation = conversations.find(c => c.id == currentConversationId);
    const isPrivateChat = conversation && conversation.type === 'private';
    const messageInGroup = !isPrivateChat && !isOwn;
    const showAvatarHere = messageInGroup && !inGroup && (!prevMessage || prevMessage.user_uuid !== message.user_uuid);
    let showUsername = !isOwn && !isPrivateChat && (inGroup ? isFirstInGroup : true);
    if (message.type === 'call') showUsername = false;
    // Отображаем все типы реакций на сообщении (ограничения по количеству нет)
    const reactionsHtml = message.reactions && message.reactions.length > 0
        ? `<div class="message-reactions">${message.reactions.map(r => buildOneReactionHtml(r)).join('')}</div>`
        : '';
    
    function isVideoPath(p, n) {
        const s = (p || '') + (n || '');
        return /\.(mp4|webm|mov)(\?|$)/i.test(s);
    }
    function stickerUrl(fp) {
        if (!fp || fp.indexOf('emoji:') === 0) return fp;
        if (fp.indexOf('sticker_file.php') !== -1) return fp;
        const base = (window.API_BASE || '').replace(/\/$/, '');
        const m = fp.match(/uploads\/stickers\/[^\s?"']+/);
        if (m) {
            return base + '/api/sticker_file.php?path=' + encodeURIComponent(m[0]);
        }
        return fp.startsWith('http') || fp.startsWith('/') ? fp : base + '/' + fp.replace(/^\/+/, '');
    }
    let contentHtml = '';
    if (message.type === 'sticker') {
        if (message.file_path && message.file_path.indexOf('emoji:') === 0) {
            const emoji = message.file_path.substring(6);
            contentHtml = `<span class="message-sticker-emoji">${emoji}</span>`;
        } else if (message.file_path) {
            const path = stickerUrl(message.file_path);
            const isGifSticker = /\.gif(\?|$)/i.test((message.file_path || '') + (message.file_name || ''));
            if (isVideoPath(message.file_path, message.file_name)) {
                contentHtml = `<video src="${escapeHtml(path)}" class="message-sticker-img message-media-video" controls loop muted playsinline></video>`;
            } else {
                const gifClass = isGifSticker ? ' message-sticker-gif' : '';
                contentHtml = `<img src="${escapeHtml(path)}" alt="Стикер" class="message-sticker-img${gifClass}" onerror="this.classList.add('is-error')">`;
            }
        } else {
            contentHtml = `<span class="message-sticker-emoji">${escapeHtml(message.content || '')}</span>`;
        }
    } else if (message.type === 'image' && message.file_path) {
        contentHtml = `<img src="${escapeHtml(message.file_path)}" alt="Изображение" class="message-image" onerror="this.classList.add('is-error')">`;
    } else if (message.type === 'file' && (message.file_name || message.file_path)) {
        const fp = message.file_path || '';
        if (isVideoPath(fp, message.file_name)) {
            const path = fp.startsWith('http') || fp.startsWith('/') ? fp : (window.API_BASE || '') + '/' + fp.replace(/^\/+/, '');
            contentHtml = `<video src="${escapeHtml(path)}" class="message-media-video" controls loop muted playsinline></video>`;
        } else {
            contentHtml = `<a href="${escapeHtml(fp)}" target="_blank">📎 ${escapeHtml(message.file_name || 'Файл')}</a>`;
        }
    } else if (message.type === 'call') {
        const content = (message.content || '').trim();
        const groupCallId = message.group_call_id;
        const displayText = typeof localizeCallMessageContent === 'function' ? localizeCallMessageContent(content) : content;
        const isVideo = /^(Видеозвонок|Групповой видеозвонок)/i.test(content);
        const L = (typeof window !== 'undefined' && window.__LANG__ && window.__LANG__.call) || {};
        const escaped = escapeHtml(displayText).replace(/\n/g, '<br>');
        const participantsLabel = L.participants || 'Participants';
        contentHtml = `<span class="message-call-content" data-call-type="${isVideo ? 'video' : 'voice'}">${escaped}</span>`;
        if (groupCallId) {
            contentHtml += ` <button type="button" class="message-call-participants-link" data-group-call-id="${escapeHtml(String(groupCallId))}">${escapeHtml(participantsLabel)}</button>`;
        }
    } else {
        const textContent = (message.content || '').trim();
        contentHtml = linkifyHtml(parseTextStyles(textContent)).replace(/\n/g, '<br>');
        const firstUrl = extractFirstUrl(textContent);
        if (firstUrl) {
            contentHtml += `<div class="message-link-preview message-link-preview-loading" data-preview-url="${escapeHtml(firstUrl)}"><span class="message-link-preview-spinner">…</span></div>`;
        }
    }
    
    const replyTo = message.reply_to;
    let replyPreview = '';
    if (replyTo) {
        if (currentConversationId && decryptedReplyPreviews[currentConversationId] && decryptedReplyPreviews[currentConversationId][replyTo.id] !== undefined) {
            replyPreview = decryptedReplyPreviews[currentConversationId][replyTo.id];
        } else {
            replyPreview = replyTo.content_preview || '';
        }
    }
    const replyBlockHtml = replyTo
        ? `<div class="message-reply" data-reply-to-id="${replyTo.id}" role="button" tabindex="0" title="${escapeHtml(chatLang('go_to_message', 'Перейти к сообщению'))}">
            <span class="message-reply-username">${escapeHtml(replyTo.username)}</span>
            <span class="message-reply-preview">${escapeHtml(replyPreview)}</span>
           </div>`
        : '';
    const forwardedFrom = message.forwarded_from;
    const forwardedBlockHtml = forwardedFrom
        ? `<div class="message-forwarded" title="${escapeHtml(chatLang('forwarded', 'Переслано'))}">
            <span class="message-forwarded-label">${escapeHtml(String(chatLang('forwarded_from', 'Переслано от %s')).replace('%s', forwardedFrom.username || chatLang('user_default', 'неизвестный')))}</span>
           </div>`
        : '';
    
    // В групповых чатах для чужих сообщений — аватарка (только у первого в цепочке); при inGroup аватарка у группы, здесь пусто
    let avatarCellHtml = '';
    if (messageInGroup && !inGroup) {
        avatarCellHtml = '<div class="message-avatar-cell">';
        if (showAvatarHere && message.user_uuid) {
            const avatarUrl = message.avatar;
            const firstLetter = (message.username || '').trim().substring(0, 1);
            const avatarDataUuid = ` data-user-uuid="${escapeHtml(message.user_uuid)}"`;
            if (avatarUrl) {
                avatarCellHtml += `<div class="message-avatar message-avatar-clickable"${avatarDataUuid} role="button" tabindex="0" title="${escapeHtml(chatLang('profile', 'Профиль'))}"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(message.username || '')}" title="${escapeHtml(message.username || '')}"></div>`;
            } else {
                avatarCellHtml += `<div class="message-avatar message-avatar-placeholder message-avatar-clickable"${avatarDataUuid} role="button" tabindex="0" title="${escapeHtml(chatLang('profile', 'Профиль'))}">${escapeHtml(firstLetter)}</div>`;
            }
        }
        avatarCellHtml += '</div>';
    }

    const isCall = message.type === 'call';
    const callVideo = isCall && /^(Видеозвонок|Групповой видеозвонок)/i.test((message.content || '').trim());
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}${messageInGroup && !inGroup ? ' message-in-group' : ''}${inGroup ? ' message-in-group-item' : ''}${isCall ? ' message-call' + (callVideo ? ' message-call-video' : ' message-call-voice') : ''}`;
    div.dataset.messageId = message.id;
    div.dataset.userUuid = message.user_uuid || '';
    div.dataset.username = message.username || '';
    div.dataset.contentPreview = getMessageContentPreview(message);
    div.dataset.messageType = message.type || 'text';
    div.dataset.readByMe = (message.read_by_me !== false && message.read_by_me !== '0') ? '1' : '0';
    if ((message.type === 'image' || message.type === 'file') && message.file_path) {
        div.dataset.filePath = message.file_path;
    }
    if (message.created_at) div.dataset.createdAt = message.created_at;
    div.innerHTML = `
        ${avatarCellHtml}
        <div class="message-bubble">
            <button type="button" class="message-actions-btn" aria-label="${escapeHtml(chatLang('message_actions', 'Действия с сообщением'))}" title="${escapeHtml(chatLang('actions', 'Действия'))}">⋮</button>
            ${            showUsername ? `<div class="message-header">
                ${message.user_uuid ? `<button type="button" class="message-username message-username-link" data-user-uuid="${escapeHtml(message.user_uuid)}" title="${escapeHtml(chatLang('open_profile', 'Открыть профиль'))}">${escapeHtml(message.username)}</button>` : `<span class="message-username">${escapeHtml(message.username)}</span>`}
            </div>` : ''}
            ${forwardedBlockHtml}
            ${replyBlockHtml}
            <div class="message-content">${contentHtml}</div>
            ${reactionsHtml}
            <div class="message-time-row">
                <span class="message-time">${formatMessageTime(message.created_at)}</span>
                ${isOwn ? buildMessageStatusHtml(message) : ''}
            </div>
        </div>
    `;
    
    /* Чекбокс выбора для пересылки — только для сообщений, которые можно переслать (не call) */
    if (!isCall) {
        const forwardCb = document.createElement('input');
        forwardCb.type = 'checkbox';
        forwardCb.className = 'message-forward-checkbox';
        forwardCb.dataset.messageId = String(message.id);
        forwardCb.setAttribute('aria-label', 'Выбрать для пересылки');
        div.appendChild(forwardCb);
    }

    const bubble = div.querySelector('.message-bubble');
    if (bubble) {
        /* Повтор анимации по клику только у эмодзи-стикеров, не у GIF/картинок */
        const isEmojiSticker = message.type === 'sticker' && (!message.file_path || message.file_path.indexOf('emoji:') === 0);
        if (isEmojiSticker) {
            const contentEl = bubble.querySelector('.message-content');
            if (contentEl) {
                contentEl.style.cursor = 'pointer';
                contentEl.title = 'Нажмите, чтобы повторить анимацию';
                contentEl.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    triggerStickerShakeForMessage(message.id);
                });
            }
        }
        bubble.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showReactionPicker(e, message.id, message);
        });
        const actionsBtn = bubble.querySelector('.message-actions-btn');
        if (actionsBtn) {
            actionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showReactionPicker(e, message.id, message);
            });
        }
        const replyEl = bubble.querySelector('.message-reply');
        if (replyEl) {
            replyEl.addEventListener('click', (e) => {
                e.stopPropagation();
                scrollToMessage(replyTo.id);
            });
            replyEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    scrollToMessage(replyTo.id);
                }
            });
        }
    }
    div.querySelectorAll('.message-reaction').forEach(el => {
        el.addEventListener('click', () => toggleReaction(message.id, el.dataset.emoji, null));
    });

    if (useTwemoji()) twemoji.parse(div, { folder: 'svg', ext: '.svg', className: 'twemoji' });

    if (message.type === 'text' || !message.type) {
        loadLinkPreviewsForElement(div);
    }
    
    return div;
}

// Группа сообщений одного автора (одна sticky-аватарка на всю цепочку, без перехода через 00:00)
function createMessageGroupElement(messages, currentUserUuid) {
    if (!messages.length) return null;
    const first = messages[0];
    const last = messages[messages.length - 1];
    const isGroupCallsOnly = messages.every(m => m.type === 'call');

    const wrap = document.createElement('div');
    wrap.className = 'message-group' + (isGroupCallsOnly ? ' message-group-calls' : '');
    wrap.dataset.lastUserUuid = last.user_uuid || '';
    wrap.dataset.lastDateKey = getDateKey(last.created_at) || '';

    if (!isGroupCallsOnly) {
        const avatarUrl = first.avatar;
        const firstLetter = (first.username || '').trim().substring(0, 1);
        const firstUuid = first.user_uuid || '';
        const avatarDataUuid = firstUuid ? ` data-user-uuid="${escapeHtml(firstUuid)}"` : '';
        const avatarHtml = avatarUrl
            ? `<div class="message-avatar message-avatar-clickable"${avatarDataUuid} role="button" tabindex="0" title="${escapeHtml(chatLang('profile', 'Профиль'))}"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(first.username || '')}" title="${escapeHtml(first.username || '')}"></div>`
            : `<div class="message-avatar message-avatar-placeholder message-avatar-clickable"${avatarDataUuid} role="button" tabindex="0" title="${escapeHtml(chatLang('profile', 'Профиль'))}">${escapeHtml(firstLetter)}</div>`;
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-group-avatar';
        avatarDiv.innerHTML = avatarHtml;
        wrap.appendChild(avatarDiv);
    }

    const bubblesWrap = document.createElement('div');
    bubblesWrap.className = 'message-group-bubbles';
    messages.forEach((msg, i) => {
        bubblesWrap.appendChild(createMessageElement(msg, currentUserUuid, null, { inGroup: true, isFirstInGroup: i === 0 }));
    });
    wrap.appendChild(bubblesWrap);

    return wrap;
}

// Отправка сообщения
async function sendMessage() {
    const messageInput = getActiveMessageInputElement();
    if (!messageInput || !currentConversationId) return;

    const content = getMessageInputMarkdown().trim();
    if (!content) return;

    const emojiParts = splitEmojiStringToArray(content);
    const isSingleEmoji = emojiParts.length === 1 && emojiParts[0].length <= 10;
    if (isSingleEmoji) {
        const emoji = emojiParts[0];
        try {
            const body = {
                conversation_id: currentConversationId,
                type: 'sticker',
                content: emoji,
                file_path: 'emoji:' + emoji,
                file_name: null,
                file_size: null
            };
            if (replyingToMessage && replyingToMessage.id) body.reply_to_id = replyingToMessage.id;
            const data = await apiRequest(`${API_BASE}/api/messages.php`, { method: 'POST', body: JSON.stringify(body) });
            setMessageInputContent('');
            if (messageInput.style) messageInput.style.height = 'auto';
            clearReplyingTo();
            if (data.data.message) {
                const chatMessages = document.getElementById('chatMessages');
                const msg = data.data.message;
                if (chatMessages && !chatMessages.querySelector(`.message[data-message-id="${msg.id}"]`)) {
                    renderMessages([msg], false);
                    triggerStickerShakeForMessage(msg.id);
                }
                requestAnimationFrame(() => scrollToBottom());
            }
            loadConversations();
            trackEvent('message_sent', { conversation_id: currentConversationId, as_sticker: true });
        } catch (err) {
            console.error(err);
            alert('Ошибка при отправке стикера');
        }
        return;
    }

    const payload = {
        conversation_id: currentConversationId,
        content: content,
        type: 'text'
    };
    if (replyingToMessage && replyingToMessage.id) {
        payload.reply_to_id = replyingToMessage.id;
    }
    const conv = conversations.find(c => c.id === currentConversationId);
    if (conv && window.E2EE_KEYS && E2EE_KEYS.isSupported) {
        let key = null;
        if (conv.type === 'private' && conv.other_user) {
            key = await E2EE_KEYS.getOrCreateConversationKey(currentConversationId, conv.other_user.uuid);
        } else if (conv.type === 'group') {
            key = await E2EE_KEYS.getOrCreateGroupConversationKey(currentConversationId);
            if (!key) {
                const uuids = await getGroupParticipantUuids(currentConversationId);
                key = await E2EE_KEYS.ensureGroupKeyCreatedAndDistributed(currentConversationId, uuids);
            }
        }
        if (key) {
            const encrypted = await E2EE_KEYS.encryptPlaintext(content, key);
            if (encrypted) {
                payload.content = encrypted;
                payload.encrypted = true;
                if (conv.type === 'private' && E2EE_KEYS.getConversationAlgorithm) {
                    payload.encryption_algorithm = E2EE_KEYS.getConversationAlgorithm(currentConversationId) || 'ECDH-P256-AES-GCM';
                } else {
                    payload.encryption_algorithm = 'ECDH-P256-AES-GCM';
                }
            }
        }
    }
    try {
        const data = await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify(payload),
            timeoutMs: 60000
        });

        setMessageInputContent('');
        if (messageInput.style) messageInput.style.height = 'auto';
        clearReplyingTo();

        // Добавление сообщения в чат (не добавляем, если уже есть — мог прийти из polling)
        if (data.data.message) {
            const chatMessages = document.getElementById('chatMessages');
            const msg = data.data.message;
            if (payload.encrypted) msg.content = content;
            if (chatMessages && !chatMessages.querySelector(`.message[data-message-id="${msg.id}"]`)) {
                renderMessages([msg], false);
            }
            requestAnimationFrame(() => scrollToBottom());
        }

        // Обновление списка чатов
        loadConversations();

        trackEvent('message_sent', { conversation_id: currentConversationId });
    } catch (error) {
        console.error('Error sending message:', error);
        let msg = error && error.message ? error.message : 'Ошибка при отправке сообщения';
        if (msg === 'Failed to fetch' || msg === 'Load failed') {
            msg = 'Сервер не ответил (таймаут или нет сети). Проверьте интернет и попробуйте снова.';
        }
        alert(msg);
    }
}

/** Загрузить файл на сервер и отправить как сообщение (используется при выборе файла и при вставке из буфера). */
async function uploadAndSendFile(file) {
    if (!file || !currentConversationId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversation_id', currentConversationId);

    try {
        const response = await fetch(`${API_BASE}/api/upload.php`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            const filePayload = {
                conversation_id: currentConversationId,
                content: '',
                type: file.type.startsWith('image/') ? 'image' : 'file',
                file_path: data.data.url,
                file_name: file.name,
                file_size: file.size
            };
            if (replyingToMessage && replyingToMessage.id) filePayload.reply_to_id = replyingToMessage.id;
            const messageData = await apiRequest(`${API_BASE}/api/messages.php`, {
                method: 'POST',
                body: JSON.stringify(filePayload)
            });

            if (messageData.data.message) {
                const chatMessages = document.getElementById('chatMessages');
                const msg = messageData.data.message;
                if (chatMessages && !chatMessages.querySelector(`.message[data-message-id="${msg.id}"]`)) {
                    renderMessages([msg], false);
                }
            }
            clearReplyingTo();
            loadConversations();
            trackEvent('file_uploaded', { type: file.type, size: file.size });
        } else {
            alert(data.error || 'Ошибка при загрузке файла');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('Ошибка при загрузке файла');
    }
}

// Обработка выбора файла (кнопка «Прикрепить»)
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !currentConversationId) return;
    await uploadAndSendFile(file);
}

// Прокрутка вниз
function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
        hideScrollToBottomButton();
    }
}

/** Прокрутка к первому непрочитанному (внизу видимой области); если нет — в конец */
function scrollToFirstUnreadOrBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const firstUnread = chatMessages.querySelector('.message[data-read-by-me="0"]');
    if (firstUnread) {
        firstUnread.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
        scrollToBottom();
    }
    hideScrollToBottomButton();
}

let scrollToBottomHideTimer = null;
const SCROLL_TO_BOTTOM_HIDE_AFTER_MS = 1500;
const SCROLL_TO_BOTTOM_THRESHOLD = 80;

function isAtBottom(container) {
    if (!container) return true;
    const scrollTop = container.scrollTop;
    return container.scrollHeight - scrollTop - container.clientHeight <= SCROLL_TO_BOTTOM_THRESHOLD;
}

function showScrollToBottomButton() {
    const btn = document.getElementById('chatScrollToBottom');
    if (btn) btn.classList.remove('is-hidden');
    updateScrollToBottomUnreadBadge();
}

function hideScrollToBottomButton() {
    const btn = document.getElementById('chatScrollToBottom');
    if (btn) btn.classList.add('is-hidden');
    const badge = document.getElementById('chatScrollToBottomUnread');
    if (badge) {
        badge.classList.add('is-hidden');
        badge.textContent = '0';
    }
    if (scrollToBottomHideTimer) {
        clearTimeout(scrollToBottomHideTimer);
        scrollToBottomHideTimer = null;
    }
}

function updateScrollToBottomUnreadBadge() {
    const badge = document.getElementById('chatScrollToBottomUnread');
    if (!badge) return;
    const conv = currentConversationId != null ? conversations.find(c => c.id == currentConversationId) : null;
    const count = (conv && (conv.unread_count | 0) > 0) ? (conv.unread_count | 0) : 0;
    badge.textContent = String(count > 99 ? '99+' : count);
    badge.classList.toggle('is-hidden', count === 0);
}

function setupScrollToBottomButton() {
    const chatMessages = document.getElementById('chatMessages');
    const btn = document.getElementById('chatScrollToBottom');
    if (!chatMessages || !btn) return;
    let lastScrollTop = chatMessages.scrollTop;
    chatMessages.addEventListener('scroll', () => {
        if (Date.now() < programmaticScrollUntil) {
            lastScrollTop = chatMessages.scrollTop;
            return;
        }
        hasUserScrolledInConversation = true;
        const scrollTop = chatMessages.scrollTop;
        const atBottom = isAtBottom(chatMessages);
        const scrolledDown = scrollTop > lastScrollTop;
        lastScrollTop = scrollTop;
        const conv = currentConversationId != null ? conversations.find(c => c.id == currentConversationId) : null;
        const hasUnread = conv && (conv.unread_count | 0) > 0;
        if (atBottom) {
            hideScrollToBottomButton();
            return;
        }
        showScrollToBottomButton();
        if (hasUnread) {
            if (scrollToBottomHideTimer) clearTimeout(scrollToBottomHideTimer);
            scrollToBottomHideTimer = null;
        } else {
            if (scrollToBottomHideTimer) clearTimeout(scrollToBottomHideTimer);
            scrollToBottomHideTimer = setTimeout(() => {
                scrollToBottomHideTimer = null;
                hideScrollToBottomButton();
            }, SCROLL_TO_BOTTOM_HIDE_AFTER_MS);
        }
    }, { passive: true });
    btn.addEventListener('click', () => {
        scrollToBottom();
    });
}

function updateScrollToBottomButtonVisibility() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    if (isAtBottom(chatMessages)) {
        hideScrollToBottomButton();
    } else {
        showScrollToBottomButton();
    }
}

// Прокрутка к сообщению по клику на блок «Ответ на»
function scrollToMessage(messageId) {
    const el = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message-highlight');
        setTimeout(() => el.classList.remove('message-highlight'), 2000);
    }
}

/** По умолчанию скрыть поиск чатов под верхом: установить scroll так, чтобы был виден только список (вызывать при загрузке и при закрытии E2EE-модалки) */
function initChatsPanelScrollHideSearch() {
    const scrollEl = document.querySelector('.chats-panel-scroll');
    const searchEl = document.querySelector('.chats-search');
    if (!scrollEl || !searchEl) return;
    if (scrollEl._chatsSearchInitiallyHidden) return;
    const searchHeight = searchEl.offsetHeight;
    if (searchHeight <= 0) return;
    function apply() {
        const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        if (maxScroll <= 0) return; /* контент ещё не отрисован — повторим при следующем вызове (напр. после закрытия E2EE) */
        scrollEl.scrollTop = Math.min(searchHeight, maxScroll);
        scrollEl._chatsSearchInitiallyHidden = true;
    }
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            apply();
        });
    });
}

/** Поиск по расшифрованным сообщениям в кэше (E2EE) на клиенте */
function searchDecryptedMessageCache(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q || !decryptedMessageContentCache) return [];
    const snippetLen = 80;
    const results = [];
    for (const convIdStr of Object.keys(decryptedMessageContentCache)) {
        const byMessage = decryptedMessageContentCache[convIdStr];
        if (!byMessage || typeof byMessage !== 'object') continue;
        for (const messageIdStr of Object.keys(byMessage)) {
            const content = byMessage[messageIdStr];
            if (typeof content !== 'string') continue;
            if (!content.toLowerCase().includes(q)) continue;
            const preview = content.length > snippetLen ? content.substring(0, snippetLen) + '…' : content;
            results.push({
                conversation_id: parseInt(convIdStr, 10),
                message_id: parseInt(messageIdStr, 10),
                content_preview: preview,
                created_at: null
            });
        }
    }
    return results;
}

/** Поиск по тексту сообщений: API (незашифрованные) + кэш расшифрованных на клиенте; затем отрисовка списка */
async function searchMessagesInConversations(query) {
    const q = (query || '').trim();
    if (q.length < 2) {
        messageSearchResults = null;
        renderConversations();
        filterChats();
        return;
    }
    const clientResults = searchDecryptedMessageCache(q);
    const seenKey = new Set(clientResults.map(r => `${r.conversation_id}-${r.message_id}`));
    let results = [...clientResults];
    try {
        const data = await apiRequest(`${API_BASE}/api/messages.php?action=search&q=${encodeURIComponent(q)}`);
        const serverResults = (data && data.data && data.data.results) || [];
        for (const r of serverResults) {
            const key = `${r.conversation_id}-${r.message_id}`;
            if (!seenKey.has(key)) {
                seenKey.add(key);
                results.push(r);
            }
        }
    } catch (err) {
        console.error('Message search failed:', err);
    }
    messageSearchResults = { query: q, results };
    renderConversationsWithMessageSearch(results);
}

// Фильтрация чатов и контактов в объединённом списке (по имени и username); при запросе от 2 символов — поиск по сообщениям
function filterChats(e) {
    const input = document.getElementById('chatsSearch');
    const query = (e && e.target ? e.target.value : (input ? input.value : '')).trim();
    const queryLower = query.toLowerCase();
    if (query.length >= 2) {
        clearTimeout(messageSearchTimeout);
        messageSearchTimeout = setTimeout(() => searchMessagesInConversations(query), 300);
        return;
    }
    messageSearchResults = null;
    renderConversations();
    document.querySelectorAll('.chat-item-row').forEach(row => {
        const searchable = (row.dataset.searchable || '').toLowerCase() || (row.querySelector('.chat-item-name') && row.querySelector('.chat-item-name').textContent || '').toLowerCase();
        row.classList.toggle('is-hidden', queryLower ? !searchable.includes(queryLower) : false);
    });
    document.querySelectorAll('.chats-list-section.contacts-without-chat').forEach(section => {
        const visibleCount = section.querySelectorAll('.chat-item-row:not(.is-hidden)').length;
        section.classList.toggle('is-hidden', visibleCount === 0);
    });
}

// --- Контакты ---
function switchSidebarTab(tab) {
    currentSidebarTab = tab;
    const chatsPanel = document.getElementById('chatsPanel');
    const contactsPanel = document.getElementById('contactsPanel');
    const tabChats = document.getElementById('tabChats');
    const tabContacts = document.getElementById('tabContacts');
    if (chatsPanel) chatsPanel.classList.toggle('is-hidden', tab !== 'chats');
    if (contactsPanel) contactsPanel.classList.toggle('is-hidden', tab !== 'contacts');
    if (tabChats) tabChats.classList.toggle('active', tab === 'chats');
    if (tabContacts) tabContacts.classList.toggle('active', tab === 'contacts');
    if (tab === 'contacts') {
        loadContacts().then(() => renderContacts());
    }
}

async function loadContacts() {
    try {
        const data = await apiRequest(`${API_BASE}/api/users.php?action=contacts`);
        contacts = data.data.users || [];
    } catch (error) {
        console.error('Error loading contacts:', error);
        contacts = [];
    }
}

function renderContacts(filterQuery = '') {
    const list = document.getElementById('contactsList');
    if (!list) return;
    const q = filterQuery.toLowerCase();
    const filtered = q
        ? contacts.filter(c => ((c.display_name || '') + ' ' + (c.username || '')).toLowerCase().includes(q))
        : contacts;
    if (filtered.length === 0) {
        list.innerHTML = '<div class="contacts-empty">' + (q ? 'Никого не найдено' : 'Нет контактов') + '</div>';
        return;
    }
    list.innerHTML = filtered.map(user => {
        const name = user.display_name || user.username || 'Пользователь';
        const avatarHtml = user.avatar
            ? `<img src="${escapeHtml(user.avatar)}" alt="">`
            : escapeHtml(name.charAt(0).toUpperCase());
        return `
            <div class="contact-item" data-user-uuid="${escapeHtml(user.uuid || '')}">
                <div class="contact-item-avatar">${avatarHtml}</div>
                <div class="contact-item-info">
                    <div class="contact-item-name">${escapeHtml(name)}</div>
                    <div class="contact-item-status">${getActivityStatus(user.last_seen ?? null)}</div>
                </div>
            </div>
        `;
    }).join('');
    list.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', () => {
            const userUuid = item.dataset.userUuid || '';
            createOrOpenPrivateChat(userUuid);
        });
    });
}

function filterContacts(e) {
    const query = (e.target.value || '').trim();
    renderContacts(query);
}

// Создать или открыть личный чат с пользователем
async function createOrOpenPrivateChat(userUuid) {
    const existing = conversations.find(c => c.type === 'private' && c.other_user && c.other_user.uuid === userUuid);
    if (existing) {
        openConversation(existing.id);
        const modal = document.getElementById('modalNewChat');
        if (modal) modal.classList.add('is-hidden');
        switchSidebarTab('chats');
        return;
    }
    try {
        const data = await apiRequest(`${API_BASE}/api/conversations.php`, {
            method: 'POST',
            body: JSON.stringify({ type: 'private', participants: [userUuid] })
        });
        const conversationId = data.data.conversation_id;
        await loadConversations();
        openConversation(conversationId);
        const modal = document.getElementById('modalNewChat');
        if (modal) modal.classList.add('is-hidden');
        switchSidebarTab('chats');
        trackEvent('private_chat_created', { user_uuid: userUuid });
    } catch (error) {
        console.error('Error creating conversation:', error);
        alert('Could not start chat. Try again.');
    }
}

// --- Пересылка сообщений ---
function openForwardToModal() {
    const modal = document.getElementById('modalForwardTo');
    const titleEl = document.getElementById('modalForwardToTitle');
    const count = forwardMessageIdsToSend.length;
    if (titleEl) {
        titleEl.textContent = count > 1 ? `Переслать ${count} сообщений` : 'Переслать в чат';
    }
    renderForwardToList('');
    const searchInput = document.getElementById('forwardToSearch');
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = () => renderForwardToList(searchInput.value.trim());
    }
    if (modal) modal.classList.remove('is-hidden');
}

function renderForwardToList(searchQuery) {
    const listEl = document.getElementById('forwardToList');
    if (!listEl) return;
    let list = conversations || [];
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        list = list.filter(conv => {
            const name = (conv.name || conv.other_user?.display_name || conv.other_user?.username || chatLang('conversation_default', 'Беседа')).toLowerCase();
            return name.includes(q);
        });
    }
    if (list.length === 0) {
        listEl.innerHTML = '<div class="forward-to-empty">' + (searchQuery ? 'Ничего не найдено' : 'Нет чатов') + '</div>';
        return;
    }
    listEl.innerHTML = list.map(conv => {
        const avatar = conv.avatar || conv.other_user?.avatar;
        const name = conv.name || conv.other_user?.display_name || conv.other_user?.username || chatLang('conversation_default', 'Беседа');
        const isGroup = conv.type === 'group';
        const avatarClass = isGroup ? 'forward-to-avatar forward-to-avatar-group' : 'forward-to-avatar';
        const avatarHtml = avatar
            ? `<img src="${escapeHtml(avatar)}" alt="">`
            : escapeHtml(name.charAt(0).toUpperCase());
        return `
            <div class="forward-to-item" data-conversation-id="${conv.id}">
                <div class="${avatarClass}">${avatarHtml}</div>
                <div class="forward-to-name">${escapeHtml(name)}</div>
            </div>
        `;
    }).join('');
    listEl.querySelectorAll('.forward-to-item').forEach(item => {
        item.addEventListener('click', () => {
            const cid = parseInt(item.dataset.conversationId, 10);
            if (cid) forwardMessages(forwardMessageIdsToSend, cid);
        });
    });
}

/** Получить читаемый текст сообщения для пересылки: из кэша расшифрованных или из DOM. */
function getForwardMessageContent(messageId) {
    const convId = currentConversationId;
    if (convId && decryptedMessageContentCache[convId] && decryptedMessageContentCache[convId][messageId] !== undefined) {
        return decryptedMessageContentCache[convId][messageId];
    }
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return undefined;
    const el = chatMessages.querySelector(`.message[data-message-id="${messageId}"] .message-content`);
    return el ? (el.textContent || '').trim() : undefined;
}

async function forwardMessages(messageIds, targetConversationId) {
    if (!messageIds || messageIds.length === 0) return;
    const body = {
        action: 'forward',
        target_conversation_id: targetConversationId,
        message_ids: messageIds
    };
    // Собрать контент для пересылки (из кэша расшифрованных или DOM), чтобы в целевом чате пересланные сообщения были читаемы (E2EE: не копировать ciphertext из другого чата)
    const contents = [];
    let hasAll = true;
    for (const mid of messageIds) {
        const c = getForwardMessageContent(mid);
        if (c === undefined) hasAll = false;
        contents.push(c);
    }
    if (hasAll && contents.length > 0) {
        const targetConv = conversations.find(c => c.id === targetConversationId);
        let targetKey = null;
        let targetEncrypt = false;
        if (targetConv && window.E2EE_KEYS && E2EE_KEYS.isSupported) {
            if (targetConv.type === 'private' && targetConv.other_user) {
                targetKey = await E2EE_KEYS.getOrCreateConversationKey(targetConversationId, targetConv.other_user.uuid);
            } else if (targetConv.type === 'group') {
                targetKey = await E2EE_KEYS.getOrCreateGroupConversationKey(targetConversationId);
                if (!targetKey) {
                    const uuids = await getGroupParticipantUuids(targetConversationId);
                    targetKey = await E2EE_KEYS.ensureGroupKeyCreatedAndDistributed(targetConversationId, uuids);
                }
            }
            targetEncrypt = !!targetKey;
        }
        const messages = [];
        for (let i = 0; i < contents.length; i++) {
            let content = contents[i] || '';
            let encrypted = 0;
            let encryption_algorithm = null;
            if (targetEncrypt && targetKey) {
                const encryptedContent = await E2EE_KEYS.encryptPlaintext(content, targetKey);
                if (encryptedContent) {
                    content = encryptedContent;
                    encrypted = 1;
                    encryption_algorithm = (targetConv.type === 'private' && E2EE_KEYS.getConversationAlgorithm)
                        ? (E2EE_KEYS.getConversationAlgorithm(targetConversationId) || 'ECDH-P256-AES-GCM')
                        : 'ECDH-P256-AES-GCM';
                }
            }
            messages.push({ content, encrypted, encryption_algorithm });
        }
        body.messages = messages;
    }
    try {
        await apiRequest(`${API_BASE}/api/messages.php`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        const modal = document.getElementById('modalForwardTo');
        if (modal) modal.classList.add('is-hidden');
        forwardMessageIdsToSend = [];
        exitForwardSelectionMode();
        showToast('Сообщения пересланы');
    } catch (err) {
        console.error(err);
        const msg = (err && err.message) || (err && err.data && err.data.error) || 'Could not forward';
        alert(msg);
    }
}

// --- Режим выбора нескольких сообщений для пересылки ---
function getForwardSelectedIds() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return [];
    return Array.from(chatMessages.querySelectorAll('.message-forward-checkbox:checked'))
        .map(cb => parseInt(cb.dataset.messageId, 10))
        .filter(id => Number.isFinite(id));
}

function updateForwardSelectionBar() {
    const n = getForwardSelectedIds().length;
    const forwardBtn = document.getElementById('forwardSelectionForward');
    const deleteBtn = document.getElementById('forwardSelectionDelete');
    if (forwardBtn) forwardBtn.textContent = n > 0 ? (window.__LANG__?.chat?.forward_btn || 'Переслать') + ` (${n})` : (window.__LANG__?.chat?.forward_btn || 'Переслать');
    if (deleteBtn) {
        const label = window.__LANG__?.chat?.delete_selected || 'Удалить выбранные';
        deleteBtn.textContent = n > 0 ? `${label} (${n})` : label;
        deleteBtn.disabled = n === 0;
    }
}

function enterForwardSelectionMode() {
    const chatMessages = document.getElementById('chatMessages');
    const bar = document.getElementById('forwardSelectionBar');
    if (!chatMessages || !bar) return;
    forwardSelectionMode = true;
    chatMessages.classList.add('forward-selection-mode');
    bar.classList.remove('is-hidden');
    chatMessages.querySelectorAll('.message-forward-checkbox').forEach(cb => { cb.checked = false; });
    updateForwardSelectionBar();
}

function exitForwardSelectionMode() {
    const chatMessages = document.getElementById('chatMessages');
    const bar = document.getElementById('forwardSelectionBar');
    if (chatMessages) chatMessages.classList.remove('forward-selection-mode');
    if (bar) bar.classList.add('is-hidden');
    forwardSelectionMode = false;
    chatMessages && chatMessages.querySelectorAll('.message-forward-checkbox').forEach(cb => { cb.checked = false; });
}

// Показать краткое уведомление (toast)
function showToast(text) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        el.classList.remove('visible');
    }, 2500);
}

// --- Модальное окно нового чата ---
async function loadModalUserList(searchQuery = '') {
    const listEl = document.getElementById('newChatUserList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="new-chat-loading">' + (window.__LANG__ && window.__LANG__.common && window.__LANG__.common.loading ? window.__LANG__.common.loading : 'Loading...') + '</div>';
    try {
        let users;
        if (searchQuery.length >= 2) {
            const data = await apiRequest(`${API_BASE}/api/users.php?action=search&q=${encodeURIComponent(searchQuery)}`);
            users = data.data.users || [];
        } else {
            const data = await apiRequest(`${API_BASE}/api/users.php?action=contacts`);
            users = data.data.users || [];
        }
        if (users.length === 0) {
            listEl.innerHTML = '<div class="new-chat-empty">' + (searchQuery ? 'Никого не найдено' : 'Введите имя для поиска (от 2 символов) или выберите из контактов') + '</div>';
            return;
        }
        listEl.innerHTML = users.map(user => {
            const name = user.display_name || user.username || 'Пользователь';
            const avatarHtml = user.avatar
                ? `<img src="${escapeHtml(user.avatar)}" alt="" class="new-chat-user-avatar-img">`
                : escapeHtml(name.charAt(0).toUpperCase());
            return `
                <div class="new-chat-user-item" data-user-uuid="${escapeHtml(user.uuid || '')}">
                    <div class="new-chat-user-avatar">${avatarHtml}</div>
                    <div class="new-chat-user-name">${escapeHtml(name)}</div>
                </div>
            `;
        }).join('');
        listEl.querySelectorAll('.new-chat-user-item').forEach(item => {
            item.addEventListener('click', () => {
                const userUuid = item.dataset.userUuid || '';
                createOrOpenPrivateChat(userUuid);
            });
        });
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<div class="new-chat-empty">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.load_error ? window.__LANG__.chat.load_error : 'Load error') + '</div>';
    }
}

// Сброс формы группового чата
function resetGroupChatForm() {
    groupSelectedParticipants.clear();
    const nameInput = document.getElementById('newChatGroupName');
    const searchInput = document.getElementById('newChatGroupUserSearch');
    const selectedEl = document.getElementById('newChatGroupSelected');
    const btnCreateGroup = document.getElementById('btnCreateGroup');
    if (nameInput) nameInput.value = '';
    if (searchInput) searchInput.value = '';
    if (selectedEl) selectedEl.innerHTML = '';
    if (btnCreateGroup) btnCreateGroup.disabled = true;
}

// Обновление кнопки «Создать группу» и списка выбранных участников
function updateGroupChatFormState() {
    const selectedEl = document.getElementById('newChatGroupSelected');
    const btnCreateGroup = document.getElementById('btnCreateGroup');
    const nameInput = document.getElementById('newChatGroupName');
    if (selectedEl) {
        selectedEl.innerHTML = Array.from(groupSelectedParticipants).map(uuid => {
            const u = groupModalUsers.find(x => x.uuid === uuid);
            const name = u ? (u.display_name || u.username || 'Пользователь') : uuid;
            return `<span class="new-chat-group-chip" data-user-uuid="${escapeHtml(uuid)}">${escapeHtml(name)} ×</span>`;
        }).join('');
        selectedEl.querySelectorAll('.new-chat-group-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                groupSelectedParticipants.delete(chip.dataset.userUuid);
                updateGroupChatFormState();
                renderGroupUserList();
            });
        });
    }
    if (btnCreateGroup && nameInput) {
        const name = nameInput.value.trim();
        btnCreateGroup.disabled = !name || groupSelectedParticipants.size === 0;
    }
}

let groupModalUsers = [];

// Загрузка списка пользователей для группового чата
async function loadModalGroupUserList(searchQuery = '') {
    const listEl = document.getElementById('newChatGroupUserList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="new-chat-loading">' + (window.__LANG__ && window.__LANG__.common && window.__LANG__.common.loading ? window.__LANG__.common.loading : 'Loading...') + '</div>';
    try {
        if (searchQuery.length >= 2) {
            const data = await apiRequest(`${API_BASE}/api/users.php?action=search&q=${encodeURIComponent(searchQuery)}`);
            groupModalUsers = data.data.users || [];
        } else {
            const data = await apiRequest(`${API_BASE}/api/users.php?action=contacts`);
            groupModalUsers = data.data.users || [];
        }
        renderGroupUserList();
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<div class="new-chat-empty">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.load_error ? window.__LANG__.chat.load_error : 'Load error') + '</div>';
    }
}

function renderGroupUserList() {
    const listEl = document.getElementById('newChatGroupUserList');
    const currentUserUuid = document.body.dataset.userUuid || '';
    if (!listEl) return;
    const filtered = groupModalUsers.filter(u => u.uuid !== currentUserUuid);
    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="new-chat-empty">Никого не найдено. Введите имя для поиска (от 2 символов).</div>';
        return;
    }
    listEl.innerHTML = filtered.map(user => {
        const name = user.display_name || user.username || 'Пользователь';
        const avatarHtml = user.avatar
            ? `<img src="${escapeHtml(user.avatar)}" alt="" class="new-chat-user-avatar-img">`
            : escapeHtml(name.charAt(0).toUpperCase());
        const checked = groupSelectedParticipants.has(user.uuid) ? ' checked' : '';
        return `
            <label class="new-chat-user-item new-chat-group-user-item">
                <input type="checkbox" class="new-chat-group-checkbox" data-user-uuid="${escapeHtml(user.uuid)}" data-username="${escapeHtml(name)}"${checked}>
                <div class="new-chat-user-avatar">${avatarHtml}</div>
                <div class="new-chat-user-name">${escapeHtml(name)}</div>
            </label>
        `;
    }).join('');
    listEl.querySelectorAll('.new-chat-group-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) {
                groupSelectedParticipants.add(cb.dataset.userUuid);
            } else {
                groupSelectedParticipants.delete(cb.dataset.userUuid);
            }
            updateGroupChatFormState();
            renderGroupUserList();
        });
    });
    updateGroupChatFormState();
}

// Создание группового чата
async function submitCreateGroupChat() {
    const nameInput = document.getElementById('newChatGroupName');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name || groupSelectedParticipants.size === 0) return;
    const participants = Array.from(groupSelectedParticipants);
    try {
        const data = await apiRequest(`${API_BASE}/api/conversations.php`, {
            method: 'POST',
            body: JSON.stringify({
                type: 'group',
                name: name,
                participants: participants
            })
        });
        const conversationId = data.data.conversation_id;
        const currentUserUuid = document.body.dataset.userUuid || '';
        if (window.E2EE_KEYS && E2EE_KEYS.isSupported && conversationId) {
            const groupKey = await E2EE_KEYS.generateGroupKey();
            if (groupKey) {
                E2EE_KEYS.setGroupKeyInCache(conversationId, groupKey);
                const allUuids = [currentUserUuid, ...participants];
                for (const userUuid of allUuids) {
                    const jwk = await E2EE_KEYS.getRemotePublicKey(userUuid);
                    if (jwk) {
                        const blob = await E2EE_KEYS.encryptGroupKeyForUser(groupKey, jwk);
                        if (blob) await E2EE_KEYS.storeGroupKeyForUser(conversationId, userUuid, blob);
                    }
                }
            }
        }
        const modal = document.getElementById('modalNewChat');
        if (modal) modal.classList.add('is-hidden');
        resetGroupChatForm();
        await loadConversations();
        openConversation(conversationId);
        switchSidebarTab('chats');
        trackEvent('group_chat_created', { conversation_id: conversationId, participant_count: participants.length });
    } catch (error) {
        console.error('Error creating group chat:', error);
        alert(error.message || 'Could not create group. Try again.');
    }
}

// Добавление участников в группу: состояние и модальное окно
let addGroupMembersSelected = new Set();
let addGroupMembersModalUsers = [];

function openAddGroupMembersModal() {
    const conv = window._lastGroupInfoConv;
    if (!conv || conv.type !== 'group' || !currentConversationId) return;
    addGroupMembersSelected.clear();
    const modal = document.getElementById('modalAddGroupMembers');
    const selectedEl = document.getElementById('addGroupMembersSelected');
    const searchInput = document.getElementById('addGroupMembersSearch');
    if (selectedEl) selectedEl.innerHTML = '';
    if (searchInput) searchInput.value = '';
    if (modal) modal.style.display = 'flex';
    loadAddGroupMembersUserList('');
}

async function loadAddGroupMembersUserList(searchQuery) {
    const listEl = document.getElementById('addGroupMembersUserList');
    if (!listEl) return;
    const conv = window._lastGroupInfoConv;
    const participantUuids = (conv && conv.participants) ? conv.participants.map(p => p.uuid) : [];
    listEl.innerHTML = '<div class="new-chat-loading">' + (window.__LANG__ && window.__LANG__.common && window.__LANG__.common.loading ? window.__LANG__.common.loading : 'Loading...') + '</div>';
    try {
        if (searchQuery.length >= 2) {
            const data = await apiRequest(`${API_BASE}/api/users.php?action=search&q=${encodeURIComponent(searchQuery)}`);
            addGroupMembersModalUsers = data.data.users || [];
        } else {
            const data = await apiRequest(`${API_BASE}/api/users.php?action=contacts`);
            addGroupMembersModalUsers = data.data.users || [];
        }
        addGroupMembersModalUsers = addGroupMembersModalUsers.filter(u => !participantUuids.includes(u.uuid));
        renderAddGroupMembersUserList();
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<div class="new-chat-empty">' + (window.__LANG__ && window.__LANG__.chat && window.__LANG__.chat.load_error ? window.__LANG__.chat.load_error : 'Load error') + '</div>';
    }
}

function renderAddGroupMembersUserList() {
    const listEl = document.getElementById('addGroupMembersUserList');
    const selectedEl = document.getElementById('addGroupMembersSelected');
    const currentUserUuid = document.body.dataset.userUuid || '';
    if (!listEl) return;
    const filtered = addGroupMembersModalUsers.filter(u => u.uuid !== currentUserUuid);
    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="new-chat-empty">Нет пользователей для добавления. Введите имя для поиска (от 2 символов).</div>';
    } else {
        listEl.innerHTML = filtered.map(user => {
            const name = user.display_name || user.username || 'Пользователь';
            const avatarHtml = user.avatar
                ? `<img src="${escapeHtml(user.avatar)}" alt="" class="new-chat-user-avatar-img">`
                : escapeHtml(name.charAt(0).toUpperCase());
            const checked = addGroupMembersSelected.has(user.uuid) ? ' checked' : '';
            return `
                <label class="new-chat-user-item new-chat-group-user-item">
                    <input type="checkbox" class="add-group-members-checkbox" data-user-uuid="${escapeHtml(user.uuid)}" data-username="${escapeHtml(name)}"${checked}>
                    <div class="new-chat-user-avatar">${avatarHtml}</div>
                    <div class="new-chat-user-name">${escapeHtml(name)}</div>
                </label>
            `;
        }).join('');
        listEl.querySelectorAll('.add-group-members-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) addGroupMembersSelected.add(cb.dataset.userUuid);
                else addGroupMembersSelected.delete(cb.dataset.userUuid);
                updateAddGroupMembersSelected();
            });
        });
    }
    updateAddGroupMembersSelected();
}

function updateAddGroupMembersSelected() {
    const selectedEl = document.getElementById('addGroupMembersSelected');
    const btn = document.getElementById('btnAddGroupMembersConfirm');
    if (!selectedEl) return;
    selectedEl.innerHTML = Array.from(addGroupMembersSelected).map(uuid => {
        const u = addGroupMembersModalUsers.find(x => x.uuid === uuid);
        const name = u ? (u.display_name || u.username || 'Пользователь') : uuid;
        return `<span class="new-chat-group-chip" data-user-uuid="${escapeHtml(uuid)}">${escapeHtml(name)} ×</span>`;
    }).join('');
    selectedEl.querySelectorAll('.new-chat-group-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            addGroupMembersSelected.delete(chip.dataset.userUuid);
            renderAddGroupMembersUserList();
        });
    });
    if (btn) btn.disabled = addGroupMembersSelected.size === 0;
}

async function submitAddGroupMembers() {
    if (addGroupMembersSelected.size === 0) return;
    const userUuids = Array.from(addGroupMembersSelected);
    try {
        await apiRequest(`${API_BASE}/api/conversations.php`, {
            method: 'POST',
            body: JSON.stringify({
                action: 'add_participants',
                conversation_id: currentConversationId,
                user_uuids: userUuids
            })
        });
        if (window.E2EE_KEYS && E2EE_KEYS.isSupported && currentConversationId) {
            const groupKey = await E2EE_KEYS.getOrCreateGroupConversationKey(currentConversationId);
            if (groupKey) {
                for (const userUuid of userUuids) {
                    const jwk = await E2EE_KEYS.getRemotePublicKey(userUuid);
                    if (jwk) {
                        const blob = await E2EE_KEYS.encryptGroupKeyForUser(groupKey, jwk);
                        if (blob) await E2EE_KEYS.storeGroupKeyForUser(currentConversationId, userUuid, blob);
                    }
                }
            }
        }
        const modalAdd = document.getElementById('modalAddGroupMembers');
        if (modalAdd) modalAdd.classList.add('is-hidden');
        addGroupMembersSelected.clear();
        await openGroupInfoModal();
    } catch (err) {
        console.error(err);
        alert(err.message || 'Could not add participants');
    }
}

// Показ модального окна новой беседы
function showNewChatModal() {
    const modal = document.getElementById('modalNewChat');
    if (modal) {
        modal.classList.remove('is-hidden');
        document.querySelectorAll('.btn-chat-type').forEach(b => b.classList.remove('active'));
        const privateBtn = document.querySelector('.btn-chat-type[data-type="private"]');
        if (privateBtn) privateBtn.classList.add('active');
        const privateEl = document.getElementById('newChatPrivate');
        const groupEl = document.getElementById('newChatGroup');
        const externalEl = document.getElementById('newChatExternal');
        const externalLinkWrap = document.getElementById('newChatExternalLinkWrap');
        if (privateEl) privateEl.classList.remove('is-hidden');
        if (groupEl) groupEl.classList.add('is-hidden');
        if (externalEl) externalEl.classList.add('is-hidden');
        if (externalLinkWrap) externalLinkWrap.classList.add('is-hidden');
        const searchInput = document.getElementById('newChatUserSearch');
        if (searchInput) searchInput.value = '';
        const externalNameInput = document.getElementById('newChatExternalName');
        if (externalNameInput) externalNameInput.value = '';
        loadModalUserList();
    }
    trackEvent('new_chat_clicked');
}

// Превью изображения на весь экран (zoom, скачать, закрыть, перетаскивание)
let imagePreviewModal = null;
let imagePreviewZoom = 1;
let imagePreviewX = 0;
let imagePreviewY = 0;
let imagePreviewDragging = false;
let imagePreviewDragStartX = 0;
let imagePreviewDragStartY = 0;
let imagePreviewDragStartOffsetX = 0;
let imagePreviewDragStartOffsetY = 0;
const IMAGE_PREVIEW_ZOOM_STEP = 0.25;
const IMAGE_PREVIEW_ZOOM_MIN = 0.5;
const IMAGE_PREVIEW_ZOOM_MAX = 4;

function getImagePreviewModal() {
    if (imagePreviewModal) return imagePreviewModal;
    const overlay = document.createElement('div');
    overlay.className = 'image-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Превью изображения');
    overlay.innerHTML = `
        <div class="image-preview-backdrop" data-action="close"></div>
        <div class="image-preview-content">
            <img class="image-preview-img" src="" alt="Превью" draggable="false">
        </div>
        <div class="image-preview-toolbar">
            <button type="button" class="image-preview-btn image-preview-zoom-out" title="Уменьшить" aria-label="Уменьшить">−</button>
            <span class="image-preview-zoom-value">100%</span>
            <button type="button" class="image-preview-btn image-preview-zoom-in" title="Увеличить" aria-label="Увеличить">+</button>
            <button type="button" class="image-preview-btn image-preview-download" title="Скачать" aria-label="Скачать">↓</button>
            <button type="button" class="image-preview-btn image-preview-close" title="Закрыть" aria-label="Закрыть">×</button>
        </div>
    `;
    const img = overlay.querySelector('.image-preview-img');
    const content = overlay.querySelector('.image-preview-content');
    const zoomValueEl = overlay.querySelector('.image-preview-zoom-value');
    overlay.querySelector('.image-preview-backdrop').addEventListener('click', closeImagePreview);
    overlay.querySelector('.image-preview-close').addEventListener('click', closeImagePreview);
    overlay.querySelector('.image-preview-zoom-in').addEventListener('click', () => imagePreviewZoomBy(IMAGE_PREVIEW_ZOOM_STEP));
    overlay.querySelector('.image-preview-zoom-out').addEventListener('click', () => imagePreviewZoomBy(-IMAGE_PREVIEW_ZOOM_STEP));
    overlay.querySelector('.image-preview-download').addEventListener('click', () => {
        if (img.src) {
            const a = document.createElement('a');
            a.href = img.src;
            a.download = img.src.split('/').pop() || 'image.jpg';
            a.rel = 'noopener';
            a.click();
        }
    });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeImagePreview();
    });
    img.addEventListener('wheel', (e) => {
        e.preventDefault();
        imagePreviewZoomBy(e.deltaY > 0 ? -IMAGE_PREVIEW_ZOOM_STEP : IMAGE_PREVIEW_ZOOM_STEP);
    }, { passive: false });
    function updateZoomDisplay() {
        img.style.transform = `translate(${imagePreviewX}px, ${imagePreviewY}px) scale(${imagePreviewZoom})`;
        if (zoomValueEl) zoomValueEl.textContent = Math.round(imagePreviewZoom * 100) + '%';
        content.classList.toggle('image-preview-pannable', imagePreviewZoom > 1);
    }
    function getClientCoords(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }
    function onPanStart(e) {
        if (e.target.closest('.image-preview-toolbar')) return;
        if (imagePreviewZoom <= 1) return;
        e.preventDefault();
        imagePreviewDragging = true;
        const coords = getClientCoords(e);
        imagePreviewDragStartX = coords.x;
        imagePreviewDragStartY = coords.y;
        imagePreviewDragStartOffsetX = imagePreviewX;
        imagePreviewDragStartOffsetY = imagePreviewY;
        content.classList.add('image-preview-dragging');
    }
    function onPanMove(e) {
        if (!imagePreviewDragging) return;
        e.preventDefault();
        const coords = getClientCoords(e);
        imagePreviewX = imagePreviewDragStartOffsetX + (coords.x - imagePreviewDragStartX);
        imagePreviewY = imagePreviewDragStartOffsetY + (coords.y - imagePreviewDragStartY);
        updateZoomDisplay();
    }
    function onPanEnd() {
        if (!imagePreviewDragging) return;
        imagePreviewDragging = false;
        content.classList.remove('image-preview-dragging');
    }
    content.addEventListener('mousedown', onPanStart);
    content.addEventListener('touchstart', onPanStart, { passive: false });
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('touchmove', onPanMove, { passive: false });
    document.addEventListener('mouseup', onPanEnd);
    document.addEventListener('touchend', onPanEnd);
    document.addEventListener('touchcancel', onPanEnd);
    document.body.appendChild(overlay);
    imagePreviewModal = { overlay, img, content, zoomValueEl, updateZoomDisplay };
    return imagePreviewModal;
}

function imagePreviewZoomBy(delta) {
    imagePreviewZoom = Math.max(IMAGE_PREVIEW_ZOOM_MIN, Math.min(IMAGE_PREVIEW_ZOOM_MAX, imagePreviewZoom + delta));
    if (imagePreviewModal && imagePreviewModal.updateZoomDisplay) imagePreviewModal.updateZoomDisplay();
}

function openImagePreview(src) {
    const modal = getImagePreviewModal();
    imagePreviewZoom = 1;
    imagePreviewX = 0;
    imagePreviewY = 0;
    imagePreviewDragging = false;
    modal.img.src = src;
    modal.updateZoomDisplay();
    modal.overlay.classList.add('open');
    modal.overlay.tabIndex = -1;
    modal.overlay.focus();
    document.body.style.overflow = 'hidden';
}

function closeImagePreview() {
    if (!imagePreviewModal) return;
    imagePreviewModal.overlay.classList.remove('open');
    document.body.style.overflow = '';
}

// Утилита для экранирования HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Экспорт функций для использования в других модулях
function refreshChatHeader() {
    const id = currentConversationId;
    if (!id) return;
    const conv = conversations.find(c => c.id === id);
    if (conv) updateChatHeader(conv);
}

window.chatModule = {
    loadConversations,
    openConversation,
    sendMessage,
    markConversationAsRead,
    markDelivered,
    deleteConversation,
    currentConversationId: () => currentConversationId,
    conversations: () => conversations,
    contacts: () => contacts,
    createMessageElement,
    updateMessageStatus,
    showReactionPicker,
    toggleReaction,
    fillReactionPicker,
    loadReactionEmojiList,
    setReplyingTo,
    getMessageDataFromElement,
    insertDateSeparatorIfNeeded,
    getLastMessageElement,
    getLastMessageGroupElement,
    refreshChatHeader,
    onGroupCallStarted,
    renderMessages,
    ensureMessagesDecryptedForConversation,
    triggerStickerShakeForMessage,
    setupUnreadObserver,
    updateScrollToBottomButtonVisibility,
    updateScrollToBottomUnreadBadge,
    renderConversations,
};
window.showReactionPicker = showReactionPicker;
