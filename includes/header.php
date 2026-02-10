<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo isset($pageTitle) ? escape($pageTitle) : 'Мессенджер'; ?></title>
    <link rel="icon" type="image/svg+xml" href="<?php echo BASE_URL; ?>assets/favicon.svg">
    <link rel="stylesheet" href="<?php echo BASE_URL; ?>assets/css/main.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css">
    <?php if (isset($additionalCSS)): ?>
        <?php foreach ($additionalCSS as $css): ?>
            <link rel="stylesheet" href="<?php echo BASE_URL . $css; ?>">
        <?php endforeach; ?>
    <?php endif; ?>
</head>
<body data-user-uuid="<?php echo isLoggedIn() ? escape($_SESSION['user_uuid']) : ''; ?>" data-is-admin="<?php echo (isLoggedIn() && isAdmin()) ? '1' : '0'; ?>" data-show-connection-status="<?php echo getShowConnectionStatusIndicator() ? '1' : '0'; ?>" data-base-url="<?php echo escape(rtrim(BASE_URL, '/')); ?>"<?php if (isLoggedIn() && defined('WEBSOCKET_WS_URL')): ?> data-ws-url="<?php echo escape(WEBSOCKET_WS_URL); ?>"<?php endif; ?>>
    <?php if (isLoggedIn()): ?>
        <nav class="main-nav">
            <div class="nav-container">
                <a href="<?php echo BASE_URL; ?>" class="nav-logo">Мессенджер</a>
                <span id="connectionStatus" class="connection-status" aria-live="polite" title="Режим обновления чата"></span>
                <div class="nav-user" id="navUserArea" role="button" tabindex="0" title="Настройки">
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
            </div>
        </nav>
        <!-- Модальное окно профиля -->
        <div class="modal" id="modalProfile" style="display: none;">
            <div class="modal-content profile-modal-content">
                <div class="modal-header">
                    <h3>Настройки</h3>
                    <button type="button" class="modal-close" id="modalProfileClose">&times;</button>
                </div>
                <div class="modal-body profile-modal-body">
                    <nav class="profile-sidebar" id="profileSidebar">
                        <div class="profile-sidebar-nav">
                            <button type="button" class="profile-nav-item active" data-section="personal" id="profileNavPersonal">Личная информация</button>
                            <button type="button" class="profile-nav-item" data-section="contacts" id="profileNavContacts">Контакты</button>
                            <button type="button" class="profile-nav-item" data-section="auth" id="profileNavAuth">Аутентификация</button>
                            <button type="button" class="profile-nav-item" data-section="notifications" id="profileNavNotifications">Уведомления</button>
                            <button type="button" class="profile-nav-item" data-section="account" id="profileNavAccount">Управление учётной записью</button>
                        </div>
                        <div class="profile-sidebar-footer">
                            <a href="<?php echo BASE_URL; ?>logout.php" class="btn btn-secondary profile-logout-btn">Выйти из аккаунта</a>
                        </div>
                    </nav>
                    <div class="profile-content" id="profileContent">
                        <div class="profile-content-header">
                            <button type="button" class="profile-section-back" id="profileSectionBack" aria-label="Назад" title="Назад"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
                            <h4 class="profile-section-title profile-section-title-header" id="profileSectionTitleHeader">Личная информация</h4>
                        </div>
                        <div class="profile-section active" data-section="personal" id="profileSectionPersonal">
                            <h4 class="profile-section-title profile-section-title-desktop">Личная информация</h4>
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
                                            <input type="file" id="profileAvatarInput" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none"> Загрузить фото
                                        </label>
                                        <button type="button" class="btn btn-secondary btn-avatar-remove" id="btnRemoveAvatar" style="<?php echo empty($avatarUrl) ? 'display:none' : ''; ?>">Удалить фото</button>
                                    </div>
                                </div>
                                <small class="profile-avatar-hint">JPEG, PNG, GIF или WebP, до 2 МБ</small>
                            </div>
                            <div class="form-group">
                                <label for="profileDisplayName">Отображаемое имя</label>
                                <input type="text" id="profileDisplayName" class="form-control" placeholder="Произвольное имя для отображения в чатах" maxlength="255" autocomplete="name">
                            </div>
                            <div class="form-group">
                                <label for="profileStatus">Статус</label>
                                <input type="text" id="profileStatus" class="form-control" placeholder="Произвольный статус" maxlength="255">
                            </div>
                            <div class="modal-actions">
                                <button type="button" class="btn btn-primary" id="btnSavePersonal">Сохранить</button>
                            </div>
                            <div class="profile-error" id="profilePersonalError" style="display: none;"></div>
                        </div>
                        <div class="profile-section" data-section="contacts" id="profileSectionContacts">
                            <h4 class="profile-section-title profile-section-title-desktop">Контакты</h4>
                            <div class="form-group profile-visible-in-contacts">
                                <label class="profile-toggle-label">
                                    <input type="checkbox" class="profile-notifications-toggle-input" id="profileVisibleInContacts" aria-describedby="profileVisibleInContactsHint">
                                    <span class="profile-toggle-slider"></span>
                                    <span class="profile-visible-in-contacts-text">Показывать меня в общем списке контактов</span>
                                </label>
                                <p class="modal-hint" id="profileVisibleInContactsHint">Если выключено, вас не увидят в списке контактов и по поиску. Начать диалог смогут только те, у кого уже есть переписка с вами.</p>
                            </div>
                            <div class="modal-actions">
                                <button type="button" class="btn btn-primary" id="btnSaveContacts">Сохранить</button>
                            </div>
                            <div class="profile-error" id="profileContactsError" style="display: none;"></div>
                        </div>
                        <div class="profile-section" data-section="auth" id="profileSectionAuth">
                            <h4 class="profile-section-title profile-section-title-desktop">Аутентификация</h4>
                            <div class="form-group profile-login-row">
                                <label for="profileNewUsername">Логин</label>
                                <div class="profile-login-input-wrap">
                                    <input type="text" id="profileNewUsername" class="form-control" placeholder="Введите логин" minlength="3" maxlength="50" autocomplete="username" readonly>
                                    <button type="button" class="btn btn-secondary btn-icon" id="profileLoginEdit" title="Редактировать">✎</button>
                                    <span class="profile-login-actions" id="profileLoginActions" style="display: none;">
                                        <button type="button" class="btn btn-primary" id="btnSaveUsername">Сохранить</button>
                                        <button type="button" class="btn btn-secondary" id="btnCancelUsername">Отмена</button>
                                    </span>
                                </div>
                                <small>Только буквы, цифры и подчеркивание (3-50 символов)</small>
                            </div>
                            <div class="profile-error" id="profileError" style="display: none;"></div>
                            <div class="profile-password-toggle" id="profilePasswordToggle">
                                <button type="button" class="btn btn-secondary" id="profilePasswordToggleBtn">Задать/Сменить пароль</button>
                            </div>
                            <div class="profile-password" id="profilePasswordSection" style="display: none;">
                                <p class="profile-password-status" id="profilePasswordStatus">Пароль не задан. Задайте пароль, чтобы входить по логину.</p>
                                <div class="form-group">
                                    <label for="profileCurrentPassword" id="labelProfileCurrentPassword" style="display: none;">Текущий пароль</label>
                                    <input type="password" id="profileCurrentPassword" class="form-control" placeholder="Текущий пароль" style="display: none;" autocomplete="current-password">
                                </div>
                                <div class="form-group">
                                    <label for="profileNewPassword">Новый пароль</label>
                                    <input type="password" id="profileNewPassword" class="form-control" placeholder="Новый пароль" minlength="6" autocomplete="new-password">
                                </div>
                                <div class="form-group">
                                    <label for="profileNewPasswordConfirm">Подтверждение пароля</label>
                                    <input type="password" id="profileNewPasswordConfirm" class="form-control" placeholder="Повторите пароль" minlength="6" autocomplete="new-password">
                                </div>
                                <div class="modal-actions">
                                    <button type="button" class="btn btn-primary" id="btnSavePassword">Сохранить</button>
                                    <button type="button" class="btn btn-secondary" id="btnCancelPassword">Отмена</button>
                                </div>
                                <div class="profile-error" id="profilePasswordError" style="display: none;"></div>
                            </div>
                            <h4 class="profile-section-title">OAuth коннекторы</h4>
                            <p class="modal-hint">Вход через Google или Яндекс. Можно привязать несколько способов.</p>
                            <div class="profile-connectors" id="profileConnectorsList">
                                <span class="profile-connectors-loading" id="profileConnectorsLoading">Загрузка…</span>
                            </div>
                            <?php if (!empty(GOOGLE_CLIENT_ID) || !empty(YANDEX_CLIENT_ID)): ?>
                            <div class="profile-connectors-actions">
                                <?php if (!empty(GOOGLE_CLIENT_ID)): ?>
                                <a href="<?php echo BASE_URL; ?>auth/google.php" class="btn btn-oauth btn-oauth-google btn-oauth-small">Привязать Google</a>
                                <?php endif; ?>
                                <?php if (!empty(YANDEX_CLIENT_ID)): ?>
                                <a href="<?php echo BASE_URL; ?>auth/yandex.php" class="btn btn-oauth btn-oauth-yandex btn-oauth-small">Привязать Яндекс</a>
                                <?php endif; ?>
                            </div>
                            <?php endif; ?>
                        </div>
                        <div class="profile-section" data-section="notifications" id="profileSectionNotifications">
                            <h4 class="profile-section-title profile-section-title-desktop">Уведомления</h4>
                            <div class="profile-notifications" id="profileNotificationsBlock">
                                <label class="profile-notifications-label profile-toggle-label">
                                    <input type="checkbox" class="profile-notifications-toggle-input" id="profileNotificationsToggle" aria-describedby="profileNotificationsStatus">
                                    <span class="profile-toggle-slider"></span>
                                    <span class="profile-notifications-text">Уведомления о новых сообщениях</span>
                                </label>
                                <p class="profile-notifications-status" id="profileNotificationsStatus" aria-live="polite">Загрузка…</p>
                            </div>
                        </div>
                        <div class="profile-section" data-section="account" id="profileSectionAccount">
                            <h4 class="profile-section-title profile-section-title-desktop">Управление учётной записью</h4>
                            <div class="profile-delete-history-section">
                                <button type="button" class="btn btn-secondary" id="btnDeleteHistory">Удалить историю</button>
                                <p class="modal-hint">Заменит вас на «неизвестный автор» во всех сообщениях.</p>
                            </div>
                            <h4 class="profile-section-title profile-section-danger">Удалить аккаунт</h4>
                            <p class="modal-hint">Это действие необратимо. Будут удалены все ваши данные: профиль, переписки, сообщения.</p>
                            <div class="profile-delete-account" id="profileDeleteAccountSection">
                                <div class="form-group profile-delete-password" id="profileDeletePasswordGroup" style="display: none;">
                                    <label for="profileDeletePassword">Введите пароль для подтверждения</label>
                                    <input type="password" id="profileDeletePassword" class="form-control" placeholder="Пароль" autocomplete="current-password">
                                </div>
                                <div class="profile-error" id="profileDeleteError" style="display: none;"></div>
                                <button type="button" class="btn btn-danger" id="btnDeleteAccount">Удалить мой аккаунт</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- Модальное окно обрезки аватара -->
        <div class="modal modal-crop" id="modalAvatarCrop" style="display: none;">
            <div class="modal-content modal-crop-content">
                <div class="modal-header">
                    <h3>Обрезка аватара</h3>
                    <button type="button" class="modal-close" id="modalAvatarCropClose">&times;</button>
                </div>
                <div class="modal-body modal-crop-body">
                    <div class="crop-container" id="cropContainer">
                        <img id="cropImage" src="" alt="">
                    </div>
                    <div class="crop-actions">
                        <button type="button" class="btn btn-secondary" id="btnCropCancel">Отмена</button>
                        <button type="button" class="btn btn-primary" id="btnCropApply">Применить</button>
                    </div>
                    <div class="profile-error crop-error" id="cropError" style="display: none;"></div>
                </div>
            </div>
        </div>
    <?php endif; ?>
