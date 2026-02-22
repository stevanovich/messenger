// Основной JavaScript файл

// Утилиты: базовый URL API — с сервера (data-base-url), иначе по pathname (чтобы работало при установке в подпапку)
const API_BASE = (typeof document !== 'undefined' && document.body && document.body.getAttribute('data-base-url')) || (window.location.origin + window.location.pathname.replace(/\/[^/]*$/, ''));
if (typeof window !== 'undefined') window.API_BASE = API_BASE;
const POLLING_INTERVAL = 2000; // 2 секунды

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Отправка аналитики (с таймаутом, ошибки не логируем — не мешаем работе приложения)
function trackEvent(eventType, eventData = null, coordinates = null) {
    const screenSize = `${window.innerWidth}x${window.innerHeight}`;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 4000);
    fetch(`${API_BASE}/api/analytics.php?action=event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            event_type: eventType,
            event_data: eventData,
            coordinates_x: coordinates ? coordinates.x : null,
            coordinates_y: coordinates ? coordinates.y : null,
            screen_size: screenSize
        }),
        signal: ac.signal
    }).then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
}

// Зоны интерфейса для тепловых карт (от более вложенной к более общей)
const HEATMAP_ZONE_SELECTORS = [
    { selector: '.btn-new-chat', zone: 'new_chat_btn' },
    { selector: '.chat-input-container', zone: 'chat_input' },
    { selector: '.chat-header', zone: 'chat_header' },
    { selector: '.chat-messages-wrap', zone: 'chat_messages' },
    { selector: '.chat-window', zone: 'chat_window' },
    { selector: '.chat-empty', zone: 'chat_empty' },
    { selector: '.chat-main', zone: 'chat_main' },
    { selector: '.sidebar-tabs', zone: 'sidebar_tabs' },
    { selector: '.contacts-panel', zone: 'contacts_panel' },
    { selector: '.chats-panel', zone: 'chats_panel' },
    { selector: '.chats-sidebar', zone: 'sidebar' }
];

function getClickZoneInfo(targetElement, clientX, clientY) {
    for (let i = 0; i < HEATMAP_ZONE_SELECTORS.length; i++) {
        const el = targetElement.closest(HEATMAP_ZONE_SELECTORS[i].selector);
        if (el) {
            const rect = el.getBoundingClientRect();
            return {
                zone: HEATMAP_ZONE_SELECTORS[i].zone,
                zone_x: Math.round(clientX - rect.left),
                zone_y: Math.round(clientY - rect.top),
                zone_width: Math.round(rect.width),
                zone_height: Math.round(rect.height)
            };
        }
    }
    return { zone: 'viewport', zone_x: null, zone_y: null, zone_width: null, zone_height: null };
}

// Отслеживание кликов для тепловых карт (viewport, зона, координаты в зоне)
document.addEventListener('click', (e) => {
    const page = window.location.pathname;
    const x = e.clientX;
    const y = e.clientY;
    const rawClass = e.target.className;
    const classStr = typeof rawClass === 'string' ? rawClass : (rawClass && typeof rawClass.baseVal === 'string' ? rawClass.baseVal : '');
    const element = e.target.tagName + (classStr ? '.' + classStr.split(' ').filter(Boolean).join('.') : '');
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const zoneInfo = getClickZoneInfo(e.target, x, y);
    
    const body = {
        page: page,
        x: x,
        y: y,
        element: element,
        viewport_width: viewportWidth,
        viewport_height: viewportHeight,
        zone: zoneInfo.zone
    };
    if (zoneInfo.zone_x != null) body.zone_x = zoneInfo.zone_x;
    if (zoneInfo.zone_y != null) body.zone_y = zoneInfo.zone_y;
    if (zoneInfo.zone_width != null) body.zone_width = zoneInfo.zone_width;
    if (zoneInfo.zone_height != null) body.zone_height = zoneInfo.zone_height;
    
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 4000);
    fetch(`${API_BASE}/api/analytics.php?action=click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal
    }).then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
});

// Локализованные строки для времени/даты/статуса (подставляются из window.__LANG__)
function getLANG() {
    return (typeof window !== 'undefined' && window.__LANG__) || {
        localeIntl: 'ru-RU',
        time: { just_now: 'только что', ago: 'назад', minute_forms: ['минуту', 'минуты', 'минут'], hour_forms: ['час', 'часа', 'часов'], day_forms: ['день', 'дня', 'дней'] },
        date: { today: 'Сегодня', yesterday: 'Вчера' },
        status: { online: 'онлайн', offline: 'офлайн', was: 'был(а) %s' },
    };
}
function lang(section, key, fallback) {
    const S = typeof window !== 'undefined' && window.__LANG__ && window.__LANG__[section];
    return (S && S[key] !== undefined && S[key] !== '') ? S[key] : (fallback || '');
}

function pluralize(number, forms) {
    if (!forms || forms.length < 3) return forms ? forms[0] : '';
    const cases = [2, 0, 1, 1, 1, 2];
    return forms[(number % 100 > 4 && number % 100 < 20) ? 2 : cases[Math.min(number % 10, 5)]];
}

