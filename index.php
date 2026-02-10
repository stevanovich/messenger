<?php
session_start();
require_once __DIR__ . '/includes/functions.php';

if (!isLoggedIn()) {
    header('Location: login.php');
    exit;
}

$pageTitle = 'Мессенджер';
$additionalCSS = ['assets/css/chat.css'];
$additionalJS = ['assets/js/e2ee-webauthn-lock.js', 'assets/js/e2ee-keys.js', 'assets/js/gestures.js', 'assets/js/chat.js', 'assets/js/calls.js', 'websocket/client.js', 'assets/js/polling.js', 'assets/js/push.js'];

include __DIR__ . '/includes/header.php';
?>

<!-- Экран разблокировки (WebAuthn / PIN) — п. 5.3 -->
<div class="e2ee-unlock-overlay" id="e2eeUnlockOverlay" style="display: none;">
    <div class="e2ee-unlock-card">
        <h2 class="e2ee-unlock-title">Разблокировать чаты</h2>
        <p class="e2ee-unlock-hint">Введите PIN или используйте отпечаток / Face ID</p>
        <p class="e2ee-unlock-error" id="e2eeUnlockError" style="display: none;"></p>
        <div class="e2ee-unlock-actions">
            <button type="button" class="btn btn-primary e2ee-unlock-bio" id="e2eeUnlockBio" style="display: none;">Отпечаток / Face ID</button>
            <div class="e2ee-unlock-pin-row">
                <input type="password" id="e2eeUnlockPin" class="e2ee-unlock-pin-input" placeholder="PIN" autocomplete="off" inputmode="numeric" maxlength="32">
                <button type="button" class="btn btn-primary" id="e2eeUnlockPinBtn">Разблокировать</button>
            </div>
        </div>
    </div>
</div>

<div class="messenger-container">
    <div class="chats-sidebar">
        <div class="sidebar-tabs">
            <button class="sidebar-tab active" id="tabChats" data-tab="chats">Беседы</button>
            <button class="sidebar-tab" id="tabContacts" data-tab="contacts">Контакты</button>
        </div>
        <div class="chats-panel" id="chatsPanel">
            <div class="chats-panel-scroll">
                <div class="chats-search">
                    <input type="text" id="chatsSearch" placeholder="Поиск чатов...">
                </div>
                <div class="chats-list" id="chatsList">
                    <!-- Список чатов будет загружен через JavaScript -->
                </div>
            </div>
            <button class="btn-new-chat" id="btnNewChat" title="Новая беседа">
                Новая беседа
            </button>
        </div>
        <div class="contacts-panel" id="contactsPanel" style="display: none;">
            <div class="contacts-panel-scroll">
                <div class="contacts-search">
                    <input type="text" id="contactsSearch" placeholder="Поиск контактов...">
                </div>
                <div class="contacts-list" id="contactsList">
                    <!-- Список контактов будет загружен через JavaScript -->
                </div>
            </div>
        </div>
    </div>
    
    <div class="chat-main">
        <div class="chat-empty" id="chatEmpty">
            <p>Выберите чат для начала общения</p>
        </div>
        
        <div class="chat-window" id="chatWindow" style="display: none;">
            <div class="chat-header" id="chatHeader">
                <!-- Заголовок чата -->
            </div>
            <div class="chat-group-call-plaque" id="chatGroupCallPlaque" style="display: none;">
                <span class="chat-group-call-plaque-text">Идёт групповой звонок</span>
                <div class="chat-group-call-plaque-actions">
                    <button type="button" class="btn btn-sm chat-group-call-plaque-join" id="chatGroupCallPlaqueJoin">Присоединиться</button>
                    <button type="button" class="btn btn-sm chat-group-call-plaque-decline" id="chatGroupCallPlaqueDecline" style="display: none;">Отклонить</button>
                </div>
            </div>
            <div class="chat-forward-selection-bar" id="forwardSelectionBar" style="display: none;">
                <button type="button" class="chat-forward-selection-cancel" id="forwardSelectionCancel">Отмена</button>
                <button type="button" class="chat-forward-selection-forward" id="forwardSelectionForward">Переслать</button>
            </div>
            <div class="chat-messages-wrap">
                <div class="chat-date-floating" id="chatDateFloating" aria-live="polite"><span class="chat-date-floating-inner" id="chatDateFloatingText"></span></div>
                <div class="chat-messages" id="chatMessages">
                    <!-- Сообщения -->
                </div>
            </div>
            
            <div class="chat-input-container">
                <div class="chat-input-reply-preview" id="chatInputReplyPreview" style="display: none;"></div>
                <div class="chat-input-form" id="chatInputForm">
                    <div class="chat-input-actions" id="chatInputActions">
                        <button type="button" class="chat-input-actions-trigger" id="chatInputActionsTrigger" title="Действия" aria-expanded="false" aria-haspopup="true">
                            ⋯
                        </button>
                        <div class="chat-input-actions-buttons">
                            <button class="btn-attach" id="btnAttach" title="Прикрепить файл">
                                📎
                            </button>
                            <button class="btn-emoji" id="btnEmoji" title="Эмодзи">
                                😊
                            </button>
                            <button class="btn-sticker" id="btnSticker" title="Стикер">
                                🎭
                            </button>
                        </div>
                    </div>
                    <div class="chat-input-wrapper">
                        <div 
                            id="messageInput" 
                            class="chat-input-contenteditable empty"
                            contenteditable="true"
                            data-placeholder="Введите сообщение..."
                            role="textbox"
                            aria-multiline="true"
                            aria-label="Введите сообщение"
                        ></div>
                    </div>
                    <button class="btn-send" id="btnSend" title="Отправить">
                        ➤
                    </button>
                </div>
                <!-- Эмодзи-панель и панель стикеров — на всю ширину контейнера ввода (как chat-window) -->
                <div class="emoji-panel" id="emojiPanel" style="display: none;">
                    <div class="emoji-panel-grid" id="emojiPanelGrid"></div>
                </div>
                <div class="sticker-panel" id="stickerPanel" style="display: none;">
                    <div class="sticker-panel-grid" id="stickerPanelGrid"></div>
                    <div class="sticker-panel-categories" id="stickerCategories"></div>
                </div>
                <div class="chat-input-deleted-message" id="chatInputDeletedMessage" style="display: none;">
                    Невозможно отправить сообщение: собеседник удалён.
                </div>
            </div>
        </div>
    </div>
