<?php
require_once __DIR__ . '/locale.php';
initLocale();
// Не кэшировать HTML: на мобильных иначе подгружаются старые скрипты (старый ?v= в ссылках)
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
?>
<!DOCTYPE html>
<html lang="<?php echo escape(getLocale()); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo isset($pageTitle) ? escape($pageTitle) : t('common.app_name'); ?></title>
    <link rel="icon" type="image/svg+xml" href="<?php echo BASE_URL; ?>assets/favicon.svg">
    <link rel="stylesheet" href="<?php echo BASE_URL; ?>assets/css/main.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css">
    <?php if (isset($additionalCSS)): ?>
        <?php foreach ($additionalCSS as $css): ?>
            <link rel="stylesheet" href="<?php echo BASE_URL . $css; ?>?v=<?php echo file_exists(__DIR__ . '/../' . $css) ? filemtime(__DIR__ . '/../' . $css) : '0'; ?>">
        <?php endforeach; ?>
    <?php endif; ?>
</head>
<body class="<?php echo isLoggedIn() ? 'with-fixed-nav' : ''; ?>" data-user-uuid="<?php echo isLoggedIn() ? escape($_SESSION['user_uuid']) : ''; ?>" data-is-admin="<?php echo (isLoggedIn() && isAdmin()) ? '1' : '0'; ?>" data-show-connection-status="<?php echo getShowConnectionStatusIndicator() ? '1' : '0'; ?>" data-twemoji-enabled="<?php echo (function_exists('getTwemojiEnabled') && getTwemojiEnabled()) ? '1' : '0'; ?>" data-base-url="<?php echo escape(rtrim(BASE_URL, '/')); ?>" data-locale="<?php echo escape(getLocale()); ?>"<?php if (isLoggedIn() && defined('WEBSOCKET_WS_URL')): ?> data-ws-url="<?php echo escape(WEBSOCKET_WS_URL); ?>"<?php endif; ?>>
    <?php if (isLoggedIn()): ?>
        <nav class="main-nav">
            <div class="nav-container">
                <a href="<?php echo BASE_URL; ?>" class="nav-logo"><?php echo escape(t('common.app_name')); ?></a>
                <span id="connectionStatus" class="connection-status" aria-live="polite" title="<?php echo escape(t('profile.connection_status_title')); ?>"></span>
                <?php if (!empty($isDocPage)): ?>
                <button type="button" class="doc-sidebar-toggle nav-doc-toggle" id="docSidebarToggle" aria-label="<?php echo escape(t('common.documentation')); ?>" aria-expanded="false">
                    <span class="doc-sidebar-toggle-icon" aria-hidden="true"></span>
                </button>
                <?php else: ?>
                <div class="nav-user" id="navUserArea" role="button" tabindex="0" title="<?php echo escape(t('common.settings')); ?>">
                    <span class="nav-username" id="navUsername"><?php $cu = getCurrentUser(); echo escape(!empty($cu['display_name']) ? $cu['display_name'] : $cu['username']); ?></span>
                    <div class="nav-avatar-wrap" id="navAvatarWrap">
                        <?php $avatarUrl = $cu['avatar'] ?? ''; ?>
                        <?php if (!empty($avatarUrl)): ?>
                            <img src="<?php echo escape($avatarUrl); ?>" alt="" class="nav-avatar" id="navAvatar">
                        <?php else: ?>
                            <span class="nav-avatar-placeholder" id="navAvatarPlaceholder"><?php echo escape(mb_substr($cu['username'] ?? '', 0, 1)); ?></span>
                        <?php endif; ?>
                    </div>
                </div>
                <?php endif; ?>
            </div>
        </nav>
        <!-- Модальное окно профиля -->
        <div class="modal is-hidden" id="modalProfile">
            <div class="modal-content profile-modal-content">
                <div class="modal-header">
                    <h3><?php echo escape(t('profile.settings')); ?></h3>
                    <button type="button" class="modal-close" id="modalProfileClose">&times;</button>
                </div>
                <div class="modal-body profile-modal-body">
                    <nav class="profile-sidebar" id="profileSidebar">
                        <div class="profile-sidebar-nav">
                            <button type="button" class="profile-nav-item" data-section="language" data-section-title="<?php echo escape(t('common.language')); ?>" id="profileNavLanguage"><?php echo escape(t('common.language')); ?></button>
                            <button type="button" class="profile-nav-item active" data-section="personal" data-section-title="<?php echo escape(t('profile.personal')); ?>" id="profileNavPersonal"><?php echo escape(t('profile.personal')); ?></button>
                            <button type="button" class="profile-nav-item" data-section="contacts" data-section-title="<?php echo escape(t('profile.contacts')); ?>" id="profileNavContacts"><?php echo escape(t('profile.contacts')); ?></button>
                            <button type="button" class="profile-nav-item" data-section="auth" data-section-title="<?php echo escape(t('profile.auth')); ?>" id="profileNavAuth"><?php echo escape(t('profile.auth')); ?></button>
                            <button type="button" class="profile-nav-item" data-section="notifications" data-section-title="<?php echo escape(t('profile.notifications')); ?>" id="profileNavNotifications"><?php echo escape(t('profile.notifications')); ?></button>
                            <button type="button" class="profile-nav-item" data-section="data-protection" data-section-title="<?php echo escape(t('profile.data_protection')); ?>" id="profileNavDataProtection"><?php echo escape(t('profile.data_protection')); ?></button>
                            <button type="button" class="profile-nav-item" data-section="account" data-section-title="<?php echo escape(t('profile.account')); ?>" id="profileNavAccount"><?php echo escape(t('profile.account')); ?></button>
                        </div>
                        <div class="profile-sidebar-footer">
                            <a href="<?php echo BASE_URL; ?>documentation.php" class="profile-doc-link" target="_blank" rel="noopener"><?php echo escape(t('common.documentation')); ?></a>
                            <a href="<?php echo BASE_URL; ?>logout.php" class="btn btn-secondary profile-logout-btn"><?php echo escape(t('profile.logout')); ?></a>
                        </div>
                    </nav>
                    <div class="profile-content" id="profileContent">
                        <div class="profile-content-header">
                            <button type="button" class="profile-section-back" id="profileSectionBack" aria-label="<?php echo escape(t('common.back')); ?>" title="<?php echo escape(t('common.back')); ?>"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
                            <h4 class="profile-section-title profile-section-title-header" id="profileSectionTitleHeader"><?php echo escape(t('profile.personal')); ?></h4>
                        </div>
                        <div class="profile-section" data-section="language" id="profileSectionLanguage">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('common.language')); ?></h4>
                            <div class="form-group">
                                <select id="profileLocale" class="form-control">
                                    <option value="ru"<?php echo getLocale() === 'ru' ? ' selected' : ''; ?>>Русский</option>
                                    <option value="en"<?php echo getLocale() === 'en' ? ' selected' : ''; ?>>English</option>
                                    <option value="sr"<?php echo getLocale() === 'sr' ? ' selected' : ''; ?>>Српски</option>
                                </select>
                            </div>
                            <div class="modal-actions">
                                <button type="button" class="btn btn-primary" id="btnSaveLocale"><?php echo escape(t('common.save')); ?></button>
                            </div>
                            <div class="profile-error is-hidden" id="profileLocaleError"></div>
                        </div>
                        <div class="profile-section active" data-section="personal" id="profileSectionPersonal">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('profile.personal')); ?></h4>
                            <div class="profile-avatar-section">
                                <div class="profile-avatar-row">
                                    <div class="profile-avatar-wrap" id="profileAvatarWrap">
                                        <?php if (!empty($avatarUrl)): ?>
                                            <img src="<?php echo escape($avatarUrl); ?>" alt="" class="profile-avatar-img" id="profileAvatarImg">
                                        <?php else: ?>
                                            <span class="profile-avatar-placeholder" id="profileAvatarPlaceholder"><?php echo escape(mb_substr(!empty($cu['display_name']) ? $cu['display_name'] : ($cu['username'] ?? ''), 0, 1)); ?></span>
                                        <?php endif; ?>
                                    </div>
                                    <div class="profile-avatar-actions" id="profileAvatarActions">
                                        <label class="btn btn-secondary btn-avatar-upload">
                                            <input type="file" id="profileAvatarInput" class="input-file-hidden" accept="image/jpeg,image/png,image/gif,image/webp"> <?php echo escape(t('profile.upload_photo')); ?>
                                        </label>
                                        <button type="button" class="btn btn-secondary btn-avatar-remove <?php echo empty($avatarUrl) ? 'is-hidden' : ''; ?>" id="btnRemoveAvatar"><?php echo escape(t('profile.remove_photo')); ?></button>
                                    </div>
                                </div>
                                <small class="profile-avatar-hint"><?php echo escape(t('profile.avatar_hint')); ?></small>
                            </div>
                            <div class="form-group">
                                <label for="profileDisplayName"><?php echo escape(t('profile.display_name')); ?></label>
                                <input type="text" id="profileDisplayName" class="form-control" placeholder="<?php echo escape(t('profile.display_name_placeholder')); ?>" maxlength="255" autocomplete="name">
                            </div>
                            <div class="form-group">
                                <label for="profileStatus"><?php echo escape(t('profile.status')); ?></label>
                                <input type="text" id="profileStatus" class="form-control" placeholder="<?php echo escape(t('profile.status_placeholder')); ?>" maxlength="255">
                            </div>
                            <div class="modal-actions">
                                <button type="button" class="btn btn-primary" id="btnSavePersonal"><?php echo escape(t('common.save')); ?></button>
                            </div>
                            <div class="profile-error is-hidden" id="profilePersonalError"></div>
                        </div>
                        <div class="profile-section" data-section="contacts" id="profileSectionContacts">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('profile.contacts')); ?></h4>
                            <div class="form-group profile-visible-in-contacts">
                                <label class="profile-toggle-label">
                                    <input type="checkbox" class="profile-notifications-toggle-input" id="profileVisibleInContacts" aria-describedby="profileVisibleInContactsHint">
                                    <span class="profile-toggle-slider"></span>
                                    <span class="profile-visible-in-contacts-text"><?php echo escape(t('profile.visible_in_contacts')); ?></span>
                                </label>
                                <p class="modal-hint" id="profileVisibleInContactsHint"><?php echo escape(t('profile.visible_in_contacts_hint')); ?></p>
                            </div>
                            <div class="modal-actions">
                                <button type="button" class="btn btn-primary" id="btnSaveContacts"><?php echo escape(t('common.save')); ?></button>
                            </div>
                            <div class="profile-error is-hidden" id="profileContactsError"></div>
                        </div>
                        <div class="profile-section" data-section="auth" id="profileSectionAuth">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('profile.auth')); ?></h4>
                            <div class="form-group profile-login-row">
                                <label for="profileNewUsername"><?php echo escape(t('profile.login')); ?></label>
                                <div class="profile-login-input-wrap">
                                    <input type="text" id="profileNewUsername" class="form-control" placeholder="<?php echo escape(t('profile.login_placeholder')); ?>" minlength="3" maxlength="50" autocomplete="username" readonly>
                                    <button type="button" class="btn btn-secondary btn-icon" id="profileLoginEdit" title="<?php echo escape(t('common.edit')); ?>">✎</button>
                                    <span class="profile-login-actions is-hidden" id="profileLoginActions">
                                        <button type="button" class="btn btn-primary" id="btnSaveUsername"><?php echo escape(t('common.save')); ?></button>
                                        <button type="button" class="btn btn-secondary" id="btnCancelUsername"><?php echo escape(t('common.cancel')); ?></button>
                                    </span>
                                </div>
                                <small><?php echo escape(t('profile.login_hint')); ?></small>
                            </div>
                            <div class="profile-error is-hidden" id="profileError"></div>
                            <div class="profile-password-toggle" id="profilePasswordToggle">
                                <button type="button" class="btn btn-secondary" id="profilePasswordToggleBtn"><?php echo escape(t('profile.set_password_btn')); ?></button>
                            </div>
                            <div class="profile-password is-hidden" id="profilePasswordSection">
                                <p class="profile-password-status" id="profilePasswordStatus"><?php echo escape(t('profile.password_not_set')); ?></p>
                                <div class="form-group">
                                    <label for="profileCurrentPassword" id="labelProfileCurrentPassword" class="is-hidden"><?php echo escape(t('profile.current_password')); ?></label>
                                    <input type="password" id="profileCurrentPassword" class="form-control is-hidden" placeholder="<?php echo escape(t('profile.current_password')); ?>" autocomplete="current-password">
                                </div>
                                <div class="form-group">
                                    <label for="profileNewPassword"><?php echo escape(t('profile.new_password')); ?></label>
                                    <input type="password" id="profileNewPassword" class="form-control" placeholder="<?php echo escape(t('profile.new_password_placeholder')); ?>" minlength="6" autocomplete="new-password">
                                </div>
                                <div class="form-group">
                                    <label for="profileNewPasswordConfirm"><?php echo escape(t('profile.confirm_password')); ?></label>
                                    <input type="password" id="profileNewPasswordConfirm" class="form-control" placeholder="<?php echo escape(t('profile.confirm_password_placeholder')); ?>" minlength="6" autocomplete="new-password">
                                </div>
                                <div class="modal-actions">
                                    <button type="button" class="btn btn-primary" id="btnSavePassword"><?php echo escape(t('common.save')); ?></button>
                                    <button type="button" class="btn btn-secondary" id="btnCancelPassword"><?php echo escape(t('common.cancel')); ?></button>
                                </div>
                                <div class="profile-error is-hidden" id="profilePasswordError"></div>
                            </div>
                            <h4 class="profile-section-title"><?php echo escape(t('profile.oauth_connectors')); ?></h4>
                            <p class="modal-hint"><?php echo escape(t('profile.oauth_hint')); ?></p>
                            <div class="profile-connectors" id="profileConnectorsList">
                                <span class="profile-connectors-loading" id="profileConnectorsLoading"><?php echo escape(t('common.loading')); ?></span>
                            </div>
                            <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
                            <div class="profile-connectors-actions">
                                <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
                                <a href="<?php echo BASE_URL; ?>auth/google.php" class="btn btn-oauth btn-oauth-google btn-oauth-small"><img src="<?php echo BASE_URL; ?>assets/img/oauth-google.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?php echo escape(t('profile.link_google')); ?></a>
                                <?php endif; ?>
                                <?php if (!empty(YANDEX_CLIENT_ID)): ?>
                                <a href="<?php echo BASE_URL; ?>auth/yandex.php" class="btn btn-oauth btn-oauth-yandex btn-oauth-small"><img src="<?php echo BASE_URL; ?>assets/img/oauth-yandex.svg" alt="" class="oauth-icon" width="20" height="20" aria-hidden="true"><?php echo escape(t('profile.link_yandex')); ?></a>
                                <?php endif; ?>
                            </div>
                            <?php endif; ?>
                        </div>
                        <div class="profile-section" data-section="notifications" id="profileSectionNotifications">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('profile.notifications')); ?></h4>
                            <div class="profile-notifications" id="profileNotificationsBlock">
                                <label class="profile-notifications-label profile-toggle-label">
                                    <input type="checkbox" class="profile-notifications-toggle-input" id="profileNotificationsToggle" aria-describedby="profileNotificationsStatus">
                                    <span class="profile-toggle-slider"></span>
                                    <span class="profile-notifications-text"><?php echo escape(t('profile.notifications_text')); ?></span>
                                </label>
                                <p class="profile-notifications-status" id="profileNotificationsStatus" aria-live="polite"><?php echo escape(t('common.loading')); ?></p>
                            </div>
                        </div>
                        <div class="profile-section" data-section="data-protection" id="profileSectionDataProtection">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('profile.data_protection')); ?></h4>
                            <div class="profile-persist-keys profile-persist-keys-mb" id="profilePersistKeys">
                                <label class="profile-notifications-label profile-toggle-label">
                                    <input type="checkbox" class="profile-notifications-toggle-input" id="profilePersistKeysCheckbox" autocomplete="off">
                                    <span class="profile-toggle-slider"></span>
                                    <span class="profile-notifications-text"><?php echo escape(t('e2ee.persist_keys')); ?></span>
                                </label>
                                <p class="profile-persist-keys-hint" id="profilePersistKeysHint"><?php echo escape(t('e2ee.persist_keys_hint')); ?></p>
                            </div>
                            <div class="user-profile-device-lock" id="userProfileDeviceLock">
                                <p class="user-profile-view-e2ee"><?php echo escape(t('e2ee.device_lock')); ?></p>
                                <p class="modal-hint"><?php echo escape(t('e2ee.unlock_hint_device')); ?></p>
                                <div id="userProfileDeviceLockInactive">
                                    <button type="button" class="btn btn-secondary btn-sm" id="userProfileDeviceLockEnable"><?php echo escape(t('e2ee.lock_enable')); ?></button>
                                </div>
                                <div id="userProfileDeviceLockActive" class="is-hidden">
                                    <button type="button" class="btn btn-secondary btn-sm" id="userProfileDeviceLockDisable"><?php echo escape(t('e2ee.lock_disable')); ?></button>
                                </div>
                                <div id="userProfileDeviceLockSetPin" class="is-hidden">
                                    <label class="admin-label" for="userProfileDeviceLockPin"><?php echo escape(t('e2ee.pin_min_4')); ?></label>
                                    <input type="password" id="userProfileDeviceLockPin" class="modal-input" placeholder="PIN" autocomplete="new-password">
                                    <input type="password" id="userProfileDeviceLockPin2" class="modal-input modal-input-mt" placeholder="<?php echo escape(t('e2ee.pin_repeat')); ?>" autocomplete="new-password">
                                    <div class="modal-actions modal-actions-mt">
                                        <button type="button" class="btn btn-secondary btn-sm" id="userProfileDeviceLockPinCancel"><?php echo escape(t('common.cancel')); ?></button>
                                        <button type="button" class="btn btn-primary btn-sm" id="userProfileDeviceLockPinSubmit"><?php echo escape(t('e2ee.enable')); ?></button>
                                    </div>
                                </div>
                                <p class="modal-error is-hidden" id="userProfileDeviceLockError"></p>
                            </div>
                            <div class="profile-e2ee-links profile-e2ee-links-mt">
                                <button type="button" class="btn-link btn-link-e2ee" id="profileSettingsKeyBackup" title="<?php echo escape(t('e2ee.key_backup_link_title')); ?>"><?php echo escape(t('e2ee.key_backup_btn')); ?></button>
                                <button type="button" class="btn-link btn-link-e2ee" id="profileSettingsRestoreKeys" title="<?php echo escape(t('e2ee.restore_keys_btn_title')); ?>"><?php echo escape(t('e2ee.restore_keys_btn')); ?></button>
                            </div>
                        </div>
                        <div class="profile-section" data-section="account" id="profileSectionAccount">
                            <h4 class="profile-section-title profile-section-title-desktop"><?php echo escape(t('profile.account')); ?></h4>
                            <div class="profile-delete-history-section">
                                <button type="button" class="btn btn-secondary" id="btnDeleteHistory"><?php echo escape(t('profile.delete_history')); ?></button>
                                <p class="modal-hint"><?php echo escape(t('profile.delete_history_hint')); ?></p>
                            </div>
                            <h4 class="profile-section-title profile-section-danger"><?php echo escape(t('profile.delete_account_title')); ?></h4>
                            <p class="modal-hint"><?php echo escape(t('profile.delete_account_hint')); ?></p>
                            <div class="profile-delete-account" id="profileDeleteAccountSection">
                                <div class="form-group profile-delete-password is-hidden" id="profileDeletePasswordGroup">
                                    <label for="profileDeletePassword"><?php echo escape(t('profile.delete_password_label')); ?></label>
                                    <input type="password" id="profileDeletePassword" class="form-control" placeholder="<?php echo escape(t('login.password')); ?>" autocomplete="current-password">
                                </div>
                                <div class="profile-error is-hidden" id="profileDeleteError"></div>
                                <button type="button" class="btn btn-danger" id="btnDeleteAccount"><?php echo escape(t('profile.delete_account_btn')); ?></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- Модальное окно обрезки аватара -->
        <div class="modal modal-crop is-hidden" id="modalAvatarCrop">
            <div class="modal-content modal-crop-content">
                <div class="modal-header">
                    <h3><?php echo escape(t('profile.crop_avatar')); ?></h3>
                    <button type="button" class="modal-close" id="modalAvatarCropClose">&times;</button>
                </div>
                <div class="modal-body modal-crop-body">
                    <div class="crop-container" id="cropContainer">
                        <img id="cropImage" src="" alt="">
                    </div>
                    <div class="crop-actions">
                        <button type="button" class="btn btn-secondary" id="btnCropCancel"><?php echo escape(t('common.cancel')); ?></button>
                        <button type="button" class="btn btn-primary" id="btnCropApply"><?php echo escape(t('common.apply')); ?></button>
                    </div>
                    <div class="profile-error crop-error is-hidden" id="cropError"></div>
                </div>
            </div>
        </div>
    <?php endif; ?>
