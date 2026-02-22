<?php
session_start();
require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/locale.php';
initLocale();

// Редирект с дублированного пути на правильный (напр. /sites/messenger/sites/messenger/ -> /sites/messenger/)
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$normalizedUri = normalize_request_uri_path($requestUri);
if ($normalizedUri !== $requestUri && $normalizedUri !== '') {
    header('Location: ' . $normalizedUri, true, 301);
    exit;
}

if (!isLoggedIn()) {
    header('Location: login.php');
    exit;
}

$pageTitle = t('common.app_name');
$additionalCSS = ['assets/css/chat.css'];
$additionalJSModules = ['assets/js/e2ee-gost-vko-loader.js'];
$additionalJS = ['assets/js/e2ee-webauthn-lock.js', 'assets/js/e2ee-keys.js', 'assets/js/e2ee-gost.js', 'assets/js/gestures.js', 'assets/js/chat.js', 'assets/js/calls.js', 'websocket/client.js', 'assets/js/polling.js', 'assets/js/push.js'];

include __DIR__ . '/includes/header.php';
?>

<div class="e2ee-unlock-overlay is-hidden" id="e2eeUnlockOverlay">
    <div class="e2ee-unlock-card">
        <h2 class="e2ee-unlock-title"><?= escape(t('e2ee.unlock_title')) ?></h2>
        <p class="e2ee-unlock-hint"><?= escape(t('e2ee.unlock_hint')) ?></p>
        <p class="e2ee-unlock-error is-hidden" id="e2eeUnlockError"></p>
        <div class="e2ee-unlock-actions">
            <button type="button" class="btn btn-primary e2ee-unlock-bio is-hidden" id="e2eeUnlockBio"><?= escape(t('e2ee.unlock_bio')) ?></button>
            <div class="e2ee-unlock-pin-row">
                <input type="password" id="e2eeUnlockPin" class="e2ee-unlock-pin-input" placeholder="PIN" autocomplete="off" inputmode="numeric" maxlength="32">
                <button type="button" class="btn btn-primary" id="e2eeUnlockPinBtn"><?= escape(t('e2ee.unlock_btn')) ?></button>
            </div>
        </div>
    </div>
</div>

