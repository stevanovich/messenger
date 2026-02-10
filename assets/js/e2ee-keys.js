/**
 * E2EE — этап 1: генерация ключей и обмен публичными ключами (Web Crypto API).
 * Используется для подготовки к end-to-end шифрованию; шифрование сообщений — этап 2.
 */
(function (global) {
    'use strict';

    const API_BASE = typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : '';
    const ECDH_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' };
    const E2EE_STORAGE_KEY = 'e2ee_keypair_jwk';

    let keyPair = null;

    /**
     * Загружает пару ключей из sessionStorage (если есть), иначе генерирует новую и сохраняет.
     * Так одна и та же пара используется после перезагрузки страницы — иначе расшифровка ключа группы для себя ломается.
     * @returns {Promise<CryptoKeyPair|null>}
     */
    async function generateKeyPair() {
        if (keyPair) return keyPair;
        if (!crypto.subtle) {
            console.warn('E2EE: crypto.subtle недоступен');
            return null;
        }
        try {
            if (typeof sessionStorage !== 'undefined') {
                const stored = sessionStorage.getItem(E2EE_STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && parsed.publicKey && parsed.privateKey) {
                        const publicKey = await crypto.subtle.importKey(
                            'jwk',
                            parsed.publicKey,
                            ECDH_ALGORITHM,
                            true,
                            []
                        );
                        const privateKey = await crypto.subtle.importKey(
                            'jwk',
                            parsed.privateKey,
                            ECDH_ALGORITHM,
                            false,
                            ['deriveBits', 'deriveKey']
                        );
                        keyPair = { publicKey, privateKey };
                        return keyPair;
                    }
                }
            }
            keyPair = await crypto.subtle.generateKey(ECDH_ALGORITHM, true, ['deriveBits', 'deriveKey']);
            if (keyPair && typeof sessionStorage !== 'undefined') {
                const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
                const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
                sessionStorage.setItem(E2EE_STORAGE_KEY, JSON.stringify({ publicKey: publicJwk, privateKey: privateJwk }));
            }
            return keyPair;
        } catch (e) {
            console.warn('E2EE: ошибка генерации/загрузки ключей', e);
            keyPair = null;
            try { sessionStorage.removeItem(E2EE_STORAGE_KEY); } catch (_) {}
            return null;
        }
    }

    /**
     * Экспортирует публичный ключ в формате JWK.
     * @returns {Promise<object|null>}
     */
    async function exportPublicKeyJwk() {
        const pair = await generateKeyPair();
        if (!pair) return null;
        try {
            return await crypto.subtle.exportKey('jwk', pair.publicKey);
        } catch (e) {
            console.warn('E2EE: ошибка экспорта публичного ключа', e);
            return null;
        }
    }

    /**
     * Отправляет свой публичный ключ на сервер (POST /api/keys.php).
     * @returns {Promise<boolean>}
     */
    async function uploadMyPublicKey() {
        const jwk = await exportPublicKeyJwk();
        if (!jwk) return false;
        try {
            const r = await fetch(API_BASE + '/api/keys.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ public_key: jwk, algorithm: 'ECDH-P256' })
            });
            const data = await r.json().catch(() => ({}));
            if (data && data.success) return true;
            return false;
        } catch (e) {
            console.warn('E2EE: ошибка загрузки ключа на сервер', e);
            return false;
        }
    }

    /**
     * Получает публичный ключ пользователя с сервера (GET /api/keys.php?user_uuid=...).
     * @param {string} userUuid
     * @returns {Promise<object|null>} JWK публичного ключа или null
     */
    async function getRemotePublicKey(userUuid) {
        if (!userUuid) return null;
        try {
            const r = await fetch(API_BASE + '/api/keys.php?user_uuid=' + encodeURIComponent(userUuid), {
                credentials: 'include'
            });
            const data = await r.json().catch(() => ({}));
            if (data && data.success && data.data && data.data.public_key) {
                return data.data.public_key;
            }
            return null;
        } catch (e) {
            console.warn('E2EE: ошибка получения ключа пользователя', e);
            return null;
        }
    }

    /**
     * Инициализация: генерирует ключи при первом обращении и опционально регистрирует на сервере.
     * @param {boolean} registerOnServer — загрузить публичный ключ на сервер
     * @returns {Promise<boolean>}
     */
    async function init(registerOnServer) {
        const pair = await generateKeyPair();
        if (!pair) return false;
        if (registerOnServer !== false) {
            await uploadMyPublicKey();
        }
        return true;
    }

    /**
     * Возвращает текущую пару ключей (для этапа 2 — вывод общего секрета).
     * @returns {CryptoKeyPair|null}
     */
    function getKeyPair() {
        return keyPair;
    }

    const AES_GCM = { name: 'AES-GCM', length: 256 };
    const CONV_KEY_CACHE = new Map();

    /**
     * Выводит общий ключ беседы (AES-GCM) из ECDH с публичным ключом собеседника.
     * @param {object} remotePublicKeyJwk — JWK публичного ключа другого пользователя
     * @returns {Promise<CryptoKey|null>} ключ для AES-GCM или null
     */
    async function deriveConversationKey(remotePublicKeyJwk) {
        if (!keyPair || !remotePublicKeyJwk || !crypto.subtle) return null;
        try {
            const remotePublic = await crypto.subtle.importKey(
                'jwk',
                remotePublicKeyJwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                []
            );
            const sharedBits = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: remotePublic },
                keyPair.privateKey,
                256
            );
            const hash = await crypto.subtle.digest('SHA-256', sharedBits);
            return await crypto.subtle.importKey(
                'raw',
                hash,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        } catch (e) {
            console.warn('E2EE: ошибка вывода ключа беседы', e);
            return null;
        }
    }

    /**
     * Получает или создаёт ключ беседы для личного чата (1-на-1). Кэширует по conversationId.
     * @param {number} conversationId
     * @param {string} otherUserUuid — UUID собеседника
     * @returns {Promise<CryptoKey|null>}
     */
    async function getOrCreateConversationKey(conversationId, otherUserUuid) {
        if (!conversationId || !otherUserUuid) return null;
        const cacheKey = String(conversationId);
        if (CONV_KEY_CACHE.has(cacheKey)) return CONV_KEY_CACHE.get(cacheKey);
        const remoteJwk = await getRemotePublicKey(otherUserUuid);
        if (!remoteJwk) return null;
        const key = await deriveConversationKey(remoteJwk);
        if (key) CONV_KEY_CACHE.set(cacheKey, key);
        return key;
    }

    /**
     * Шифрует текст сообщения (AES-GCM, IV 12 байт). Возвращает строку "ivBase64: ciphertextBase64".
     * @param {string} plaintext
     * @param {CryptoKey} conversationKey
     * @returns {Promise<string|null>}
     */
    async function encryptPlaintext(plaintext, conversationKey) {
        if (!conversationKey || !crypto.subtle) return null;
        try {
            const enc = new TextEncoder();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv, tagLength: 128 },
                conversationKey,
                enc.encode(plaintext)
            );
            const ivB64 = btoa(String.fromCharCode.apply(null, iv));
            const ctB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ciphertext)));
            return ivB64 + ':' + ctB64;
        } catch (e) {
            console.warn('E2EE: ошибка шифрования', e);
            return null;
        }
    }

    /**
     * Расшифровывает сообщение (формат "ivBase64:ciphertextBase64").
     * @param {string} payload — строка ivBase64:ciphertextBase64
     * @param {CryptoKey} conversationKey
     * @returns {Promise<string|null>}
     */
    async function decryptCiphertext(payload, conversationKey) {
        if (!conversationKey || !payload || typeof payload !== 'string') return null;
        const idx = payload.indexOf(':');
        if (idx <= 0) return null;
        try {
            const ivB64 = payload.slice(0, idx);
            const ctB64 = payload.slice(idx + 1);
            const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
            const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
            const dec = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, tagLength: 128 },
                conversationKey,
                ct
            );
            return new TextDecoder().decode(dec);
        } catch (e) {
            console.warn('E2EE: ошибка расшифровки', e);
            return null;
        }
    }

    const GROUP_KEY_PREFIX = 'g_';

    /**
     * Генерирует случайный ключ группы (AES-GCM 256) для группового чата.
     * @returns {Promise<CryptoKey|null>}
     */
    async function generateGroupKey() {
        if (!crypto.subtle) return null;
        try {
            return await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
        } catch (e) {
            console.warn('E2EE: ошибка генерации ключа группы', e);
            return null;
        }
    }

    /**
     * Шифрует ключ группы для участника (ECDH с его публичным ключом + AES-GCM). Формат "ivBase64:ciphertextBase64".
     * @param {CryptoKey} groupKey
     * @param {object} remotePublicKeyJwk
     * @returns {Promise<string|null>}
     */
    async function encryptGroupKeyForUser(groupKey, remotePublicKeyJwk) {
        const derived = await deriveConversationKey(remotePublicKeyJwk);
        if (!derived) return null;
        try {
            const raw = await crypto.subtle.exportKey('raw', groupKey);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv, tagLength: 128 },
                derived,
                raw
            );
            return btoa(String.fromCharCode.apply(null, iv)) + ':' + btoa(String.fromCharCode.apply(null, new Uint8Array(ct)));
        } catch (e) {
            console.warn('E2EE: ошибка шифрования ключа группы', e);
            return null;
        }
    }

    /**
     * Расшифровывает ключ группы из блоба (зашифрован участником encryptedByUuid).
     * @param {string} blob — "ivBase64:ciphertextBase64"
     * @param {string} encryptedByUuid
     * @returns {Promise<CryptoKey|null>}
     */
    async function decryptGroupKeyFromBlob(blob, encryptedByUuid) {
        if (!blob || !encryptedByUuid) return null;
        const derived = await deriveConversationKey(await getRemotePublicKey(encryptedByUuid));
        if (!derived) return null;
        const idx = blob.indexOf(':');
        if (idx <= 0) return null;
        try {
            const iv = Uint8Array.from(atob(blob.slice(0, idx)), c => c.charCodeAt(0));
            const ct = Uint8Array.from(atob(blob.slice(idx + 1)), c => c.charCodeAt(0));
            const raw = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, tagLength: 128 },
                derived,
                ct
            );
            return await crypto.subtle.importKey(
                'raw',
                raw,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        } catch (e) {
            console.debug('E2EE: не удалось расшифровать ключ группы (возможно, ключ пересоздан).', e && e.message ? e.message : e);
            return null;
        }
    }

    /**
     * Получает или создаёт ключ группы для беседы (кэш по conversationId с префиксом g_).
     * @param {number} conversationId
     * @returns {Promise<CryptoKey|null>}
     */
    async function getOrCreateGroupConversationKey(conversationId) {
        if (!conversationId) return null;
        const cacheKey = GROUP_KEY_PREFIX + String(conversationId);
        if (CONV_KEY_CACHE.has(cacheKey)) return CONV_KEY_CACHE.get(cacheKey);
        try {
            const r = await fetch(API_BASE + '/api/keys.php?action=group_key&conversation_id=' + encodeURIComponent(conversationId), { credentials: 'include' });
            const data = await r.json().catch(() => ({}));
            if (!data.success || !data.data || !data.data.key_blob) {
                CONV_KEY_CACHE.delete(cacheKey);
                return null;
            }
            const key = await decryptGroupKeyFromBlob(data.data.key_blob, data.data.encrypted_by_uuid);
            if (key) CONV_KEY_CACHE.set(cacheKey, key);
            else CONV_KEY_CACHE.delete(cacheKey);
            return key;
        } catch (e) {
            console.warn('E2EE: ошибка получения ключа группы', e);
            return null;
        }
    }

    /**
     * Сохраняет ключ группы в кэш (для создателя группы после генерации).
     * @param {number} conversationId
     * @param {CryptoKey} groupKey
     */
    function setGroupKeyInCache(conversationId, groupKey) {
        if (conversationId && groupKey) CONV_KEY_CACHE.set(GROUP_KEY_PREFIX + String(conversationId), groupKey);
    }

    /**
     * Удаляет ключ группы из кэша (forward secrecy: после ухода участника клиент может пересоздать ключ).
     * @param {number} conversationId
     */
    function clearGroupKeyCache(conversationId) {
        if (conversationId) CONV_KEY_CACHE.delete(GROUP_KEY_PREFIX + String(conversationId));
    }

    /**
     * Если ключа группы нет на сервере (например после ухода участника), создаёт новый и рассылает всем участникам.
     * @param {number} conversationId
     * @param {string[]} participantUuids — UUID участников (включая текущего пользователя)
     * @returns {Promise<CryptoKey|null>}
     */
    async function ensureGroupKeyCreatedAndDistributed(conversationId, participantUuids) {
        if (!conversationId || !participantUuids || !participantUuids.length) return null;
        const groupKey = await generateGroupKey();
        if (!groupKey) return null;
        setGroupKeyInCache(conversationId, groupKey);
        const currentUserUuid = typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.userUuid ? document.body.dataset.userUuid : '';
        const allUuids = currentUserUuid && !participantUuids.includes(currentUserUuid) ? [currentUserUuid, ...participantUuids] : participantUuids;
        for (const userUuid of allUuids) {
            const jwk = await getRemotePublicKey(userUuid);
            if (jwk) {
                const blob = await encryptGroupKeyForUser(groupKey, jwk);
                if (blob) await storeGroupKeyForUser(conversationId, userUuid, blob);
            }
        }
        return groupKey;
    }

    /**
     * Отправляет зашифрованный ключ группы участнику на сервер (POST set_group_key).
     * @param {number} conversationId
     * @param {string} userUuid
     * @param {string} keyBlob
     * @returns {Promise<boolean>}
     */
    async function storeGroupKeyForUser(conversationId, userUuid, keyBlob) {
        try {
            const r = await fetch(API_BASE + '/api/keys.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ action: 'set_group_key', conversation_id: conversationId, user_uuid: userUuid, key_blob: keyBlob })
            });
            const data = await r.json().catch(() => ({}));
            return !!(data && data.success);
        } catch (e) {
            console.warn('E2EE: ошибка сохранения ключа группы', e);
            return false;
        }
    }

    // --- Этап 4: резерв ключей под паролем ---
    const KEY_BACKUP_FAIL_COUNT = 'e2ee_restore_fail_count';

    function getStoredKeyPairJson() {
        try {
            if (typeof sessionStorage === 'undefined') return null;
            const s = sessionStorage.getItem(E2EE_STORAGE_KEY);
            return s ? JSON.parse(s) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Есть ли сохранённая пара ключей в sessionStorage.
     * @returns {boolean}
     */
    function hasStoredKeyPair() {
        const j = getStoredKeyPairJson();
        return !!(j && j.publicKey && j.privateKey);
    }

    /**
     * Задержка (мс) после неверного пароля: прогрессивная по счётчику в localStorage.
     * @param {number} baseSec
     * @param {number} maxSec
     * @returns {Promise<void>}
     */
    function applyProgressiveDelay(baseSec, maxSec) {
        let count = 0;
        try {
            const c = localStorage.getItem(KEY_BACKUP_FAIL_COUNT);
            if (c) count = parseInt(c, 10) || 0;
        } catch (_) {}
        count++;
        try {
            localStorage.setItem(KEY_BACKUP_FAIL_COUNT, String(count));
        } catch (_) {}
        const delaySec = Math.min(baseSec * Math.pow(2, count - 1), maxSec);
        const ms = Math.max(0, delaySec) * 1000;
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function clearRestoreFailCount() {
        try {
            localStorage.removeItem(KEY_BACKUP_FAIL_COUNT);
        } catch (_) {}
    }

    /**
     * Получить параметры защиты с сервера (для клиентской задержки и KDF).
     * @returns {Promise<{client_delay_base_sec: number, client_delay_max_sec: number, kdf_iterations: number}>}
     */
    async function getBackupLimits() {
        try {
            const r = await fetch(API_BASE + '/api/keys.php?action=limits', { credentials: 'include' });
            const data = await r.json().catch(() => ({}));
            if (data && data.success && data.data) {
                return {
                    client_delay_base_sec: data.data.client_delay_base_sec ?? 2,
                    client_delay_max_sec: data.data.client_delay_max_sec ?? 300,
                    kdf_iterations: data.data.kdf_iterations ?? 100000
                };
            }
        } catch (e) {
            console.warn('E2EE: ошибка получения limits', e);
        }
        return { client_delay_base_sec: 2, client_delay_max_sec: 300, kdf_iterations: 100000 };
    }

    /**
     * Сообщить серверу о неудачной расшифровке (подбор пароля).
     * @returns {Promise<void>}
     */
    async function reportDecryptionFailed() {
        try {
            await fetch(API_BASE + '/api/keys.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ action: 'decryption_failed' })
            });
        } catch (e) {
            console.warn('E2EE: reportDecryptionFailed', e);
        }
    }

    /**
     * Вывести ключ из пароля (PBKDF2 + AES-GCM key).
     * @param {string} password
     * @param {Uint8Array} salt
     * @param {number} iterations
     * @returns {Promise<CryptoKey>}
     */
    async function deriveKeyFromPassword(password, salt, iterations) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );
        return await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Создать зашифрованный blob ключей из текущей пары (для резервной копии).
     * Формат: saltB64:ivB64:ciphertextB64
     * @param {string} password
     * @param {number} iterations
     * @returns {Promise<string|null>}
     */
    async function createKeyBackupBlob(password, iterations) {
        const j = getStoredKeyPairJson();
        if (!j || !j.publicKey || !j.privateKey || !crypto.subtle) return null;
        try {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await deriveKeyFromPassword(password, salt, iterations);
            const plaintext = new TextEncoder().encode(JSON.stringify(j));
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv, tagLength: 128 },
                key,
                plaintext
            );
            const saltB64 = btoa(String.fromCharCode.apply(null, salt));
            const ivB64 = btoa(String.fromCharCode.apply(null, iv));
            const ctB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ciphertext)));
            return saltB64 + ':' + ivB64 + ':' + ctB64;
        } catch (e) {
            console.warn('E2EE: createKeyBackupBlob', e);
            return null;
        }
    }

    /**
     * Расшифровать blob и импортировать ключи в sessionStorage и keyPair.
     * @param {string} password
     * @param {string} blob — формат saltB64:ivB64:ciphertextB64
     * @param {number} iterations
     * @returns {Promise<boolean>} true если успешно
     */
    async function restoreFromKeyBackupBlob(password, blob, iterations) {
        if (!blob || !password || !crypto.subtle) return false;
        const parts = blob.split(':');
        if (parts.length !== 3) return false;
        try {
            const salt = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
            const iv = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
            const ct = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
            const key = await deriveKeyFromPassword(password, salt, iterations);
            const dec = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, tagLength: 128 },
                key,
                ct
            );
            const j = JSON.parse(new TextDecoder().decode(dec));
            if (!j || !j.publicKey || !j.privateKey) return false;
            const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
            const publicKey = await crypto.subtle.importKey('jwk', j.publicKey, ECDH, true, []);
            const privateKey = await crypto.subtle.importKey('jwk', j.privateKey, ECDH, false, ['deriveBits', 'deriveKey']);
            keyPair = { publicKey, privateKey };
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(E2EE_STORAGE_KEY, JSON.stringify(j));
            }
            clearRestoreFailCount();
            return true;
        } catch (e) {
            console.warn('E2EE: restoreFromKeyBackupBlob', e);
            return false;
        }
    }

    /**
     * Получить резервную копию с сервера (key_blob и has_backup).
     * @returns {Promise<{key_blob: string|null, has_backup: boolean}>}
     */
    async function fetchKeyBackup() {
        try {
            const r = await fetch(API_BASE + '/api/keys.php?action=key_backup', { credentials: 'include' });
            const data = await r.json().catch(() => ({}));
            if (data && data.success && data.data) {
                return {
                    key_blob: data.data.key_blob ?? null,
                    has_backup: !!(data.data.has_backup && data.data.key_blob)
                };
            }
            if (r.status === 429) {
                return { key_blob: null, has_backup: false, rate_limited: true };
            }
        } catch (e) {
            console.warn('E2EE: fetchKeyBackup', e);
        }
        return { key_blob: null, has_backup: false };
    }

    /**
     * Сохранить blob резервной копии на сервер.
     * @param {string} blob
     * @returns {Promise<boolean>}
     */
    async function saveKeyBackupToServer(blob) {
        try {
            const r = await fetch(API_BASE + '/api/keys.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ action: 'save_key_backup', key_blob: blob })
            });
            const data = await r.json().catch(() => ({}));
            return !!(data && data.success);
        } catch (e) {
            console.warn('E2EE: saveKeyBackupToServer', e);
            return false;
        }
    }

    /**
     * Создать резервную копию и отправить на сервер.
     * @param {string} password
     * @param {number} [iterations] — из getBackupLimits() если не задано
     * @returns {Promise<boolean>}
     */
    async function createAndSaveKeyBackup(password, iterations) {
        const limits = iterations != null ? { kdf_iterations: iterations } : await getBackupLimits();
        const iter = iterations ?? limits.kdf_iterations ?? 100000;
        const blob = await createKeyBackupBlob(password, iter);
        if (!blob) return false;
        return await saveKeyBackupToServer(blob);
    }

    /**
     * Восстановить ключи с сервера по паролю (получить blob, расшифровать, импортировать).
     * При неверном пароле вызывает reportDecryptionFailed и применяет прогрессивную задержку.
     * @param {string} password
     * @returns {Promise<{ok: boolean, rate_limited?: boolean}>}
     */
    async function restoreFromServerWithPassword(password) {
        const limits = await getBackupLimits();
        const { key_blob, has_backup, rate_limited } = await fetchKeyBackup();
        if (rate_limited) {
            return { ok: false, rate_limited: true };
        }
        if (!has_backup || !key_blob) {
            return { ok: false };
        }
        const ok = await restoreFromKeyBackupBlob(password, key_blob, limits.kdf_iterations);
        if (ok) {
            return { ok: true };
        }
        await reportDecryptionFailed();
        await applyProgressiveDelay(limits.client_delay_base_sec, limits.client_delay_max_sec);
        return { ok: false };
    }

    global.E2EE_KEYS = {
        init,
        generateKeyPair,
        exportPublicKeyJwk,
        uploadMyPublicKey,
        getRemotePublicKey,
        getKeyPair,
        deriveConversationKey,
        getOrCreateConversationKey,
        encryptPlaintext,
        decryptCiphertext,
        generateGroupKey,
        encryptGroupKeyForUser,
        decryptGroupKeyFromBlob,
        getOrCreateGroupConversationKey,
        setGroupKeyInCache,
        clearGroupKeyCache,
        ensureGroupKeyCreatedAndDistributed,
        storeGroupKeyForUser,
        hasStoredKeyPair,
        getBackupLimits,
        reportDecryptionFailed,
        createKeyBackupBlob,
        restoreFromKeyBackupBlob,
        fetchKeyBackup,
        saveKeyBackupToServer,
        createAndSaveKeyBackup,
        restoreFromServerWithPassword,
        applyProgressiveDelay,
        clearRestoreFailCount,
        isSupported: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
    };

    if (typeof window !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (window.E2EE_WEBAUTHN_LOCK && E2EE_WEBAUTHN_LOCK.isDeviceLockActive()) {
                window.dispatchEvent(new CustomEvent('e2ee-device-locked'));
                return;
            }
            if (E2EE_KEYS.hasStoredKeyPair()) {
                E2EE_KEYS.init(true).catch(function () {});
                return;
            }
            E2EE_KEYS.fetchKeyBackup().then(function (result) {
                if (result.has_backup && result.key_blob === null) {
                    result.key_blob = null;
                }
                if (result.has_backup) {
                    window.dispatchEvent(new CustomEvent('e2ee-need-restore', { detail: { rate_limited: result.rate_limited } }));
                    return;
                }
                if (result.rate_limited) {
                    window.dispatchEvent(new CustomEvent('e2ee-need-restore', { detail: { rate_limited: true } }));
                    return;
                }
                E2EE_KEYS.init(true).catch(function () {});
            }).catch(function () {
                E2EE_KEYS.init(true).catch(function () {});
            });
        });
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('e2ee-device-unlocked', function () {
            E2EE_KEYS.init(true).catch(function () {});
        });
    }
})(typeof window !== 'undefined' ? window : this);