</div>
<!-- Контекстное меню беседы (удалить беседу) -->
<div class="context-menu" id="conversationContextMenu" style="display: none;">
    <button type="button" class="context-menu-item context-menu-item-danger" id="conversationContextMenuDelete">Удалить беседу</button>
</div>

<!-- Пикер реакций (контекстное меню у сообщения). Список эмодзи заполняется JS по API (по убыванию использования). -->
<div class="reaction-picker" id="reactionPicker" style="display: none;">
    <div class="reaction-picker-emojis" id="reactionPickerEmojis"></div>
    <button type="button" class="reaction-picker-reply" id="reactionPickerReply">↩️ Ответить</button>
    <button type="button" class="reaction-picker-forward" id="reactionPickerForward">↗️ Переслать</button>
    <button type="button" class="reaction-picker-select" id="reactionPickerSelect">☑ Выбрать</button>
    <button type="button" class="reaction-picker-save-sticker" id="reactionPickerSaveSticker" style="display: none;">⭐ Сохранить в стикеры</button>
    <button type="button" class="reaction-picker-delete" id="reactionPickerDelete" style="display: none;">🗑️ Удалить сообщение</button>
</div>

<!-- Модальное окно: выбор чата для пересылки -->
<div class="modal" id="modalForwardTo" style="display: none;">
    <div class="modal-content modal-content-forward">
        <div class="modal-header">
            <h3 id="modalForwardToTitle">Переслать в чат</h3>
            <button type="button" class="modal-close" id="modalForwardToClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <input type="text" class="forward-to-search" id="forwardToSearch" placeholder="Поиск чатов...">
            <div class="forward-to-list" id="forwardToList"></div>
        </div>
    </div>
</div>