<div class="messenger-container">
    <div class="chats-sidebar">
        <div class="chats-panel" id="chatsPanel">
            <div class="chats-panel-scroll">
                <div class="chats-search">
                    <input type="text" id="chatsSearch" placeholder="<?php echo escape(t('chat.search_chats')); ?>">
                </div>
                <div class="chats-list" id="chatsList">
                    <!-- Список бесед и контактов будет загружен через JavaScript -->
                </div>
            </div>
            <button class="btn-new-chat" id="btnNewChat" title="<?php echo escape(t('chat.new_chat')); ?>" aria-label="<?php echo escape(t('chat.new_chat')); ?>">
                <span class="btn-new-chat-icon" aria-hidden="true">+</span>
            </button>
        </div>
    </div>
    
    <div class="chat-main">
        <div class="chat-empty" id="chatEmpty">
            <p><?php echo escape(t('chat.select_chat')); ?></p>
        </div>
        
        <div class="chat-window is-hidden" id="chatWindow">
            <div class="chat-header" id="chatHeader">
                <!-- Заголовок чата -->
            </div>
            <div class="chat-search-bar is-hidden" id="chatSearchBar" role="search">
                <input type="text" id="chatSearchInput" class="chat-search-input" placeholder="<?= escape(t('chat.search_in_chat')) ?>" autocomplete="off" aria-label="<?= escape(t('chat.search_in_chat')) ?>">
                <span class="chat-search-counter" id="chatSearchCounter" aria-live="polite"></span>
                <button type="button" class="chat-search-btn chat-search-prev" id="chatSearchPrev" aria-label="<?= escape(t('chat.search_prev')) ?>" title="<?= escape(t('chat.search_prev')) ?>">↑</button>
                <button type="button" class="chat-search-btn chat-search-next" id="chatSearchNext" aria-label="<?= escape(t('chat.search_next')) ?>" title="<?= escape(t('chat.search_next')) ?>">↓</button>
                <button type="button" class="chat-search-close" id="chatSearchClose" aria-label="<?= escape(t('chat.search_close')) ?>" title="<?= escape(t('chat.search_close')) ?>">✕</button>
            </div>
            <div class="chat-group-call-plaque is-hidden" id="chatGroupCallPlaque">
                <span class="chat-group-call-plaque-text"><?= escape(t('chat.group_call_in_progress')) ?></span>
                <div class="chat-group-call-plaque-actions">
                    <button type="button" class="btn btn-sm chat-group-call-plaque-join" id="chatGroupCallPlaqueJoin"><?= escape(t('chat.join')) ?></button>
                    <button type="button" class="btn btn-sm chat-group-call-plaque-decline is-hidden" id="chatGroupCallPlaqueDecline"><?= escape(t('calls.decline')) ?></button>
                </div>
            </div>
            <div class="chat-forward-selection-bar is-hidden" id="forwardSelectionBar">
                <button type="button" class="chat-forward-selection-cancel" id="forwardSelectionCancel"><?= escape(t('chat.forward_cancel')) ?></button>
                <button type="button" class="chat-forward-selection-delete" id="forwardSelectionDelete"><?= escape(t('chat.delete_selected')) ?></button>
                <button type="button" class="chat-forward-selection-forward" id="forwardSelectionForward"><?= escape(t('chat.forward_btn')) ?></button>
            </div>
            <div class="chat-messages-wrap">
                <div class="chat-date-floating" id="chatDateFloating" aria-live="polite"><span class="chat-date-floating-inner" id="chatDateFloatingText"></span></div>
                <div class="chat-messages" id="chatMessages">
                    <!-- Сообщения -->
                </div>
                <button type="button" class="chat-scroll-to-bottom is-hidden" id="chatScrollToBottom" aria-label="<?= escape(t('chat.scroll_to_bottom')) ?>" title="<?= escape(t('chat.scroll_to_bottom')) ?>"><svg class="chat-scroll-to-bottom-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><span class="chat-scroll-to-bottom-unread is-hidden" id="chatScrollToBottomUnread" aria-hidden="true">0</span></button>
            </div>
            
            <div class="chat-input-container">
                <div class="chat-input-reply-preview is-hidden" id="chatInputReplyPreview"></div>
                <div class="chat-input-form" id="chatInputForm">
                    <div class="chat-input-wrapper">
                        <div class="chat-input-actions" id="chatInputActions">
                            <button type="button" class="chat-input-actions-trigger" id="chatInputActionsTrigger" title="<?= escape(t('chat.actions')) ?>" aria-expanded="false" aria-haspopup="true">
                                ⋯
                            </button>
                            <div class="chat-input-actions-buttons">
                                <button class="btn-attach" id="btnAttach" title="<?= escape(t('chat.attach_file')) ?>">
                                    <span class="chat-input-actions-btn-icon">📎</span>
                                    <span class="chat-input-actions-btn-label"><?= escape(t('chat.attach_file')) ?></span>
                                </button>
                                <button class="btn-emoji" id="btnEmoji" title="<?= escape(t('chat.emoji_btn')) ?>">
                                    <span class="chat-input-actions-btn-icon">😊</span>
                                    <span class="chat-input-actions-btn-label"><?= escape(t('chat.emoji_btn')) ?></span>
                                </button>
                                <button class="btn-sticker" id="btnSticker" title="<?= escape(t('chat.sticker')) ?>">
                                    <span class="chat-input-actions-btn-icon">🎭</span>
                                    <span class="chat-input-actions-btn-label"><?= escape(t('chat.sticker')) ?></span>
                                </button>
                            </div>
                        </div>
                        <div 
                            id="messageInput" 
                            class="chat-input-contenteditable empty chat-input-contenteditable-desktop"
                            contenteditable="true"
                            data-placeholder="<?php echo escape(t('chat.message_placeholder')); ?>"
                            role="textbox"
                            aria-multiline="true"
                            aria-label="<?php echo escape(t('chat.message_placeholder')); ?>"
                        ></div>
                        <label for="messageInputMobile" class="chat-input-mobile-label chat-input-mobile-only">
                            <textarea 
                                id="messageInputMobile" 
                                class="chat-input-mobile-textarea"
                                placeholder="<?php echo escape(t('chat.message_placeholder')); ?>"
                                rows="1"
                                aria-label="<?php echo escape(t('chat.message_placeholder')); ?>"
                                autocomplete="off"
                                inputmode="text"
                                enterkeyhint="send"
                            ></textarea>
                        </label>
                        <button class="btn-send" id="btnSend" title="<?= escape(t('chat.send_btn')) ?>">
                            ➤
                        </button>
                    </div>
                </div>
                <!-- Эмодзи-панель и панель стикеров — на всю ширину контейнера ввода (как chat-window) -->
                <div class="emoji-panel is-hidden" id="emojiPanel">
                    <div class="emoji-panel-grid" id="emojiPanelGrid"></div>
                    <div class="emoji-panel-toolbar">
                        <button type="button" id="emojiPanelSortByUsage" class="emoji-panel-sort-btn" aria-pressed="false" title="<?= escape(t('chat.emoji_sort_by_usage')) ?>" aria-label="<?= escape(t('chat.emoji_sort_by_usage')) ?>">🕐</button>
                        <input type="text" id="emojiPanelSearch" class="emoji-panel-search" placeholder="<?= escape(t('chat.emoji_search_placeholder')) ?>" autocomplete="off">
                    </div>
                </div>
                <div class="sticker-panel is-hidden" id="stickerPanel">
                    <div class="sticker-panel-grid" id="stickerPanelGrid"></div>
                    <div class="sticker-panel-categories" id="stickerCategories"></div>
                    <div class="sticker-panel-toolbar">
                        <button type="button" id="stickerPanelSortByUsage" class="emoji-panel-sort-btn" aria-pressed="false" title="<?= escape(t('chat.emoji_sort_by_usage')) ?>" aria-label="<?= escape(t('chat.emoji_sort_by_usage')) ?>">🕐</button>
                        <input type="text" id="stickerPanelSearch" class="emoji-panel-search" placeholder="<?= escape(t('chat.emoji_search_placeholder')) ?>" autocomplete="off">
                    </div>
                </div>
                <div class="chat-input-deleted-message is-hidden" id="chatInputDeletedMessage">
                    <?= t('chat.cannot_send_contact_deleted') ?>
                </div>
            </div>
        </div>
    </div>
