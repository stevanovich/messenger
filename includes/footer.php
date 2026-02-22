    <?php if (!empty($minimalFooter)): ?>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script>
    (function() {
        var baseUrl = <?php echo json_encode(rtrim(BASE_URL, '/')); ?>;
        var docBase = baseUrl + '/documentation.php';
        var apiDocs = baseUrl + '/api/docs.php';
        function getParam(name) {
            var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
            return m ? decodeURIComponent(m[1]) : '';
        }
        function loadDoc(file, pushState) {
            var url = apiDocs + '?file=' + encodeURIComponent(file);
            fetch(url).then(function(r) { return r.json(); }).then(function(data) {
                if (data.error) {
                    document.getElementById('docContent').innerHTML = '<p class="doc-error">' + (data.error === 'File not found' ? 'Файл не найден.' : data.error) + '</p>';
                    return;
                }
                var html = marked.parse(data.content || '');
                var container = document.getElementById('docContent');
                container.innerHTML = html;
                container.querySelectorAll('a[href$=".md"]').forEach(function(a) {
                    var h = a.getAttribute('href');
                    var f = h.replace(/^.*\//, '');
                    a.setAttribute('href', docBase + '?f=' + encodeURIComponent(f));
                    a.addEventListener('click', function(e) {
                        e.preventDefault();
                        loadDoc(f, true);
                        if (pushState !== false) history.pushState({ f: f }, '', docBase + '?f=' + encodeURIComponent(f));
                        if (window.innerWidth <= 768 && typeof window.docCloseSidebar === 'function') window.docCloseSidebar();
                    });
                });
                if (pushState !== false) history.replaceState({ f: file }, '', docBase + '?f=' + encodeURIComponent(file));
            }).catch(function() {
                document.getElementById('docContent').innerHTML = '<p class="doc-error">Ошибка загрузки.</p>';
            });
        }
        var initial = getParam('f') || 'USER_GUIDE_INDEX.md';
        loadDoc(initial, false);
        window.addEventListener('popstate', function(e) {
            if (e.state && e.state.f) loadDoc(e.state.f, false);
        });
    })();
    </script>
    </body>
    </html>
    <?php return; endif; ?>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js"></script>
    <?php if (function_exists('getTwemojiEnabled') && getTwemojiEnabled()): ?>
    <script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js" crossorigin="anonymous"></script>
    <?php endif; ?>
    <?php if (function_exists('getLocale') && function_exists('t')): ?>
    <script>
    window.__LANG__ = <?php echo json_encode([
        'locale' => getLocale(),
        'localeIntl' => (getLocale() === 'ru' ? 'ru-RU' : (getLocale() === 'sr' ? 'sr-RS' : 'en-US')),
        'common' => [
            'error' => t('common.error'),
            'back' => t('common.back'),
            'close' => t('common.close'),
            'delete' => t('common.delete'),
            'network_error' => t('common.network_error'),
            'loading' => t('common.loading'),
            'polling_label' => t('common.polling_label'),
            'polling_title' => t('common.polling_title'),
            'show_password' => t('common.show_password'),
            'hide_password' => t('common.hide_password'),
        ],
        'time' => [
            'just_now' => t('time.just_now'),
            'ago' => t('time.ago'),
            'ago_prefix' => t('time.ago_prefix'),
            'minute_forms' => [t('time.minute_1'), t('time.minute_2'), t('time.minute_5')],
            'hour_forms' => [t('time.hour_1'), t('time.hour_2'), t('time.hour_5')],
            'day_forms' => [t('time.day_1'), t('time.day_2'), t('time.day_5')],
        ],
        'date' => ['today' => t('date.today'), 'yesterday' => t('date.yesterday')],
        'status' => [
            'online' => t('status.online'),
            'offline' => t('status.offline'),
            'was' => t('status.was'),
        ],
        'notifications' => [
            'on' => t('notifications.on'),
            'off' => t('notifications.off'),
            'denied' => t('notifications.denied'),
        ],
        'call' => [
            'voice' => t('call.voice'),
            'video' => t('call.video'),
            'group_voice' => t('call.group_voice'),
            'group_video' => t('call.group_video'),
            'duration' => t('call.duration'),
            'completed' => t('call.completed'),
            'completed_for_all' => t('call.completed_for_all'),
            'participants' => t('call.participants'),
        ],
        'calls' => [
            'incoming_title' => t('calls.incoming_title'),
            'incoming_call' => t('calls.incoming_call'),
            'decline' => t('calls.decline'),
            'accept' => t('calls.accept'),
            'minimize' => t('calls.minimize'),
            'invite' => t('calls.invite'),
            'mic_off' => t('calls.mic_off'),
            'mic_on' => t('calls.mic_on'),
            'mic_off_label' => t('calls.mic_off_label'),
            'mic_on_label' => t('calls.mic_on_label'),
            'camera_off' => t('calls.camera_off'),
            'camera_on' => t('calls.camera_on'),
            'camera_off_label' => t('calls.camera_off_label'),
            'camera_on_label' => t('calls.camera_on_label'),
            'screen_not_sharing' => t('calls.screen_not_sharing'),
            'screen_not_sharing_label' => t('calls.screen_not_sharing_label'),
            'screen_sharing' => t('calls.screen_sharing'),
            'screen_sharing_label' => t('calls.screen_sharing_label'),
            'recording_off' => t('calls.recording_off'),
            'recording_on' => t('calls.recording_on'),
            'recording_only_audio' => t('calls.recording_only_audio'),
            'recording_audio_video' => t('calls.recording_audio_video'),
            'stop_recording' => t('calls.stop_recording'),
            'stop_recording_btn' => t('calls.stop_recording_btn'),
            'end_call' => t('calls.end_call'),
            'switch_camera' => t('calls.switch_camera'),
            'recording_saving_hint' => t('calls.recording_saving_hint'),
            'recording_saving_hint_group' => t('calls.recording_saving_hint_group'),
            'group_call_title' => t('calls.group_call_title'),
            'end_call_modal_title' => t('calls.end_call_modal_title'),
            'close' => t('calls.close'),
            'end_call_modal_hint' => t('calls.end_call_modal_hint'),
            'leave_call' => t('calls.leave_call'),
            'end_for_all' => t('calls.end_for_all'),
            'add_participant_title' => t('calls.add_participant_title'),
            'contacts_tab' => t('calls.contacts_tab'),
            'guests_tab' => t('calls.guests_tab'),
            'add_to_call' => t('calls.add_to_call'),
            'share_link_hint' => t('calls.share_link_hint'),
            'expiry_label' => t('calls.expiry_label'),
            'expiry_1h' => t('calls.expiry_1h'),
            'expiry_24h' => t('calls.expiry_24h'),
            'expiry_7d' => t('calls.expiry_7d'),
            'get_link_placeholder' => t('calls.get_link_placeholder'),
            'get_link_btn' => t('calls.get_link_btn'),
            'copy_btn' => t('calls.copy_btn'),
            'copied_btn' => t('calls.copied_btn'),
            'revoke_btn' => t('calls.revoke_btn'),
            'participants_title' => t('calls.participants_title'),
            'load_participants_error' => t('calls.load_participants_error'),
            'no_participants' => t('calls.no_participants'),
            'load_error' => t('calls.load_error'),
            'no_contacts' => t('calls.no_contacts'),
            'create_link_error' => t('calls.create_link_error'),
            'revoke_error' => t('calls.revoke_error'),
            'start_group_call_error' => t('calls.start_group_call_error'),
            'join_error' => t('calls.join_error'),
            'start_call_error' => t('calls.start_call_error'),
            'media_access_error' => t('calls.media_access_error'),
            'media_in_use' => t('calls.media_in_use'),
            'waiting_answer' => t('calls.waiting_answer'),
            'participant' => t('calls.participant'),
            'guest' => t('calls.guest'),
            'recording_banner' => t('calls.recording_banner'),
            'recording_by' => t('calls.recording_by'),
            'audio_off' => t('calls.audio_off'),
            'audio_on' => t('calls.audio_on'),
            'microphone' => t('calls.microphone'),
            'camera' => t('calls.camera'),
            'screen' => t('calls.screen'),
            'recording' => t('calls.recording'),
            'call_ended' => t('calls.call_ended'),
            'connecting' => t('calls.connecting'),
            'load_participants_error_guest' => t('calls.load_participants_error_guest'),
            'call_title' => t('calls.call_title'),
            'you' => t('calls.you'),
            'switch_camera_title' => t('calls.switch_camera_title'),
            'register_hint' => t('calls.register_hint'),
            'create_account' => t('calls.create_account'),
            'mic_title' => t('calls.mic_title'),
            'camera_title' => t('calls.camera_title'),
            'share_screen_title' => t('calls.share_screen_title'),
            'leave_call_title' => t('calls.leave_call_title'),
            'invalid_link' => t('calls.invalid_link'),
            'go_home' => t('calls.go_home'),
            'ws_error' => t('calls.ws_error'),
            'connection_closed' => t('calls.connection_closed'),
            'you_in_call' => t('calls.you_in_call'),
            'connection_error' => t('calls.connection_error'),
        ],
        'chat' => [
            'select_one_message' => t('chat.select_one_message'),
            'action_failed' => t('chat.action_failed'),
            'create_conversation_error' => t('chat.create_conversation_error'),
            'delete_conversation_error' => t('chat.delete_conversation_error'),
            'delete_message_error' => t('chat.delete_message_error'),
            'delete_selected' => t('chat.delete_selected'),
            'delete_selected_confirm' => t('chat.delete_selected_confirm'),
            'group_call_in_progress' => t('chat.group_call_in_progress'),
            'join' => t('chat.join'),
            'connect' => t('chat.connect'),
            'load_participants_error' => t('chat.load_participants_error'),
            'load_profile_error' => t('chat.load_profile_error'),
            'load_error' => t('chat.load_error'),
            'conversation_info' => t('chat.conversation_info'),
            'group' => t('chat.group'),
            'chat' => t('chat.chat'),
            'group_info' => t('chat.group_info'),
            'chat_info' => t('chat.chat_info'),
            'role_admin' => t('chat.role_admin'),
            'role_participant' => t('chat.role_participant'),
            'encrypted_placeholder' => t('chat.encrypted_placeholder'),
            'sent' => t('chat.sent'),
            'delivered' => t('chat.delivered'),
            'sticker' => t('chat.sticker'),
            'image' => t('chat.image'),
            'go_to_message' => t('chat.go_to_message'),
            'forwarded' => t('chat.forwarded'),
            'profile' => t('chat.profile'),
            'message_actions' => t('chat.message_actions'),
            'open_profile' => t('chat.open_profile'),
            'replay_animation' => t('chat.replay_animation'),
            'send_error' => t('chat.send_error'),
            'timeout_or_network' => t('chat.timeout_or_network'),
            'no_contacts_found' => t('chat.no_contacts_found'),
            'no_contacts' => t('chat.no_contacts'),
            'forward_count' => t('chat.forward_count'),
            'forward_to_chat' => t('chat.forward_to_chat'),
            'no_chats_found' => t('chat.no_chats_found'),
            'no_chats' => t('chat.no_chats'),
            'new_chat_empty_search' => t('chat.new_chat_empty_search'),
            'new_chat_hint' => t('chat.new_chat_hint'),
            'forward_btn' => t('chat.forward_btn'),
            'preview' => t('chat.preview'),
            'zoom_out' => t('chat.zoom_out'),
            'zoom_in' => t('chat.zoom_in'),
            'download' => t('chat.download'),
            'cancel_reply' => t('chat.cancel_reply'),
            'reply_to' => t('chat.reply_to'),
            'reaction' => t('chat.reaction'),
            'message_content_placeholder' => t('chat.message_content_placeholder'),
            'call_placeholder' => t('chat.call_placeholder'),
            'encrypted_message' => t('chat.encrypted_message'),
            'external_call_info' => t('chat.external_call_info'),
            'participants_count' => t('chat.participants_count'),
            'external_call' => t('chat.external_call'),
            'group_type' => t('chat.group_type'),
            'profile_peer' => t('chat.profile_peer'),
            'save_error' => t('chat.save_error'),
            'emoji_category' => t('chat.emoji_category'),
            'no_messages' => t('chat.no_messages'),
            'conversation_default' => t('chat.conversation_default'),
            'forwarded_from' => t('chat.forwarded_from'),
            'file' => t('chat.file'),
            'actions' => t('chat.actions'),
            'all_category' => t('chat.all_category'),
            'user_default' => t('chat.user_default'),
            'start_chat_error' => t('chat.start_chat_error'),
            'create_group_error' => t('chat.create_group_error'),
            'add_members_error' => t('chat.add_members_error'),
            'join_call_error' => t('chat.join_call_error'),
            'sticker_send_error' => t('chat.sticker_send_error'),
            'group_call_already' => t('chat.group_call_already'),
            'scroll_to_bottom' => t('chat.scroll_to_bottom'),
            'search_in_chat' => t('chat.search_in_chat'),
            'search_prev' => t('chat.search_prev'),
            'search_next' => t('chat.search_next'),
            'search_close' => t('chat.search_close'),
            'search_none' => t('chat.search_none'),
            'search_counter' => t('chat.search_counter'),
            'message_deleted' => t('chat.message_deleted'),
            'leave_group' => t('chat.leave_group'),
            'remove_member' => t('chat.remove_member'),
            'delete_hide_for_me' => t('chat.delete_hide_for_me'),
            'delete_for_everyone' => t('chat.delete_for_everyone'),
        ],
        'profile' => [
            'unlink' => t('profile.unlink'),
            'unlink_error' => t('profile.unlink_error'),
            'history_anonymized' => t('profile.history_anonymized'),
            'password_set' => t('profile.password_set'),
            'password_not_set' => t('profile.password_not_set'),
            'change_password' => t('profile.change_password'),
            'set_password' => t('profile.set_password'),
            'enter_current_password' => t('profile.enter_current_password'),
            'password_min_6' => t('profile.password_min_6'),
            'passwords_mismatch' => t('register.passwords_mismatch'),
            'enter_password_confirm' => t('profile.delete_password_label'),
            'hide' => t('profile.hide'),
            'crop_error' => t('profile.crop_error'),
            'processing_error' => t('profile.processing_error'),
            'upload_error' => t('profile.upload_error'),
            'server_error_page' => t('profile.server_error_page'),
            'no_connectors' => t('profile.no_connectors'),
            'load_connectors_error' => t('profile.load_connectors_error'),
            'delete_account_confirm' => t('profile.delete_account_confirm'),
            'delete_history_confirm' => t('profile.delete_history_confirm'),
        ],
        'e2ee' => [
            'enter_password' => t('e2ee.enter_password'),
            'wrong_password' => t('e2ee.wrong_password'),
            'restore_failed' => t('e2ee.restore_failed'),
            'enter_key_backup_password' => t('e2ee.enter_key_backup_password'),
            'key_backup_saved' => t('e2ee.key_backup_saved'),
            'key_backup_failed' => t('e2ee.key_backup_failed'),
            'login_first' => t('e2ee.login_first'),
            'pin_min_4' => t('e2ee.pin_min_4'),
            'pin_mismatch' => t('e2ee.pin_mismatch'),
            'passwords_mismatch' => t('e2ee.passwords_mismatch'),
            'lock_enable_error' => t('e2ee.lock_enable_error'),
            'no_saved_lock' => t('e2ee.no_saved_lock'),
            'wrong_pin' => t('e2ee.wrong_pin'),
            'app_name' => t('e2ee.app_name'),
        ],
        'push' => [
            'not_configured' => t('push.not_configured'),
            'not_json' => t('push.not_json'),
            'not_configured_key' => t('push.not_configured_key'),
            'unsupported' => t('push.unsupported'),
            'permission_denied' => t('push.permission_denied'),
            'blocked_message' => t('push.blocked_message'),
            'unsupported_browser' => t('push.unsupported_browser'),
            'save_error' => t('push.save_error'),
            'https_only' => t('push.https_only'),
            'no_notification_api' => t('push.no_notification_api'),
            'no_service_worker' => t('push.no_service_worker'),
        ],
        'app' => [
            'server_timeout' => t('app.server_timeout'),
        ],
    ], JSON_UNESCAPED_UNICODE); ?>;
    </script>
    <?php endif; ?>
    <script>
    (function() {
        function isStandaloneWebapp() {
            return window.matchMedia('(display-mode: standalone)').matches
                || (window.navigator.standalone === true);
        }
        if (!isStandaloneWebapp()) return;
        document.querySelectorAll('a[href*="auth/google.php"], a[href*="auth/yandex.php"]').forEach(function(a) {
            var href = a.getAttribute('href');
            if (!href) return;
            if (href.indexOf('auth/google.php') !== -1 || href.indexOf('auth/yandex.php') !== -1) {
                if (href.indexOf('display=standalone') !== -1) return;
                a.setAttribute('href', href + (href.indexOf('?') !== -1 ? '&' : '?') + 'display=standalone');
            }
        });
    })();
    </script>
    <script src="<?php echo BASE_URL; ?>assets/js/app.js?v=<?php echo filemtime(__DIR__ . '/../assets/js/app.js'); ?>"></script>
    <?php if (isset($additionalJSModules)): ?>
        <?php foreach ($additionalJSModules as $js): ?>
            <script type="module" src="<?php echo BASE_URL . $js; ?>?v=<?php echo file_exists(__DIR__ . '/../' . $js) ? filemtime(__DIR__ . '/../' . $js) : '0'; ?>"></script>
        <?php endforeach; ?>
    <?php endif; ?>
    <?php if (isset($additionalJS)): ?>
        <?php foreach ($additionalJS as $js): ?>
            <script src="<?php echo BASE_URL . $js; ?>?v=<?php echo filemtime(__DIR__ . '/../' . $js); ?>"></script>
        <?php endforeach; ?>
    <?php endif; ?>
</body>
</html>