<!-- Модальное окно: профиль пользователя (только просмотр) -->
<div class="modal" id="modalUserProfile" style="display: none;">
    <div class="modal-content modal-content-user-profile">
        <div class="modal-header">
            <h3>Профиль</h3>
            <button type="button" class="modal-close" id="modalUserProfileClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <div class="user-profile-view" id="userProfileView">
                <div class="user-profile-view-loading" id="userProfileViewLoading">Загрузка…</div>
                <div class="user-profile-view-content" id="userProfileViewContent" style="display: none;">
                    <div class="user-profile-view-avatar" id="userProfileViewAvatar"></div>
                    <h4 class="user-profile-view-title">Личная информация</h4>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label">Отображаемое имя</span>
                        <span class="user-profile-view-value" id="userProfileViewDisplayName">—</span>
                    </div>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label">Логин</span>
                        <span class="user-profile-view-value" id="userProfileViewUsername">—</span>
                    </div>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label">Статус</span>
                        <span class="user-profile-view-value" id="userProfileViewStatus">—</span>
                    </div>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label">Был(а) в сети</span>
                        <span class="user-profile-view-value" id="userProfileViewLastSeen">—</span>
                    </div>
                    <div class="user-profile-view-e2ee" id="userProfileViewE2EE" style="display: none;" title="Переписка защищена end-to-end шифрованием">🔒 Переписка защищена E2EE</div>
                    <div class="conversation-info-notifications user-profile-notifications" id="userProfileConversationNotifications" style="display: none;">
                        <label class="profile-toggle-label conversation-notifications-toggle-label">
                            <input type="checkbox" class="conversation-notifications-toggle-input" id="userProfileNotificationsToggle" aria-describedby="userProfileNotificationsStatus">
                            <span class="profile-toggle-slider"></span>
                            <span class="conversation-notifications-text">Уведомления для этого чата</span>
                        </label>
                        <p class="conversation-notifications-status" id="userProfileNotificationsStatus" aria-live="polite"></p>
                    </div>
                </div>
                <div class="user-profile-view-error" id="userProfileViewError" style="display: none;"></div>
            </div>
            <div class="user-profile-device-lock" id="userProfileDeviceLock" style="display: none;">
                <p class="user-profile-view-e2ee">Блокировка на этом устройстве</p>
                <p class="modal-hint">Разблокировка по отпечатку / Face ID или PIN.</p>
                <div id="userProfileDeviceLockInactive">
                    <button type="button" class="btn btn-secondary btn-sm" id="userProfileDeviceLockEnable">Включить блокировку</button>
                </div>
                <div id="userProfileDeviceLockActive" style="display: none;">
                    <button type="button" class="btn btn-secondary btn-sm" id="userProfileDeviceLockDisable">Выключить блокировку</button>
                </div>
                <div id="userProfileDeviceLockSetPin" style="display: none;">
                    <label class="admin-label" for="userProfileDeviceLockPin">PIN (не менее 4 символов)</label>
                    <input type="password" id="userProfileDeviceLockPin" class="modal-input" placeholder="PIN" autocomplete="new-password">
                    <input type="password" id="userProfileDeviceLockPin2" class="modal-input" placeholder="Повторите PIN" autocomplete="new-password" style="margin-top: 0.5rem;">
                    <div class="modal-actions" style="margin-top: 0.75rem;">
                        <button type="button" class="btn btn-secondary btn-sm" id="userProfileDeviceLockPinCancel">Отмена</button>
                        <button type="button" class="btn btn-primary btn-sm" id="userProfileDeviceLockPinSubmit">Включить</button>
                    </div>
                </div>
                <p class="modal-error" id="userProfileDeviceLockError" style="display: none;"></p>
            </div>
            <div class="sidebar-footer modal-profile-footer" id="userProfileModalFooter" style="display: none;">
                <button type="button" class="btn-link btn-link-e2ee" id="btnE2EEKeyBackup" title="Пароль для восстановления ключей на новом устройстве">Защита ключей</button>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: информация о беседе (только для групп) -->