</div>
<div class="context-menu is-hidden" id="conversationContextMenu">
    <button type="button" class="context-menu-item" id="conversationContextMenuDeleteHide"><?= escape(t('chat.delete_hide_for_me')) ?></button>
    <button type="button" class="context-menu-item context-menu-item-danger" id="conversationContextMenuDeleteForAll"><?= escape(t('chat.delete_for_everyone')) ?></button>
</div>

<!-- Пикер реакций (контекстное меню у сообщения). Список эмодзи заполняется JS по API (по убыванию использования). -->
<div class="reaction-picker is-hidden" id="reactionPicker">
    <div class="reaction-picker-emojis" id="reactionPickerEmojis"></div>
    <button type="button" class="reaction-picker-reply" id="reactionPickerReply">↩️ <?= escape(t('chat.reply')) ?></button>
    <button type="button" class="reaction-picker-forward" id="reactionPickerForward">↗️ <?= escape(t('chat.forward_btn')) ?></button>
    <button type="button" class="reaction-picker-select" id="reactionPickerSelect">☑ <?= escape(t('chat.select')) ?></button>
    <button type="button" class="reaction-picker-save-sticker is-hidden" id="reactionPickerSaveSticker">⭐ <?= escape(t('chat.save_to_stickers')) ?></button>
    <button type="button" class="reaction-picker-delete is-hidden" id="reactionPickerDelete">🗑️ <?= escape(t('chat.delete_message')) ?></button>
</div>

<!-- Модальное окно: выбор чата для пересылки -->
<div class="modal is-hidden" id="modalForwardTo">
    <div class="modal-content modal-content-forward">
        <div class="modal-header">
            <h3 id="modalForwardToTitle"><?= escape(t('chat.forward_to_chat')) ?></h3>
            <button type="button" class="modal-close" id="modalForwardToClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <input type="text" class="forward-to-search" id="forwardToSearch" placeholder="<?= escape(t('chat.search_chats_placeholder')) ?>">
            <div class="forward-to-list" id="forwardToList"></div>
        </div>
    </div>
</div>