// Утилита для форматирования времени (относительное: «5 мин назад» и т.д.)
function formatTime(dateString) {
    if (!dateString) return '';
    const L = getLANG();
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const locale = L.localeIntl || 'ru-RU';
    var withAgoPrefix = L.time && L.time.ago_prefix && String(L.time.ago_prefix).trim() !== '';
    if (seconds < 60) {
        return L.time.just_now || 'только что';
    } else if (minutes < 60) {
        const forms = L.time.minute_forms || ['минуту', 'минуты', 'минут'];
        const part = `${minutes} ${pluralize(minutes, forms)}`;
        return withAgoPrefix ? `${L.time.ago_prefix} ${part}` : `${part} ${L.time.ago || 'назад'}`;
    } else if (hours < 24) {
        const forms = L.time.hour_forms || ['час', 'часа', 'часов'];
        const part = `${hours} ${pluralize(hours, forms)}`;
        return withAgoPrefix ? `${L.time.ago_prefix} ${part}` : `${part} ${L.time.ago || 'назад'}`;
    } else if (days < 7) {
        const forms = L.time.day_forms || ['день', 'дня', 'дней'];
        const part = `${days} ${pluralize(days, forms)}`;
        return withAgoPrefix ? `${L.time.ago_prefix} ${part}` : `${part} ${L.time.ago || 'назад'}`;
    } else {
        return date.toLocaleDateString(locale, {
            day: '2-digit',
            month: '2-digit',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

/** Время для отображения в сообщении: только часы и минуты (например 14:35) */
function formatMessageTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const locale = getLANG().localeIntl || 'ru-RU';
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Дата для разделителя в чате: «05 февраля» или «05 февраля 2026» (год только если не текущий) */
function formatMessageDateFull(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const locale = getLANG().localeIntl || 'ru-RU';
    const opts = { day: '2-digit', month: 'long' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString(locale, opts);
}

/** Дата для плавающего блока при скролле: «Сегодня», «Вчера» или «5 февраля» */
function formatMessageDate(dateString) {
    if (!dateString) return '';
    const L = getLANG();
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (d.getTime() === today.getTime()) return L.date.today || 'Сегодня';
    if (d.getTime() === yesterday.getTime()) return L.date.yesterday || 'Вчера';
    const locale = L.localeIntl || 'ru-RU';
    const opts = { day: 'numeric', month: 'long' };
    if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString(locale, opts);
}

// Порог «онлайн» в миллисекундах (5 минут)
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Текст статуса активности пользователя по last_seen
 * @param {string|null} lastSeen - дата/время last_seen с сервера
 * @returns {string} "онлайн" | "был(а) X" | "офлайн"
 */
function getActivityStatus(lastSeen) {
    const L = getLANG();
    const status = L.status || {};
    if (!lastSeen) return status.offline || 'офлайн';
    const date = new Date(lastSeen);
    const diff = Date.now() - date.getTime();
    if (diff < 0) return status.offline || 'офлайн';
    if (diff < ONLINE_THRESHOLD_MS) return status.online || 'онлайн';
    const wasTpl = status.was || 'был(а) %s';
    return wasTpl.replace('%s', formatTime(lastSeen));
}

// Утилита для API запросов. options.timeoutMs — таймаут в мс (по умолчанию без ограничения; для отправки сообщений лучше задать 60000).
async function apiRequest(url, options = {}) {
    const { timeoutMs = 0, ...fetchOptions } = options;
    let abortController = null;
    if (timeoutMs > 0) {
        abortController = new AbortController();
        setTimeout(() => abortController.abort(), timeoutMs);
    }
    try {
        const response = await fetch(url, {
            ...fetchOptions,
            credentials: 'include',
            signal: abortController ? abortController.signal : (fetchOptions.signal || undefined),
            headers: {
                'Content-Type': 'application/json',
                ...fetchOptions.headers
            }
        });
        const text = await response.text();
        let data = {};
        try {
            if (text) data = JSON.parse(text);
        } catch (_) {
            data = {};
        }
        function extractErrorFromBody(t) {
            if (!t || typeof t !== 'string') return null;
            const m = t.match(/"error"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (m) return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            const m2 = t.match(/"error"\s*:\s*'([^']*)'/);
            if (m2) return m2[1];
            return null;
        }
        if (!response.ok) {
            const errMsg = (data && data.error) || extractErrorFromBody(text) || (text && text.length < 300 ? text.replace(/\s+/g, ' ').trim() : null);
            const msg = response.status === 409
                ? (typeof lang === 'function' ? lang('chat', 'group_call_already', 'В этой беседе уже идёт групповой звонок. Присоединяйтесь.') : 'В этой беседе уже идёт групповой звонок. Присоединяйтесь.')
                : (errMsg || (typeof lang === 'function' ? lang('common', 'error', 'Ошибка') : 'Ошибка') + ': ' + response.status);
            const err = new Error(msg);
            err.responseText = text;
            err.status = response.status;
            throw err;
        }
        return data;
    } catch (error) {
        // В фоновой вкладке сеть приостановлена (ERR_NETWORK_IO_SUSPENDED → Failed to fetch) — не засоряем консоль
        if (document.hidden && error instanceof TypeError && (error.message === 'Failed to fetch' || error.message === 'Load failed')) {
            console.debug('API request (tab hidden):', error.message);
        } else {
            console.error('API request error:', error);
        }
        if (error.name === 'AbortError' && timeoutMs > 0) {
            throw new Error(typeof lang === 'function' ? lang('app', 'server_timeout', 'Сервер не ответил вовремя. Проверьте интернет и попробуйте снова.') : 'Сервер не ответил вовремя. Проверьте интернет и попробуйте снова.');
        }
        throw error;
    }
}

// Показать/скрыть индикатор режима обновления (реальное время / по запросу). Настройка задаётся в админке и действует для всех пользователей (data-show-connection-status на body).
// Вызывается из app.js и из websocket/polling при обновлении статуса.
function applyConnectionStatusVisibility() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    const body = document.body;
    const serverValue = body && body.getAttribute('data-show-connection-status');
    const show = (serverValue === undefined || serverValue === null || serverValue === '') ? true : (serverValue === '1');
    el.style.display = show ? '' : 'none';
}
window.applyConnectionStatusVisibility = applyConnectionStatusVisibility;

// Инициализация при загрузке страницы
function onPageReady() {
    applyConnectionStatusVisibility();
    trackEvent('page_view', { page: window.location.pathname });
    initProfileModal();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
} else {
    onPageReady();
}

// Модальное окно профиля (боковая навигация)
function initProfileModal() {
    const navUserArea = document.getElementById('navUserArea');
    const modal = document.getElementById('modalProfile');
    const btnClose = document.getElementById('modalProfileClose');
    const navUsername = document.getElementById('navUsername');
    const navAvatarWrap = document.getElementById('navAvatarWrap');
    const avatarInput = document.getElementById('profileAvatarInput');
    const btnRemoveAvatar = document.getElementById('btnRemoveAvatar');
    const profileAvatarWrap = document.getElementById('profileAvatarWrap');
    const profileSidebar = document.getElementById('profileSidebar');
    const profileContent = document.getElementById('profileContent');
    const profileModalBody = modal?.querySelector('.profile-modal-body');
    const profileSectionBack = document.getElementById('profileSectionBack');

    const profileDisplayName = document.getElementById('profileDisplayName');
    const profileStatus = document.getElementById('profileStatus');
    const btnSavePersonal = document.getElementById('btnSavePersonal');
    const profilePersonalError = document.getElementById('profilePersonalError');

    const input = document.getElementById('profileNewUsername');
    const errorEl = document.getElementById('profileError');
    const profileLoginEdit = document.getElementById('profileLoginEdit');
    const profileLoginActions = document.getElementById('profileLoginActions');
    const btnSaveUsername = document.getElementById('btnSaveUsername');
    const btnCancelUsername = document.getElementById('btnCancelUsername');

    const profilePasswordToggle = document.getElementById('profilePasswordToggle');
    const profilePasswordToggleBtn = document.getElementById('profilePasswordToggleBtn');
    const profilePasswordSection = document.getElementById('profilePasswordSection');
    const btnCancelPassword = document.getElementById('btnCancelPassword');

    const btnDeleteHistory = document.getElementById('btnDeleteHistory');

    if (!navUserArea || !modal) return;

    let pendingAvatarUrl = undefined;
    let avatarChanged = false;
    let currentUserData = {};

    function showError(el, msg) {
        if (el) {
            el.textContent = msg;
            el.style.display = msg ? 'block' : 'none';
        }
    }

    function updateNavDisplay(displayName, username, avatarUrl) {
        if (!navUsername) return;
        navUsername.textContent = (displayName && displayName.trim()) || username || '?';
        if (!navAvatarWrap) return;
        const firstLetter = ((displayName && displayName.trim()) || username || '?').charAt(0).toUpperCase();
        if (avatarUrl) {
            navAvatarWrap.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="" class="nav-avatar" id="navAvatar">`;
        } else {
            navAvatarWrap.innerHTML = `<span class="nav-avatar-placeholder" id="navAvatarPlaceholder">${escapeHtml(firstLetter)}</span>`;
        }
    }

    function updateProfilePreview(avatarUrl, displayName, username) {
        if (!profileAvatarWrap) return;
        const firstLetter = ((displayName && displayName.trim()) || username || '?').charAt(0).toUpperCase();
        if (avatarUrl) {
            profileAvatarWrap.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="" class="profile-avatar-img" id="profileAvatarImg">`;
        } else {
            profileAvatarWrap.innerHTML = `<span class="profile-avatar-placeholder" id="profileAvatarPlaceholder">${escapeHtml(firstLetter)}</span>`;
        }
    }

    const profileSectionTitleHeader = document.getElementById('profileSectionTitleHeader');

    function switchSection(section) {
        modal.querySelectorAll('.profile-nav-item').forEach(el => {
            const isActive = el.dataset.section === section;
            el.classList.toggle('active', isActive);
            if (isActive && profileSectionTitleHeader && el.dataset.sectionTitle) {
                profileSectionTitleHeader.textContent = el.dataset.sectionTitle;
            }
        });
        modal.querySelectorAll('.profile-section').forEach(el => {
            el.classList.toggle('active', el.dataset.section === section);
        });
        if (section === 'data-protection' && typeof window.updateDeviceLockUI === 'function') {
            window.updateDeviceLockUI();
        }
        if (window.innerWidth <= 768) {
            profileModalBody?.classList.add('profile-mobile-content-open');
        }
    }

    function closeMobileContent() {
        profileModalBody?.classList.remove('profile-mobile-content-open');
    }

    const connectorsList = document.getElementById('profileConnectorsList');
    const connectorsLoading = document.getElementById('profileConnectorsLoading');
    const profilePasswordStatus = document.getElementById('profilePasswordStatus');
    const labelCurrentPassword = document.getElementById('labelProfileCurrentPassword');
    const profileCurrentPassword = document.getElementById('profileCurrentPassword');
    const profileNewPassword = document.getElementById('profileNewPassword');
    const profileNewPasswordConfirm = document.getElementById('profileNewPasswordConfirm');
    const btnSavePassword = document.getElementById('btnSavePassword');
    const profilePasswordError = document.getElementById('profilePasswordError');
    const profileDeletePasswordGroup = document.getElementById('profileDeletePasswordGroup');
    const profileDeletePassword = document.getElementById('profileDeletePassword');
    const profileDeleteError = document.getElementById('profileDeleteError');
    const btnDeleteAccount = document.getElementById('btnDeleteAccount');

    function updateDeleteSection(hasPassword) {
        if (profileDeletePasswordGroup) profileDeletePasswordGroup.style.display = hasPassword ? '' : 'none';
        if (profileDeletePassword) { profileDeletePassword.value = ''; profileDeletePassword.required = hasPassword; }
        if (profileDeleteError) { profileDeleteError.style.display = 'none'; profileDeleteError.textContent = ''; }
    }

    function renderConnectors(connectors) {
        if (!connectorsList) return;
        if (connectorsLoading) connectorsLoading.style.display = 'none';
        const names = { google: 'Google', yandex: 'Яндекс' };
        if (!connectors || connectors.length === 0) {
            connectorsList.innerHTML = '<p class="profile-connectors-empty">' + (typeof lang === 'function' ? lang('profile', 'no_connectors', 'Нет привязанных аккаунтов') : 'Нет привязанных аккаунтов') + '</p>';
            return;
        }
        const unlinkLabel = typeof lang === 'function' ? lang('profile', 'unlink', 'Отвязать') : 'Отвязать';
        connectorsList.innerHTML = connectors.map(c => {
            const name = names[c.provider] || c.provider;
            const email = c.provider_email ? ` (${escapeHtml(c.provider_email)})` : '';
            return `<div class="profile-connector-item" data-id="${c.id}">
                <span class="profile-connector-name">${escapeHtml(name)}${email}</span>
                <button type="button" class="btn btn-secondary profile-connector-unlink" data-id="${c.id}" title="${escapeHtml(unlinkLabel)}">${escapeHtml(unlinkLabel)}</button>
            </div>`;
        }).join('');
    }

    function updatePasswordSection(hasPassword) {
        if (profilePasswordStatus) {
            profilePasswordStatus.textContent = hasPassword
                ? (typeof lang === 'function' ? lang('profile', 'password_set', 'Пароль задан. Вы можете сменить его ниже.') : 'Пароль задан. Вы можете сменить его ниже.')
                : (typeof lang === 'function' ? lang('profile', 'password_not_set', 'Пароль не задан. Задайте пароль, чтобы входить по логину.') : 'Пароль не задан. Задайте пароль, чтобы входить по логину.');
        }
        if (labelCurrentPassword) labelCurrentPassword.style.display = hasPassword ? '' : 'none';
        if (profileCurrentPassword) profileCurrentPassword.style.display = hasPassword ? '' : 'none';
        if (profileNewPassword) profileNewPassword.value = '';
        if (profileNewPasswordConfirm) profileNewPasswordConfirm.value = '';
        if (profileCurrentPassword) profileCurrentPassword.value = '';
        if (profilePasswordError) { profilePasswordError.style.display = 'none'; profilePasswordError.textContent = ''; }
    }

    function openModal() {
        closeMobileContent();
        pendingAvatarUrl = undefined;
        avatarChanged = false;
        if (avatarInput) avatarInput.value = '';
        if (connectorsLoading) connectorsLoading.style.display = '';
        if (connectorsList) connectorsList.innerHTML = '';
        showError(profilePersonalError, '');
        if (profileContactsError) showError(profileContactsError, '');
        showError(errorEl, '');
        switchSection('personal');
        fetch(`${API_BASE}/api/auth.php?action=me`)
            .then(r => r.json())
            .then(res => {
                const data = res.data || res;
                currentUserData = data;
                const avatar = data.avatar;
                const displayName = data.display_name || '';
                const username = data.username || '';
                updateProfilePreview(avatar, displayName, username);
                if (btnRemoveAvatar) btnRemoveAvatar.style.display = avatar ? '' : 'none';
                if (profileDisplayName) profileDisplayName.value = displayName;
                if (profileStatus) profileStatus.value = data.status || '';
                const profileVisibleInContacts = document.getElementById('profileVisibleInContacts');
                if (profileVisibleInContacts) profileVisibleInContacts.checked = data.visible_in_contacts !== 0 && data.visible_in_contacts !== false;
                if (input) {
                    input.value = username;
                    input.readOnly = true;
                    input.classList.add('readonly');
                }
                if (profileLoginEdit) profileLoginEdit.style.display = '';
                if (profileLoginActions) profileLoginActions.style.display = 'none';
                renderConnectors(data.connectors || []);
                updatePasswordSection(!!data.has_password);
                updateDeleteSection(!!data.has_password);
                if (profilePasswordSection) profilePasswordSection.style.display = 'none';
                if (profilePasswordToggleBtn) profilePasswordToggleBtn.textContent = data.has_password ? (typeof lang === 'function' ? lang('profile', 'change_password', 'Сменить пароль') : 'Сменить пароль') : (typeof lang === 'function' ? lang('profile', 'set_password', 'Задать пароль') : 'Задать пароль');
            })
            .catch(() => {
                if (connectorsLoading) connectorsLoading.style.display = 'none';
                if (connectorsList) connectorsList.innerHTML = '<p class="profile-connectors-empty">' + (typeof lang === 'function' ? lang('profile', 'load_connectors_error', 'Не удалось загрузить') : 'Не удалось загрузить') + '</p>';
            });
        modal.classList.remove('is-hidden');
    }

    function closeModal() {
        modal.classList.add('is-hidden');
    }
    window.closeProfileSettingsModal = closeModal;

    profileSidebar?.addEventListener('click', (e) => {
        const item = e.target.closest('.profile-nav-item');
        if (item?.dataset.section) switchSection(item.dataset.section);
    });

    profileSectionBack?.addEventListener('click', closeMobileContent);

    profileModalBody?.addEventListener('click', (e) => {
        if (e.target === profileModalBody) return;
    });

    if (connectorsList) {
        connectorsList.addEventListener('click', (e) => {
            const unlinkBtn = e.target.closest('.profile-connector-unlink');
            if (!unlinkBtn) return;
            const id = unlinkBtn.getAttribute('data-id');
            if (!id || !confirm('Отвязать этот аккаунт? Вход через него будет недоступен.')) return;
            unlinkBtn.disabled = true;
            fetch(`${API_BASE}/api/auth.php?action=unlink_connector`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parseInt(id, 10) })
            })
                .then(r => r.json())
                .then(res => {
                    if (res.success) {
                        fetch(`${API_BASE}/api/auth.php?action=me`)
                            .then(r2 => r2.json())
                            .then(res2 => {
                                const data = res2.data || res2;
                                renderConnectors(data.connectors || []);
                            });
                    } else {
                        alert(res.error || (typeof lang === 'function' ? lang('profile', 'unlink_error', 'Не удалось отвязать') : 'Не удалось отвязать'));
                        unlinkBtn.disabled = false;
                    }
                })
                .catch(() => {
                    alert(typeof lang === 'function' ? lang('common', 'network_error', 'Ошибка сети') : 'Ошибка сети');
                    unlinkBtn.disabled = false;
                });
        });
    }

    if (btnSavePassword && profileNewPassword && profileNewPasswordConfirm) {
        btnSavePassword.addEventListener('click', async () => {
            const newPass = profileNewPassword.value;
            const confirmPass = profileNewPasswordConfirm.value;
            const currentPass = profileCurrentPassword ? profileCurrentPassword.value : '';
            let hasPassword = false;
            try {
                const meRes = await fetch(`${API_BASE}/api/auth.php?action=me`).then(r => r.json());
                hasPassword = !!(meRes.data || meRes).has_password;
            } catch (_) {}
            if (hasPassword && !currentPass) {
                if (profilePasswordError) {
                    profilePasswordError.textContent = typeof lang === 'function' ? lang('profile', 'enter_current_password', 'Введите текущий пароль') : 'Введите текущий пароль';
                    profilePasswordError.style.display = 'block';
                }
                return;
            }
            if (!newPass || newPass.length < 6) {
                if (profilePasswordError) {
                    profilePasswordError.textContent = typeof lang === 'function' ? lang('profile', 'password_min_6', 'Пароль не менее 6 символов') : 'Пароль не менее 6 символов';
                    profilePasswordError.style.display = 'block';
                }
                return;
            }
            if (newPass !== confirmPass) {
                if (profilePasswordError) {
                    profilePasswordError.textContent = typeof lang === 'function' ? lang('profile', 'passwords_mismatch', 'Пароли не совпадают') : 'Пароли не совпадают';
                    profilePasswordError.style.display = 'block';
                }
                return;
            }
            if (profilePasswordError) profilePasswordError.style.display = 'none';
            btnSavePassword.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/api/auth.php?action=set_password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        current_password: hasPassword ? currentPass : undefined,
                        new_password: newPass
                    })
                }).then(r => r.json());
                if (res.success) {
                    updatePasswordSection(true);
                    profileNewPassword.value = '';
                    profileNewPasswordConfirm.value = '';
                    if (profileCurrentPassword) profileCurrentPassword.value = '';
                } else {
                    if (profilePasswordError) {
                        profilePasswordError.textContent = res.error || (typeof lang === 'function' ? lang('common', 'error', 'Ошибка') : 'Ошибка');
                        profilePasswordError.style.display = 'block';
                    }
                }
            } catch (err) {
                if (profilePasswordError) {
                    profilePasswordError.textContent = err.message || (typeof lang === 'function' ? lang('common', 'network_error', 'Ошибка сети') : 'Ошибка сети');
                    profilePasswordError.style.display = 'block';
                }
            } finally {
                btnSavePassword.disabled = false;
            }
        });
    }

    if (btnDeleteAccount) {
        btnDeleteAccount.addEventListener('click', async () => {
            if (!confirm(typeof lang === 'function' ? lang('profile', 'delete_account_confirm', 'Удалить аккаунт безвозвратно? Все ваши данные будут удалены.') : 'Удалить аккаунт безвозвратно? Все ваши данные будут удалены.')) return;
            let hasPassword = false;
            try {
                const meRes = await fetch(`${API_BASE}/api/auth.php?action=me`).then(r => r.json());
                hasPassword = !!(meRes.data || meRes).has_password;
            } catch (_) {}
            const password = profileDeletePassword ? profileDeletePassword.value : '';
            if (hasPassword && !password) {
                if (profileDeleteError) {
                    profileDeleteError.textContent = typeof lang === 'function' ? lang('profile', 'enter_password_confirm', 'Введите пароль для подтверждения') : 'Введите пароль для подтверждения';
                    profileDeleteError.style.display = 'block';
                }
                return;
            }
            if (profileDeleteError) profileDeleteError.style.display = 'none';
            btnDeleteAccount.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/api/auth.php?action=delete_account`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(hasPassword ? { password } : {})
                }).then(r => r.json());
                if (res.success) {
                    const base = window.location.pathname.replace(/\/[^/]*$/, '') || '/';
                    window.location.href = window.location.origin + base + (base.endsWith('/') ? '' : '/') + 'login.php';
                    return;
                }
                if (profileDeleteError) {
                    profileDeleteError.textContent = res.error || 'Ошибка удаления';
                    profileDeleteError.style.display = 'block';
                }
            } catch (err) {
                if (profileDeleteError) {
                    profileDeleteError.textContent = err.message || 'Ошибка сети';
                    profileDeleteError.style.display = 'block';
                }
            } finally {
                btnDeleteAccount.disabled = false;
            }
        });
    }

    navUserArea.addEventListener('click', openModal);
    navUserArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); } });
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    window.openProfileSettings = openModal;

    profileLoginEdit?.addEventListener('click', () => {
        if (input) {
            input.readOnly = false;
            input.classList.remove('readonly');
            profileLoginEdit.style.display = 'none';
            if (profileLoginActions) profileLoginActions.style.display = 'flex';
        }
    });

    btnCancelUsername?.addEventListener('click', () => {
        if (input) {
            input.value = currentUserData.username || '';
            input.readOnly = true;
            input.classList.add('readonly');
        }
        profileLoginEdit.style.display = '';
        if (profileLoginActions) profileLoginActions.style.display = 'none';
        showError(errorEl, '');
    });

    profilePasswordToggleBtn?.addEventListener('click', () => {
        const visible = profilePasswordSection?.style.display !== 'none';
        if (profilePasswordSection) profilePasswordSection.style.display = visible ? 'none' : 'block';
        if (profilePasswordToggleBtn) profilePasswordToggleBtn.textContent = visible ? (currentUserData.has_password ? (typeof lang === 'function' ? lang('profile', 'change_password', 'Сменить пароль') : 'Сменить пароль') : (typeof lang === 'function' ? lang('profile', 'set_password', 'Задать пароль') : 'Задать пароль')) : (typeof lang === 'function' ? lang('profile', 'hide', 'Скрыть') : 'Скрыть');
    });

    btnCancelPassword?.addEventListener('click', () => {
        if (profilePasswordSection) profilePasswordSection.style.display = 'none';
        if (profilePasswordToggleBtn) profilePasswordToggleBtn.textContent = currentUserData.has_password ? (typeof lang === 'function' ? lang('profile', 'change_password', 'Сменить пароль') : 'Сменить пароль') : (typeof lang === 'function' ? lang('profile', 'set_password', 'Задать пароль') : 'Задать пароль');
        profileNewPassword.value = '';
        profileNewPasswordConfirm.value = '';
        if (profileCurrentPassword) profileCurrentPassword.value = '';
        showError(profilePasswordError, '');
    });

    btnSavePersonal?.addEventListener('click', async () => {
        showError(profilePersonalError, '');
        const body = {};
        const dn = profileDisplayName?.value?.trim() ?? '';
        const st = profileStatus?.value?.trim() ?? '';
        body.display_name = dn || null;
        body.status = st || null;
        if (avatarChanged) body.avatar = pendingAvatarUrl === undefined ? currentUserData.avatar : (pendingAvatarUrl === '' ? '' : pendingAvatarUrl);
        if (Object.keys(body).length === 0) return;
        btnSavePersonal.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/users.php`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(r => r.json());
            if (res.success) {
                currentUserData = { ...currentUserData, display_name: dn || null, status: st || null };
                if (avatarChanged) {
                    currentUserData.avatar = body.avatar === '' ? null : body.avatar;
                    avatarChanged = false;
                }
                updateNavDisplay(dn || null, currentUserData.username, currentUserData.avatar);
                updateProfilePreview(currentUserData.avatar, dn || null, currentUserData.username);
                if (btnRemoveAvatar) btnRemoveAvatar.style.display = currentUserData.avatar ? '' : 'none';
            } else {
                showError(profilePersonalError, res.error || 'Ошибка');
            }
        } catch (err) {
            showError(profilePersonalError, err.message || 'Ошибка сети');
        } finally {
            btnSavePersonal.disabled = false;
        }
    });

    const btnSaveContacts = document.getElementById('btnSaveContacts');
    const profileContactsError = document.getElementById('profileContactsError');
    btnSaveContacts?.addEventListener('click', async () => {
        showError(profileContactsError, '');
        const profileVisibleInContacts = document.getElementById('profileVisibleInContacts');
        if (!profileVisibleInContacts) return;
        const body = { visible_in_contacts: profileVisibleInContacts.checked };
        btnSaveContacts.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/users.php`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(r => r.json());
            if (res.success) {
                currentUserData.visible_in_contacts = body.visible_in_contacts;
            } else {
                showError(profileContactsError, res.error || 'Ошибка');
            }
        } catch (err) {
            showError(profileContactsError, err.message || 'Ошибка сети');
        } finally {
            btnSaveContacts.disabled = false;
        }
    });

    const profileLocale = document.getElementById('profileLocale');
    const profileLocaleError = document.getElementById('profileLocaleError');
    const btnSaveLocale = document.getElementById('btnSaveLocale');
    btnSaveLocale?.addEventListener('click', async () => {
        if (!profileLocale) return;
        const locale = profileLocale.value;
        showError(profileLocaleError, '');
        btnSaveLocale.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/users.php`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locale: locale })
            }).then(r => r.json());
            if (res.success) {
                const params = new URLSearchParams(window.location.search);
                params.set('lang', locale);
                window.location.href = window.location.pathname + '?' + params.toString();
                return;
            } else {
                showError(profileLocaleError, res.error || 'Error');
            }
        } catch (err) {
            showError(profileLocaleError, err.message || 'Network error');
        } finally {
            btnSaveLocale.disabled = false;
        }
    });

    btnSaveUsername?.addEventListener('click', async () => {
        const newUsername = input?.value?.trim() ?? '';
        if (!newUsername || newUsername.length < 3) {
            showError(errorEl, 'Логин не менее 3 символов');
            return;
        }
        if (!/^[\p{L}\p{N}_]+$/u.test(newUsername)) {
            showError(errorEl, 'Только буквы, цифры и подчеркивание');
            return;
        }
        showError(errorEl, '');
        btnSaveUsername.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/users.php`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: newUsername })
            }).then(r => r.json());
            if (res.success) {
                currentUserData.username = newUsername;
                input.readOnly = true;
                input.classList.add('readonly');
                profileLoginEdit.style.display = '';
                profileLoginActions.style.display = 'none';
            } else {
                showError(errorEl, res.error || 'Ошибка');
            }
        } catch (err) {
            showError(errorEl, err.message || 'Ошибка сети');
        } finally {
            btnSaveUsername.disabled = false;
        }
    });

    btnDeleteHistory?.addEventListener('click', async () => {
        if (!confirm(typeof lang === 'function' ? lang('profile', 'delete_history_confirm', 'Заменить вас на «неизвестный автор» во всех сообщениях? Это действие необратимо.') : 'Заменить вас на «неизвестный автор» во всех сообщениях? Это действие необратимо.')) return;
        btnDeleteHistory.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/auth.php?action=delete_history`, { method: 'POST' }).then(r => r.json());
            if (res.success) {
                alert(typeof lang === 'function' ? lang('profile', 'history_anonymized', 'История анонимизирована') : 'История анонимизирована');
            } else {
                alert(res.error || (typeof lang === 'function' ? lang('common', 'error', 'Ошибка') : 'Ошибка'));
            }
        } catch (err) {
            alert(err.message || (typeof lang === 'function' ? lang('common', 'network_error', 'Ошибка сети') : 'Ошибка сети'));
        } finally {
            btnDeleteHistory.disabled = false;
        }
    });

    if (avatarInput) {
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                showError(profilePersonalError, 'Размер файла не более 2 МБ');
                return;
            }
            showError(profilePersonalError, '');
            openCropModal(file);
        });
    }

    let cropState = { cropper: null, objectUrl: null, closeCropModal: null, onCropApply: null };

    function openCropModal(file) {
        if (typeof Cropper === 'undefined') {
            showError(profilePersonalError, 'Библиотека обрезки недоступна');
            return;
        }
        const cropModal = document.getElementById('modalAvatarCrop');
        const cropImage = document.getElementById('cropImage');
        const btnCropApply = document.getElementById('btnCropApply');
        const btnCropCancel = document.getElementById('btnCropCancel');
        const cropErrorEl = document.getElementById('cropError');
        if (!cropModal || !cropImage) return;

        if (cropState.objectUrl) URL.revokeObjectURL(cropState.objectUrl);
        if (cropState.cropper) { cropState.cropper.destroy(); cropState.cropper = null; }
        if (cropState.closeCropModal) {
            btnCropCancel?.removeEventListener('click', cropState.closeCropModal);
            document.getElementById('modalAvatarCropClose')?.removeEventListener('click', cropState.closeCropModal);
        }
        if (cropState.onCropApply) btnCropApply?.removeEventListener('click', cropState.onCropApply);

        const objectUrl = URL.createObjectURL(file);
        cropState.objectUrl = objectUrl;
        cropImage.src = objectUrl;
        cropModal.style.display = 'flex';
        if (cropErrorEl) cropErrorEl.style.display = 'none';
        if (btnCropApply) btnCropApply.disabled = false;

        function closeCropModal() {
            if (cropState.cropper) { cropState.cropper.destroy(); cropState.cropper = null; }
            if (cropState.objectUrl) { URL.revokeObjectURL(cropState.objectUrl); cropState.objectUrl = null; }
            cropState.closeCropModal = null;
            cropState.onCropApply = null;
            cropImage.src = '';
            cropModal.style.display = 'none';
            if (avatarInput) avatarInput.value = '';
        }
        cropState.closeCropModal = closeCropModal;

        function onCropApply() {
            if (!cropState.cropper) return;
            const canvas = cropState.cropper.getCroppedCanvas({ maxWidth: 400, maxHeight: 400 });
            if (!canvas) {
                if (cropErrorEl) { cropErrorEl.textContent = typeof lang === 'function' ? lang('profile', 'crop_error', 'Не удалось обрезать') : 'Не удалось обрезать'; cropErrorEl.style.display = 'block'; }
                return;
            }
            if (btnCropApply) btnCropApply.disabled = true;
            if (cropErrorEl) cropErrorEl.style.display = 'none';
            const mimeType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
            canvas.toBlob((blob) => {
                if (!blob) {
                    if (cropErrorEl) { cropErrorEl.textContent = typeof lang === 'function' ? lang('profile', 'processing_error', 'Ошибка обработки') : 'Ошибка обработки'; cropErrorEl.style.display = 'block'; }
                    if (btnCropApply) btnCropApply.disabled = false;
                    return;
                }
                const fd = new FormData();
                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                const croppedFile = new File([blob], `avatar.${ext}`, { type: blob.type });
                fd.append('file', croppedFile);
                fd.append('type', 'avatar');
                fetch(`${API_BASE}/api/upload.php`, { method: 'POST', body: fd })
                    .then(async (res) => {
                        const text = await res.text();
                        let data;
                        try {
                            data = JSON.parse(text);
                        } catch (e) {
                            console.error('Upload: сервер вернул не JSON (возможно HTML-страница ошибки). Status:', res.status, 'Body:', text.slice(0, 300));
                            return { ok: false, data: { error: (typeof lang === 'function' ? lang('profile', 'server_error_page', 'Сервер вернул страницу ошибки. Проверьте логи PHP на сервере (или права на uploads/avatars).') : 'Сервер вернул страницу ошибки. Проверьте логи PHP на сервере (или права на uploads/avatars).') } };
                        }
                        return { ok: res.ok, data };
                    })
                    .then(({ ok, data }) => {
                        const url = data.data?.url || data.url;
                        if (ok && url) {
                            if (typeof onCropSuccess === 'function') onCropSuccess(url);
                            closeCropModal();
                        } else {
                            const msg = data.error || (typeof lang === 'function' ? lang('profile', 'upload_error', 'Ошибка загрузки') : 'Ошибка загрузки');
                            console.error('Upload failed:', msg);
                            if (cropErrorEl) { cropErrorEl.textContent = msg; cropErrorEl.style.display = 'block'; }
                        }
                    })
                    .catch((err) => {
                        console.error('Upload error:', err);
                        if (cropErrorEl) { cropErrorEl.textContent = typeof lang === 'function' ? lang('profile', 'upload_error', 'Ошибка загрузки') : 'Ошибка загрузки'; cropErrorEl.style.display = 'block'; }
                    })
                    .finally(() => { if (btnCropApply) btnCropApply.disabled = false; });
            }, mimeType, 0.9);
        }
        cropState.onCropApply = onCropApply;

        cropImage.onload = () => {
            if (cropState.cropper) cropState.cropper.destroy();
            cropState.cropper = new Cropper(cropImage, {
                aspectRatio: 1,
                viewMode: 2,
                dragMode: 'move',
                autoCropArea: 0.8
            });
        };

        btnCropApply?.addEventListener('click', onCropApply);
        btnCropCancel?.addEventListener('click', closeCropModal);
        document.getElementById('modalAvatarCropClose')?.addEventListener('click', closeCropModal);
        cropModal.onclick = (e) => { if (e.target === cropModal) closeCropModal(); };
    }

    if (btnRemoveAvatar) {
        btnRemoveAvatar.addEventListener('click', () => {
            pendingAvatarUrl = '';
            avatarChanged = true;
            const dn = currentUserData.display_name || '';
            const un = currentUserData.username || '';
            updateProfilePreview(null, dn, un);
            btnRemoveAvatar.style.display = 'none';
        });
    }

    function onCropSuccess(url) {
        pendingAvatarUrl = url;
        avatarChanged = true;
        const dn = currentUserData.display_name || '';
        const un = currentUserData.username || '';
        updateProfilePreview(url, dn, un);
        if (btnRemoveAvatar) btnRemoveAvatar.style.display = '';
    }
}