<div class="modal" id="modalGroupInfo" style="display: none;">
    <div class="modal-content modal-content-group-info">
        <div class="modal-header">
            <h3 id="groupInfoModalTitle">Информация о беседе</h3>
            <button type="button" class="modal-close" id="modalGroupInfoClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <div class="group-info-header" id="groupInfoHeader">
                <div class="group-info-avatar" id="groupInfoAvatar"></div>
                <div class="group-info-name" id="groupInfoName"></div>
            </div>
            <div class="conversation-info-e2ee" id="groupInfoE2EE" style="display: none;" title="Чат защищён end-to-end шифрованием">🔒 Чат защищён E2EE</div>
            <div class="conversation-info-notifications" id="conversationInfoNotifications">
                <label class="profile-toggle-label conversation-notifications-toggle-label">
                    <input type="checkbox" class="conversation-notifications-toggle-input" id="conversationNotificationsToggle" aria-describedby="conversationNotificationsStatus">
                    <span class="profile-toggle-slider"></span>
                    <span class="conversation-notifications-text">Уведомления для этого чата</span>
                </label>
                <p class="conversation-notifications-status" id="conversationNotificationsStatus" aria-live="polite"></p>
            </div>
            <div class="group-info-members-section" id="groupInfoMembersSection">
                <div class="group-info-members-head">
                    <h4 class="group-info-members-title">Участники (<span id="groupInfoMemberCount">0</span>)</h4>
                    <button type="button" class="btn btn-secondary btn-sm" id="groupInfoAddMembersBtn" style="display: none;">Добавить участников</button>
                </div>
                <div class="group-info-members-list" id="groupInfoMembersList"></div>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: Добавить участников в группу -->
<div class="modal" id="modalAddGroupMembers" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Добавить участников</h3>
            <button type="button" class="modal-close" id="modalAddGroupMembersClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <input type="text" class="new-chat-search" id="addGroupMembersSearch" placeholder="Поиск по имени...">
            <div class="new-chat-group-selected" id="addGroupMembersSelected"></div>
            <div class="new-chat-user-list" id="addGroupMembersUserList"></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-primary" id="btnAddGroupMembersConfirm">Добавить</button>
                <button type="button" class="btn btn-secondary" id="btnAddGroupMembersCancel">Отмена</button>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: Новая беседа -->
<div class="modal" id="modalNewChat" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Новая беседа</h3>
            <button class="modal-close" id="modalNewChatClose">&times;</button>
        </div>
        <div class="modal-body">
            <div class="chat-type-selector">
                <button class="btn-chat-type active" data-type="private">Личная</button>
                <button class="btn-chat-type" data-type="group">Групповая</button>
                <button class="btn-chat-type" data-type="external">Внешняя</button>
            </div>
            <div id="newChatContent">
                <div class="new-chat-private" id="newChatPrivate">
                    <input type="text" class="new-chat-search" id="newChatUserSearch" placeholder="Поиск по имени...">
                    <div class="new-chat-user-list" id="newChatUserList"></div>
                </div>
                <div class="new-chat-group" id="newChatGroup" style="display: none;">
                    <div class="form-group new-chat-group-name">
                        <label for="newChatGroupName">Название группы</label>
                        <input type="text" id="newChatGroupName" class="new-chat-input" placeholder="Введите название группы..." maxlength="100">
                    </div>
                    <input type="text" class="new-chat-search" id="newChatGroupUserSearch" placeholder="Поиск участников...">
                    <div class="new-chat-group-selected" id="newChatGroupSelected"></div>
                    <div class="new-chat-user-list new-chat-group-user-list" id="newChatGroupUserList"></div>
                    <button type="button" class="btn btn-primary btn-create-group" id="btnCreateGroup" disabled>Создать группу</button>
                </div>
                <div class="new-chat-external" id="newChatExternal" style="display: none;">
                    <p class="new-chat-external-hint">Создайте звонок и получите ссылку. По ссылке можно присоединиться: с аккаунтом — войти и присоединиться; без аккаунта — ввести имя и войти как гость. Аудио и видео участники включают при подключении к звонку.</p>
                    <div class="form-group new-chat-external-name">
                        <label for="newChatExternalName">Название (необязательно)</label>
                        <input type="text" id="newChatExternalName" class="new-chat-input" placeholder="Например: Созвон с клиентом" maxlength="100">
                    </div>
                    <button type="button" class="btn btn-primary" id="btnCreateExternal">Создать внешний звонок</button>
                    <div class="new-chat-external-link-wrap" id="newChatExternalLinkWrap" style="display: none;">
                        <label class="new-chat-external-link-label">Ссылка для присоединения к звонку</label>
                        <div class="share-link-field-wrap">
                            <input type="text" id="newChatExternalLinkUrl" class="form-control" readonly>
                        </div>
                        <div class="modal-actions share-link-actions">
                            <button type="button" class="btn btn-primary" id="newChatExternalLinkCopy">Копировать</button>
                            <button type="button" class="btn btn-secondary" id="newChatExternalOpenChat">Присоединиться к звонку</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: участники группового звонка -->