<!-- Модальное окно: профиль пользователя (только просмотр) -->
<div class="modal is-hidden" id="modalUserProfile">
    <div class="modal-content modal-content-user-profile">
        <div class="modal-header">
            <h3><?= escape(t('chat.profile_title')) ?></h3>
            <button type="button" class="modal-close" id="modalUserProfileClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <div class="user-profile-view" id="userProfileView">
                <div class="user-profile-view-loading" id="userProfileViewLoading"><?= escape(t('common.loading')) ?></div>
                <div class="user-profile-view-content is-hidden" id="userProfileViewContent">
                    <div class="user-profile-view-avatar" id="userProfileViewAvatar"></div>
                    <h4 class="user-profile-view-title"><?= escape(t('profile.personal')) ?></h4>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label"><?= escape(t('profile.display_name')) ?></span>
                        <span class="user-profile-view-value" id="userProfileViewDisplayName">—</span>
                    </div>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label"><?= escape(t('profile.login')) ?></span>
                        <span class="user-profile-view-value" id="userProfileViewUsername">—</span>
                    </div>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label"><?= escape(t('profile.status')) ?></span>
                        <span class="user-profile-view-value" id="userProfileViewStatus">—</span>
                    </div>
                    <div class="user-profile-view-field">
                        <span class="user-profile-view-label"><?= escape(t('status.was')) ?></span>
                        <span class="user-profile-view-value" id="userProfileViewLastSeen">—</span>
                    </div>
                    <div class="user-profile-view-e2ee is-hidden" id="userProfileViewE2EE" title="<?= escape(t('chat.conversation_e2ee_title')) ?>">🔒 <?= escape(t('e2ee.conversation_protected')) ?></div>
                    <div class="conversation-info-notifications user-profile-notifications is-hidden" id="userProfileConversationNotifications">
                        <label class="profile-toggle-label conversation-notifications-toggle-label">
                            <input type="checkbox" class="conversation-notifications-toggle-input" id="userProfileNotificationsToggle" aria-describedby="userProfileNotificationsStatus">
                            <span class="profile-toggle-slider"></span>
                            <span class="conversation-notifications-text"><?= escape(t('profile.notifications_text')) ?></span>
                        </label>
                        <p class="conversation-notifications-status" id="userProfileNotificationsStatus" aria-live="polite"></p>
                    </div>
                    <div class="user-profile-conversation-actions is-hidden" id="userProfileConversationActions">
                        <button type="button" class="btn btn-secondary btn-sm btn-danger user-profile-action-btn" id="userProfileDeleteConversation"><?= escape(t('chat.delete_conversation')) ?></button>
                    </div>
                </div>
                <div class="user-profile-view-error is-hidden" id="userProfileViewError"></div>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: информация о беседе (только для групп) -->
<div class="modal is-hidden" id="modalGroupInfo">
    <div class="modal-content modal-content-group-info">
        <div class="modal-header">
            <h3 id="groupInfoModalTitle"><?= escape(t('chat.conversation_info')) ?></h3>
            <button type="button" class="modal-close" id="modalGroupInfoClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <div class="group-info-header" id="groupInfoHeader">
                <div class="group-info-avatar" id="groupInfoAvatar"></div>
                <div class="group-info-name" id="groupInfoName"></div>
            </div>
            <div class="conversation-info-e2ee is-hidden" id="groupInfoE2EE" title="<?= escape(t('chat.conversation_e2ee_title')) ?>">🔒 <?= escape(t('chat.chat_e2ee_title')) ?></div>
            <div class="conversation-info-notifications" id="conversationInfoNotifications">
                <label class="profile-toggle-label conversation-notifications-toggle-label">
                    <input type="checkbox" class="conversation-notifications-toggle-input" id="conversationNotificationsToggle" aria-describedby="conversationNotificationsStatus">
                    <span class="profile-toggle-slider"></span>
                    <span class="conversation-notifications-text"><?= escape(t('profile.notifications_text')) ?></span>
                </label>
                <p class="conversation-notifications-status" id="conversationNotificationsStatus" aria-live="polite"></p>
            </div>
            <div class="group-info-members-section" id="groupInfoMembersSection">
                <div class="group-info-members-head">
                    <h4 class="group-info-members-title"><?= escape(t('chat.members_title')) ?> (<span id="groupInfoMemberCount">0</span>)</h4>
                    <button type="button" class="btn btn-secondary btn-sm is-hidden" id="groupInfoAddMembersBtn"><?= escape(t('chat.add_members')) ?></button>
                </div>
                <div class="group-info-members-list" id="groupInfoMembersList"></div>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: Добавить участников в группу -->