// Кнопки показа/скрытия пароля во всех полях type="password"
(function initPasswordToggle() {
    var showLabel = 'Show password';
    var hideLabel = 'Hide password';
    if (typeof window.__LANG__ !== 'undefined' && window.__LANG__.common) {
        showLabel = window.__LANG__.common.show_password || showLabel;
        hideLabel = window.__LANG__.common.hide_password || hideLabel;
    }
    var eyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
    var eyeOffSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';

    function wrapPasswordInput(input) {
        if (input.readOnly || input.getAttribute('data-password-toggle')) return;
        input.setAttribute('data-password-toggle', '1');
        var wrap = document.createElement('span');
        wrap.className = 'password-input-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'password-toggle-btn';
        btn.setAttribute('aria-label', showLabel);
        btn.innerHTML = eyeSvg;
        wrap.appendChild(btn);

        btn.addEventListener('click', function () {
            var isPass = input.type === 'password';
            input.type = isPass ? 'text' : 'password';
            btn.setAttribute('aria-label', isPass ? hideLabel : showLabel);
            btn.innerHTML = isPass ? eyeOffSvg : eyeSvg;
        });
    }

    function run() {
        var list = document.querySelectorAll('input[type="password"]');
        for (var i = 0; i < list.length; i++) wrapPasswordInput(list[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
    // Поддержка динамически добавленных полей (например, в модалках)
    if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function (mutations) {
            for (var m = 0; m < mutations.length; m++) {
                var added = mutations[m].addedNodes;
                for (var n = 0; n < added.length; n++) {
                    var node = added[n];
                    if (node.nodeType === 1) {
                        if (node.tagName === 'INPUT' && node.type === 'password') wrapPasswordInput(node);
                        var pw = node.querySelectorAll && node.querySelectorAll('input[type="password"]');
                        if (pw) for (var k = 0; k < pw.length; k++) wrapPasswordInput(pw[k]);
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
