-- Схема базы данных для мессенджера
-- База данных: messenger_db

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- --------------------------------------------------------

--
-- Таблица: users (uuid как первичный ключ)
--

CREATE TABLE IF NOT EXISTS `users` (
  `uuid` char(36) NOT NULL,
  `username` varchar(50) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `status` varchar(255) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` datetime DEFAULT NULL,
  PRIMARY KEY (`uuid`),
  UNIQUE KEY `username` (`username`),
  KEY `last_seen` (`last_seen`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: conversations
--

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('private','group','external') NOT NULL DEFAULT 'private',
  `name` varchar(255) DEFAULT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `type` (`type`),
  KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: conversation_participants
--

CREATE TABLE IF NOT EXISTS `conversation_participants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `role` enum('member','admin') NOT NULL DEFAULT 'member',
  `notifications_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `joined_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `hidden_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `conversation_user` (`conversation_id`,`user_uuid`),
  KEY `user_uuid` (`user_uuid`),
  KEY `hidden_at` (`hidden_at`),
  CONSTRAINT `conversation_participants_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_participants_ibfk_2` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: messages
--

CREATE TABLE IF NOT EXISTS `messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `user_uuid` char(36) DEFAULT NULL,
  `content` text DEFAULT NULL,
  `encrypted` tinyint(1) NOT NULL DEFAULT 0,
  `reply_to_id` int(11) DEFAULT NULL,
  `forwarded_from_message_id` int(11) DEFAULT NULL,
  `type` enum('text','image','file','sticker','call') NOT NULL DEFAULT 'text',
  `group_call_id` int(11) DEFAULT NULL,
  `file_path` varchar(255) DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `edited_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `conversation_id` (`conversation_id`),
  KEY `user_uuid` (`user_uuid`),
  KEY `reply_to_id` (`reply_to_id`),
  KEY `forwarded_from_message_id` (`forwarded_from_message_id`),
  KEY `group_call_id` (`group_call_id`),
  KEY `created_at` (`created_at`),
  KEY `deleted_at` (`deleted_at`),
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `messages_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE SET NULL,
  CONSTRAINT `messages_reply_to_fk` FOREIGN KEY (`reply_to_id`) REFERENCES `messages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `messages_forwarded_from_fk` FOREIGN KEY (`forwarded_from_message_id`) REFERENCES `messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: user_public_keys (публичные ключи для E2EE)
--
CREATE TABLE IF NOT EXISTS `user_public_keys` (
  `user_uuid` char(36) NOT NULL,
  `public_key_jwk` text NOT NULL,
  `algorithm` varchar(32) NOT NULL DEFAULT 'ECDH-P256',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_uuid`),
  CONSTRAINT `user_public_keys_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: conversation_member_keys (E2EE ключ группы для каждого участника)
--
CREATE TABLE IF NOT EXISTS `conversation_member_keys` (
  `conversation_id` int(11) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `encrypted_by_uuid` char(36) NOT NULL,
  `key_blob` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`conversation_id`, `user_uuid`),
  KEY `encrypted_by_uuid` (`encrypted_by_uuid`),
  CONSTRAINT `conv_member_keys_conv_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conv_member_keys_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE,
  CONSTRAINT `conv_member_keys_encrypted_by_fk` FOREIGN KEY (`encrypted_by_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: user_key_backup (резерв ключей E2EE под паролем, этап 4)
--
CREATE TABLE IF NOT EXISTS `user_key_backup` (
  `user_uuid` char(36) NOT NULL,
  `key_blob` longtext DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `fail_count` int(11) NOT NULL DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `get_count` int(11) NOT NULL DEFAULT 0,
  `get_count_reset_at` datetime DEFAULT NULL,
  PRIMARY KEY (`user_uuid`),
  KEY `locked_until` (`locked_until`),
  CONSTRAINT `user_key_backup_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: message_reactions
--

CREATE TABLE IF NOT EXISTS `message_reactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message_id` int(11) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `emoji` varchar(10) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `message_user_emoji` (`message_id`,`user_uuid`,`emoji`),
  KEY `user_uuid` (`user_uuid`),
  CONSTRAINT `message_reactions_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `message_reactions_ibfk_2` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: stickers
--

CREATE TABLE IF NOT EXISTS `stickers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `file_path` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: user_stickers
--

CREATE TABLE IF NOT EXISTS `user_stickers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_uuid` char(36) NOT NULL,
  `sticker_id` int(11) NOT NULL,
  `added_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_sticker` (`user_uuid`,`sticker_id`),
  KEY `sticker_id` (`sticker_id`),
  CONSTRAINT `user_stickers_ibfk_1` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE,
  CONSTRAINT `user_stickers_ibfk_2` FOREIGN KEY (`sticker_id`) REFERENCES `stickers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: analytics_events
--

CREATE TABLE IF NOT EXISTS `analytics_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_uuid` char(36) DEFAULT NULL,
  `event_type` varchar(50) NOT NULL,
  `event_data` json DEFAULT NULL,
  `coordinates_x` int(11) DEFAULT NULL,
  `coordinates_y` int(11) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `screen_size` varchar(50) DEFAULT NULL,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_uuid` (`user_uuid`),
  KEY `event_type` (`event_type`),
  KEY `timestamp` (`timestamp`),
  CONSTRAINT `analytics_events_ibfk_1` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: analytics_clicks
--

CREATE TABLE IF NOT EXISTS `analytics_clicks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_uuid` char(36) DEFAULT NULL,
  `page` varchar(255) NOT NULL,
  `x` int(11) NOT NULL,
  `y` int(11) NOT NULL,
  `element` varchar(255) DEFAULT NULL,
  `viewport_width` int(11) DEFAULT NULL,
  `viewport_height` int(11) DEFAULT NULL,
  `zone` varchar(64) DEFAULT NULL,
  `zone_x` int(11) DEFAULT NULL,
  `zone_y` int(11) DEFAULT NULL,
  `zone_width` int(11) DEFAULT NULL,
  `zone_height` int(11) DEFAULT NULL,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_uuid` (`user_uuid`),
  KEY `page` (`page`),
  KEY `timestamp` (`timestamp`),
  KEY `viewport_zone` (`viewport_width`, `zone`),
  CONSTRAINT `analytics_clicks_ibfk_1` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: push_subscriptions (Web Push подписки для уведомлений)
--

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_uuid` char(36) NOT NULL,
  `endpoint` varchar(512) NOT NULL,
  `p256dh` varchar(255) NOT NULL,
  `auth` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_endpoint` (`user_uuid`,`endpoint`(255)),
  KEY `user_uuid` (`user_uuid`),
  CONSTRAINT `push_subscriptions_ibfk_1` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: sessions
--

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_uuid` char(36) NOT NULL,
  `token` varchar(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `user_uuid` (`user_uuid`),
  KEY `expires_at` (`expires_at`),
  CONSTRAINT `sessions_ibfk_1` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: message_reads (для отслеживания прочитанных сообщений)
--

CREATE TABLE IF NOT EXISTS `message_reads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message_id` int(11) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `read_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `message_user` (`message_id`,`user_uuid`),
  KEY `user_uuid` (`user_uuid`),
  CONSTRAINT `message_reads_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `message_reads_ibfk_2` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: message_deliveries (отметки доставки сообщений до получателя)
--

CREATE TABLE IF NOT EXISTS `message_deliveries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message_id` int(11) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `delivered_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `message_user` (`message_id`,`user_uuid`),
  KEY `user_uuid` (`user_uuid`),
  CONSTRAINT `message_deliveries_message_fk` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `message_deliveries_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: ws_tokens (токены для WebSocket, короткоживущие)
--

CREATE TABLE IF NOT EXISTS `ws_tokens` (
  `token` varchar(64) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `user_uuid` (`user_uuid`),
  KEY `expires_at` (`expires_at`),
  CONSTRAINT `ws_tokens_ibfk_1` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: call_logs (история звонков)
--

CREATE TABLE IF NOT EXISTS `call_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `caller_uuid` char(36) NOT NULL,
  `callee_uuid` char(36) NOT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` datetime DEFAULT NULL,
  `direction` enum('incoming','outgoing') NOT NULL,
  `duration_sec` int(11) DEFAULT NULL,
  `with_video` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `conversation_id` (`conversation_id`),
  KEY `caller_uuid` (`caller_uuid`),
  KEY `callee_uuid` (`callee_uuid`),
  KEY `started_at` (`started_at`),
  CONSTRAINT `call_logs_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `call_logs_caller_fk` FOREIGN KEY (`caller_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE,
  CONSTRAINT `call_logs_callee_fk` FOREIGN KEY (`callee_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Таблица: user_sip_credentials (SIP-пароль для регистрации на SIP-сервере)
--

CREATE TABLE IF NOT EXISTS `user_sip_credentials` (
  `user_uuid` char(36) NOT NULL,
  `sip_password` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_uuid`),
  CONSTRAINT `user_sip_credentials_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: group_calls (групповые звонки)
--
CREATE TABLE IF NOT EXISTS `group_calls` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `created_by_uuid` char(36) NOT NULL,
  `with_video` tinyint(1) NOT NULL DEFAULT 0,
  `origin_call_id` int(11) DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `conversation_id` (`conversation_id`),
  KEY `created_by_uuid` (`created_by_uuid`),
  KEY `origin_call_id` (`origin_call_id`),
  KEY `ended_at` (`ended_at`),
  CONSTRAINT `group_calls_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_calls_created_by_fk` FOREIGN KEY (`created_by_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE,
  CONSTRAINT `group_calls_origin_call_fk` FOREIGN KEY (`origin_call_id`) REFERENCES `call_logs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: group_call_participants (участники группового звонка)
--
CREATE TABLE IF NOT EXISTS `group_call_participants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `group_call_id` int(11) NOT NULL,
  `user_uuid` char(36) NOT NULL,
  `joined_at` datetime DEFAULT NULL,
  `left_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `group_call_id` (`group_call_id`),
  KEY `user_uuid` (`user_uuid`),
  KEY `group_call_left` (`group_call_id`, `left_at`),
  CONSTRAINT `group_call_participants_call_fk` FOREIGN KEY (`group_call_id`) REFERENCES `group_calls` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_call_participants_user_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: call_links (ссылки на звонок для присоединения по приглашению)
--
CREATE TABLE IF NOT EXISTS `call_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token` varchar(64) NOT NULL,
  `group_call_id` int(11) DEFAULT NULL,
  `call_id` int(11) DEFAULT NULL,
  `created_by_uuid` char(36) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `expires_at` (`expires_at`),
  KEY `group_call_id` (`group_call_id`),
  KEY `call_id` (`call_id`),
  CONSTRAINT `call_links_created_by_fk` FOREIGN KEY (`created_by_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE,
  CONSTRAINT `call_links_group_call_fk` FOREIGN KEY (`group_call_id`) REFERENCES `group_calls` (`id`) ON DELETE CASCADE,
  CONSTRAINT `call_links_call_fk` FOREIGN KEY (`call_id`) REFERENCES `call_logs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: group_call_guests (гости группового звонка без аккаунта)
--
CREATE TABLE IF NOT EXISTS `group_call_guests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `group_call_id` int(11) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `guest_token` varchar(64) NOT NULL,
  `joined_at` datetime NOT NULL,
  `left_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `guest_token` (`guest_token`),
  KEY `group_call_left` (`group_call_id`, `left_at`),
  CONSTRAINT `group_call_guests_group_call_fk` FOREIGN KEY (`group_call_id`) REFERENCES `group_calls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: ws_guest_tokens (токены WebSocket для гостей звонка)
--
CREATE TABLE IF NOT EXISTS `ws_guest_tokens` (
  `token` varchar(64) NOT NULL,
  `group_call_guest_id` int(11) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `expires_at` (`expires_at`),
  KEY `guest_id` (`group_call_guest_id`),
  CONSTRAINT `ws_guest_tokens_guest_fk` FOREIGN KEY (`group_call_guest_id`) REFERENCES `group_call_guests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Таблица: conversation_invite_links (ссылки-приглашения во внешнюю беседу)
--
CREATE TABLE IF NOT EXISTS `conversation_invite_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token` varchar(64) NOT NULL,
  `conversation_id` int(11) NOT NULL,
  `created_by_uuid` char(36) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `expires_at` (`expires_at`),
  KEY `conversation_id` (`conversation_id`),
  CONSTRAINT `conv_invite_links_conv_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conv_invite_links_created_by_fk` FOREIGN KEY (`created_by_uuid`) REFERENCES `users` (`uuid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- Ссылка сообщений на групповой звонок (для записей о звонках)
-- Колонка group_call_id уже объявлена в CREATE TABLE messages выше.
--
ALTER TABLE `messages`
  ADD CONSTRAINT `messages_group_call_fk` FOREIGN KEY (`group_call_id`) REFERENCES `group_calls` (`id`) ON DELETE SET NULL;