<div class="modal is-hidden" id="modalAddGroupMembers">
    <div class="modal-content">
        <div class="modal-header">
            <h3><?= escape(t('chat.add_members_modal')) ?></h3>
            <button type="button" class="modal-close" id="modalAddGroupMembersClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <input type="text" class="new-chat-search" id="addGroupMembersSearch" placeholder="<?= escape(t('chat.search_name')) ?>">
            <div class="new-chat-group-selected" id="addGroupMembersSelected"></div>
            <div class="new-chat-user-list" id="addGroupMembersUserList"></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-primary" id="btnAddGroupMembersConfirm"><?= escape(t('common.add')) ?></button>
                <button type="button" class="btn btn-secondary" id="btnAddGroupMembersCancel"><?= escape(t('common.cancel')) ?></button>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: Новая беседа -->
<div class="modal is-hidden" id="modalNewChat">
    <div class="modal-content">
        <div class="modal-header">
            <h3><?= escape(t('chat.new_conversation')) ?></h3>
            <button class="modal-close" id="modalNewChatClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <div class="chat-type-selector">
                <button class="btn-chat-type active" data-type="private"><?= escape(t('chat.type_private')) ?></button>
                <button class="btn-chat-type" data-type="group"><?= escape(t('chat.type_group')) ?></button>
                <button class="btn-chat-type" data-type="external"><?= escape(t('chat.type_external')) ?></button>
            </div>
            <div id="newChatContent">
                <div class="new-chat-private" id="newChatPrivate">
                    <input type="text" class="new-chat-search" id="newChatUserSearch" placeholder="<?= escape(t('chat.search_name')) ?>">
                    <div class="new-chat-user-list" id="newChatUserList"></div>
                </div>
                <div class="new-chat-group is-hidden" id="newChatGroup">
                    <div class="form-group new-chat-group-name">
                        <label for="newChatGroupName"><?= escape(t('chat.group_name')) ?></label>
                        <input type="text" id="newChatGroupName" class="new-chat-input" placeholder="<?= escape(t('chat.group_name_placeholder')) ?>" maxlength="100">
                    </div>
                    <input type="text" class="new-chat-search" id="newChatGroupUserSearch" placeholder="<?= escape(t('chat.search_members')) ?>">
                    <div class="new-chat-group-selected" id="newChatGroupSelected"></div>
                    <div class="new-chat-user-list new-chat-group-user-list" id="newChatGroupUserList"></div>
                    <button type="button" class="btn btn-primary btn-create-group" id="btnCreateGroup" disabled><?= escape(t('chat.create_group')) ?></button>
                </div>
                <div class="new-chat-external is-hidden" id="newChatExternal">
                    <p class="new-chat-external-hint"><?= escape(t('chat.external_hint')) ?></p>
                    <div class="form-group new-chat-external-name">
                        <label for="newChatExternalName"><?= escape(t('chat.external_name_optional')) ?></label>
                        <input type="text" id="newChatExternalName" class="new-chat-input" placeholder="<?= escape(t('chat.external_name_placeholder')) ?>" maxlength="100">
                    </div>
                    <button type="button" class="btn btn-primary" id="btnCreateExternal"><?= escape(t('chat.create_external_call')) ?></button>
                    <div class="new-chat-external-link-wrap is-hidden" id="newChatExternalLinkWrap">
                        <label class="new-chat-external-link-label"><?= escape(t('chat.external_link_label')) ?></label>
                        <div class="share-link-field-wrap">
                            <input type="text" id="newChatExternalLinkUrl" class="form-control" readonly>
                        </div>
                        <div class="modal-actions share-link-actions">
                            <button type="button" class="btn btn-primary" id="newChatExternalLinkCopy"><?= escape(t('chat.copy_btn')) ?></button>
                            <button type="button" class="btn btn-secondary" id="newChatExternalOpenChat"><?= escape(t('chat.join_call_btn')) ?></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Модальное окно: участники группового звонка -->