<div class="modal" id="modalCallParticipants" style="display: none;">
    <div class="modal-content modal-content-call-participants">
        <div class="modal-header">
            <h3>Участники звонка</h3>
            <button type="button" class="modal-close" id="modalCallParticipantsClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <div class="call-participants-loading" id="callParticipantsLoading">Загрузка…</div>
            <div class="call-participants-list" id="callParticipantsList" style="display: none;"></div>
            <div class="call-participants-error" id="callParticipantsError" style="display: none;"></div>
        </div>
    </div>
</div>

<!-- Подтверждение удаления чата -->
<div class="modal" id="modalDeleteChat" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Удалить чат?</h3>
            <button type="button" class="modal-close" id="modalDeleteChatClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <p class="modal-hint">Этот чат будет удалён. Это действие нельзя отменить.</p>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="modalDeleteChatCancel">Отмена</button>
                <button type="button" class="btn btn-danger" id="modalDeleteChatConfirm">Удалить</button>
            </div>
        </div>
    </div>
</div>

<!-- Восстановление ключей E2EE (новое устройство) -->
<div class="modal" id="modalE2EERestore" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Восстановление переписок</h3>
            <button type="button" class="modal-close" id="modalE2EERestoreClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <p class="modal-hint" id="modalE2EERestoreHint">На этом устройстве нет ключей шифрования. Введите пароль защиты ключей, чтобы восстановить доступ к перепискам.</p>
            <p class="modal-hint modal-error" id="modalE2EERestoreError" style="display: none;"></p>
            <p class="modal-hint modal-rate-limited" id="modalE2EERestoreRateLimited" style="display: none;">Попытки восстановления временно заблокированы. Попробуйте позже.</p>
            <div class="modal-form-row">
                <label for="modalE2EERestorePassword">Пароль</label>
                <input type="password" id="modalE2EERestorePassword" class="modal-input" placeholder="Пароль защиты ключей" autocomplete="current-password">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="modalE2EERestoreSkip">Пропустить (новые ключи)</button>
                <button type="button" class="btn btn-primary" id="modalE2EERestoreSubmit">Восстановить</button>
            </div>
        </div>
    </div>
</div>

<!-- Пароль защиты ключей (настройки) -->
<div class="modal" id="modalE2EEKeyBackup" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Защита ключей</h3>
            <button type="button" class="modal-close" id="modalE2EEKeyBackupClose" aria-label="Закрыть">&times;</button>
        </div>
        <div class="modal-body">
            <p class="modal-hint">Пароль нужен только для восстановления переписок на новом устройстве. Обычная работа без него.</p>
            <p class="modal-hint modal-error" id="modalE2EEKeyBackupError" style="display: none;"></p>
            <p class="modal-hint modal-success" id="modalE2EEKeyBackupSuccess" style="display: none;"></p>
            <div class="modal-form-row">
                <label for="modalE2EEKeyBackupPassword">Новый пароль</label>
                <input type="password" id="modalE2EEKeyBackupPassword" class="modal-input" placeholder="Пароль" autocomplete="new-password">
            </div>
            <div class="modal-form-row">
                <label for="modalE2EEKeyBackupPassword2">Повторите пароль</label>
                <input type="password" id="modalE2EEKeyBackupPassword2" class="modal-input" placeholder="Повторите пароль" autocomplete="new-password">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="modalE2EEKeyBackupCancel">Отмена</button>
                <button type="button" class="btn btn-primary" id="modalE2EEKeyBackupSave">Сохранить резервную копию</button>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