<div class="modal is-hidden" id="modalCallParticipants">
    <div class="modal-content modal-content-call-participants">
        <div class="modal-header">
            <h3><?= escape(t('calls.participants_title')) ?></h3>
            <button type="button" class="modal-close" id="modalCallParticipantsClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <div class="call-participants-loading" id="callParticipantsLoading"><?= escape(t('common.loading')) ?></div>
            <div class="call-participants-list is-hidden" id="callParticipantsList"></div>
            <div class="call-participants-error is-hidden" id="callParticipantsError"></div>
        </div>
    </div>
</div>

<!-- Подтверждение удаления чата -->
<div class="modal is-hidden" id="modalDeleteChat">
    <div class="modal-content">
        <div class="modal-header">
            <h3><?= escape(t('chat.delete_chat_title')) ?></h3>
            <button type="button" class="modal-close" id="modalDeleteChatClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <p class="modal-hint"><?= escape(t('chat.delete_chat_hint')) ?></p>
            <div class="modal-actions modal-actions-delete-chat">
                <button type="button" class="btn btn-secondary" id="modalDeleteChatCancel"><?= escape(t('common.cancel')) ?></button>
                <button type="button" class="btn btn-secondary" id="modalDeleteChatHide"><?= escape(t('chat.delete_hide_for_me')) ?></button>
                <button type="button" class="btn btn-danger" id="modalDeleteChatForAll"><?= escape(t('chat.delete_for_everyone')) ?></button>
            </div>
        </div>
    </div>
</div>

<!-- Восстановление ключей E2EE (новое устройство) -->
<div class="modal is-hidden" id="modalE2EERestore">
    <div class="modal-content">
        <div class="modal-header">
            <h3><?= escape(t('e2ee.restore_title')) ?></h3>
            <button type="button" class="modal-close" id="modalE2EERestoreClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <p class="modal-hint" id="modalE2EERestoreHint"><?= escape(t('e2ee.restore_hint')) ?></p>
            <p class="modal-hint modal-error is-hidden" id="modalE2EERestoreError"></p>
            <p class="modal-hint modal-rate-limited is-hidden" id="modalE2EERestoreRateLimited"><?= escape(t('e2ee.restore_rate_limited')) ?></p>
            <div class="modal-form-row">
                <label for="modalE2EERestorePassword"><?= escape(t('e2ee.restore_password_label')) ?></label>
                <input type="password" id="modalE2EERestorePassword" class="modal-input" placeholder="<?= escape(t('e2ee.restore_password_placeholder')) ?>" autocomplete="current-password">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="modalE2EERestoreSkip"><?= escape(t('e2ee.restore_skip')) ?></button>
                <button type="button" class="btn btn-primary" id="modalE2EERestoreSubmit"><?= escape(t('e2ee.restore_submit')) ?></button>
            </div>
        </div>
    </div>
</div>

<!-- Пароль защиты ключей (настройки) -->
<div class="modal is-hidden" id="modalE2EEKeyBackup">
    <div class="modal-content">
        <div class="modal-header">
            <h3><?= escape(t('e2ee.key_backup_modal_title')) ?></h3>
            <button type="button" class="modal-close" id="modalE2EEKeyBackupClose" aria-label="<?= escape(t('common.close')) ?>">&times;</button>
        </div>
        <div class="modal-body">
            <p class="modal-hint"><?= escape(t('e2ee.key_backup_hint')) ?></p>
            <p class="modal-hint modal-error is-hidden" id="modalE2EEKeyBackupError"></p>
            <p class="modal-hint modal-success is-hidden" id="modalE2EEKeyBackupSuccess"></p>
            <div class="modal-form-row">
                <label for="modalE2EEKeyBackupPassword"><?= escape(t('e2ee.new_password')) ?></label>
                <input type="password" id="modalE2EEKeyBackupPassword" class="modal-input" placeholder="<?= escape(t('e2ee.restore_password_label')) ?>" autocomplete="new-password">
            </div>
            <div class="modal-form-row">
                <label for="modalE2EEKeyBackupPassword2"><?= escape(t('e2ee.repeat_password')) ?></label>
                <input type="password" id="modalE2EEKeyBackupPassword2" class="modal-input" placeholder="<?= escape(t('e2ee.repeat_password')) ?>" autocomplete="new-password">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="modalE2EEKeyBackupCancel"><?= escape(t('common.cancel')) ?></button>
                <button type="button" class="btn btn-primary" id="modalE2EEKeyBackupSave"><?= escape(t('e2ee.key_backup_save')) ?></button>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
