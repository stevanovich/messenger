/**
 * E2EE — этап 1: генерация ключей и обмен публичными ключами (Web Crypto API).
 * Используется для подготовки к end-to-end шифрованию; шифрование сообщений — этап 2.
 */
(function (global) {
    'use strict';

    const API_BASE = typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : '';
    const ECDH_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' };
    const E2EE_STORAGE_KEY = 'e2ee_keypair_jwk';
    const E2EE_KEYPAIRS_STORAGE_KEY = 'e2ee_keypairs_jwk';
    const E2EE_PERSIST_KEYS_FLAG = 'e2ee_persist_keys';
    const DEFAULT_ALGORITHM = 'ECDH-P256-AES-GCM';
    /** Алгоритмы, для которых клиент умеет генерировать ключи. ГОСТ подключается отдельным модулем (e2ee-gost.js). */
    let SUPPORTED_KEY_ALGORITHMS = [DEFAULT_ALGORITHM];

    function addSupportedAlgorithm(algorithm) {
        if (SUPPORTED_KEY_ALGORITHMS.indexOf(algorithm) === -1) SUPPORTED_KEY_ALGORITHMS.push(algorithm);
    }

    let keyPair = null;
    /** Ключи по алгоритму: { 'ECDH-P256-AES-GCM': { publicKey, privateKey } } — только для алгоритмов с Web Crypto (ECDH P-256). */
    let keyPairsByAlgorithm = Object.create(null);
    /** Кэш конфига с сервера: { algorithms: string[], key_backup?: object }. Приоритет алгоритмов = порядок в algorithms. */
    let e2eeConfigCache = null;
    /** Логировать ошибку расшифровки только один раз за сессию, чтобы не засорять консоль. */
    let decryptionErrorLogged = false;

    /**
     * Загружает конфиг E2EE с сервера (action=config). Кэширует результат. Приоритет алгоритмов задаётся сервером.
     * @returns {Promise<{algorithms: string[], key_backup?: object}>}
     */
    async function getE2EEConfig() {
        if (e2eeConfigCache) return e2eeConfigCache;
        try {
            const r = await fetch(API_BASE + '/api/keys.php?action=config', { credentials: 'include' });
            const data = await r.json().catch(() => ({}));
            if (data && data.success && data.data && Array.isArray(data.data.algorithms)) {
                e2eeConfigCache = {
                    algorithms: data.data.algorithms,
                    gost_key_agreement: data.data.gost_key_agreement || 'ECDH-P256',
                    key_backup: data.data.key_backup || null
                };
                return e2eeConfigCache;
            }
        } catch (e) {
            console.warn('E2EE: ошибка загрузки конфига', e);
        }
        e2eeConfigCache = { algorithms: [DEFAULT_ALGORITHM], gost_key_agreement: 'ECDH-P256', key_backup: null };
        return e2eeConfigCache;
    }

    /**
     * Список алгоритмов в порядке приоритета (как задано на сервере). Используется для выбора первого общего с собеседником.
     * При согласовании по ГОСТ Р 34.10 (VKO) алгоритмы ГОСТ включены и используют VKO.
     * @returns {Promise<string[]>}
     */
    async function getAlgorithms() {
        const cfg = await getE2EEConfig();
        return cfg.algorithms && cfg.algorithms.length ? cfg.algorithms : [DEFAULT_ALGORITHM];
    }

    /** Дождаться загрузки библиотеки VKO (ГОСТ Р 34.10), если она подключена. */
    function ensureGostVkoLoaded() {
        if (typeof window !== 'undefined' && window.E2EE_GOST_VKO) return Promise.resolve(window.E2EE_GOST_VKO);
        return new Promise(function (resolve) {
            if (typeof window === 'undefined') { resolve(null); return; }
            if (window.E2EE_GOST_VKO) { resolve(window.E2EE_GOST_VKO); return; }
            window.addEventListener('e2ee-gost-vko-ready', function onReady() {
                window.removeEventListener('e2ee-gost-vko-ready', onReady);
                resolve(window.E2EE_GOST_VKO || null);
            }, { once: true });
            setTimeout(function () { resolve(window.E2EE_GOST_VKO || null); }, 15000);
        });
    }

    const GOST_CURVE_NAME = 'ID_GOSTR3410_2012_512_PARAM_SET_A';

    function base64urlEncode(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64urlDecode(str) {
        if (!str || typeof str !== 'string') return null;
        var base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        var pad = base64.length % 4;
        if (pad) base64 += new Array(5 - pad).join('=');
        try {
            var binary = atob(base64);
            var out = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
            return out;
        } catch (e) {
            return null;
        }
    }

    function deserializeKeyPairsFromStorage(parsed) {
        if (!parsed || typeof parsed !== 'object') return parsed;
        var out = {};
        for (var k in parsed) {
            if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue;
            var v = parsed[k];
            if (v && v.type === 'gost' && v.privateKeyB64 && v.publicKeyB64) {
                try {
                    var priv = Uint8Array.from(atob(v.privateKeyB64), function (c) { return c.charCodeAt(0); });
                    var pub = Uint8Array.from(atob(v.publicKeyB64), function (c) { return c.charCodeAt(0); });
                    out[k] = { type: 'gost', privateKey: priv, publicKey: pub };
                } catch (e) { out[k] = v; }
            } else {
                out[k] = v;
            }
        }
        return out;
    }

    function serializeKeyPairsForStorage(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        var out = {};
        for (var k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
            var v = obj[k];
            if (v && v.type === 'gost' && v.privateKey && v.publicKey) {
                out[k] = {
                    type: 'gost',
                    privateKeyB64: btoa(String.fromCharCode.apply(null, v.privateKey)),
                    publicKeyB64: btoa(String.fromCharCode.apply(null, v.publicKey))
                };
            } else {
                out[k] = v;
            }
        }
        return out;
    }

    function isPersistKeysEnabled() {
        try {
            if (typeof localStorage === 'undefined') return false;
            return localStorage.getItem(E2EE_PERSIST_KEYS_FLAG) === '1';
        } catch (e) { return false; }
    }

    function clearPersistedKeyPairs() {
        try {
            if (typeof localStorage === 'undefined') return;
            localStorage.removeItem(E2EE_KEYPAIRS_STORAGE_KEY);
            localStorage.removeItem(E2EE_STORAGE_KEY);
        } catch (e) {}
    }

    /**
     * Загружает ключи из sessionStorage или localStorage (если включено сохранение после закрытия браузера).
     * Сначала новый формат (по алгоритмам), при отсутствии — старый и миграция.
     */
    function loadKeyPairsFromStorage() {
        var parsed;
        if (isPersistKeysEnabled() && typeof localStorage !== 'undefined') {
            try {
                var newStored = localStorage.getItem(E2EE_KEYPAIRS_STORAGE_KEY);
                if (newStored) {
                    parsed = JSON.parse(newStored);
                    if (parsed && typeof parsed === 'object') {
                        keyPairsByAlgorithm = deserializeKeyPairsFromStorage(parsed);
                        if (typeof sessionStorage !== 'undefined') {
                            sessionStorage.setItem(E2EE_KEYPAIRS_STORAGE_KEY, newStored);
                        }
                        return;
                    }
                }
                var oldStored = localStorage.getItem(E2EE_STORAGE_KEY);
                if (oldStored) {
                    parsed = JSON.parse(oldStored);
                    if (parsed && parsed.publicKey && parsed.privateKey) {
                        keyPairsByAlgorithm = { [DEFAULT_ALGORITHM]: { publicKey: parsed.publicKey, privateKey: parsed.privateKey } };
                        var serialized = JSON.stringify(serializeKeyPairsForStorage(keyPairsByAlgorithm));
                        localStorage.setItem(E2EE_KEYPAIRS_STORAGE_KEY, serialized);
                        try { localStorage.removeItem(E2EE_STORAGE_KEY); } catch (_) {}
                        if (typeof sessionStorage !== 'undefined') {
                            sessionStorage.setItem(E2EE_KEYPAIRS_STORAGE_KEY, serialized);
                        }
                        return;
                    }
                }
            } catch (e) {}
        }
        if (typeof sessionStorage === 'undefined') return;
        try {
            var newStored = sessionStorage.getItem(E2EE_KEYPAIRS_STORAGE_KEY);
            if (newStored) {
                parsed = JSON.parse(newStored);
                if (parsed && typeof parsed === 'object') {
                    keyPairsByAlgorithm = deserializeKeyPairsFromStorage(parsed);
                    return;
                }
            }
            var oldStored = sessionStorage.getItem(E2EE_STORAGE_KEY);
            if (oldStored) {
                parsed = JSON.parse(oldStored);
                if (parsed && parsed.publicKey && parsed.privateKey) {
                    keyPairsByAlgorithm = { [DEFAULT_ALGORITHM]: { publicKey: parsed.publicKey, privateKey: parsed.privateKey } };
                    sessionStorage.setItem(E2EE_KEYPAIRS_STORAGE_KEY, JSON.stringify(serializeKeyPairsForStorage(keyPairsByAlgorithm)));
                    try { sessionStorage.removeItem(E2EE_STORAGE_KEY); } catch (_) {}
                }
            }
        } catch (e) {}
    }

    function saveKeyPairsToStorage() {
        try {
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(E2EE_KEYPAIRS_STORAGE_KEY, JSON.stringify(serializeKeyPairsForStorage(keyPairsByAlgorithm)));
            }
            if (isPersistKeysEnabled() && typeof localStorage !== 'undefined') {
                localStorage.setItem(E2EE_KEYPAIRS_STORAGE_KEY, JSON.stringify(serializeKeyPairsForStorage(keyPairsByAlgorithm)));
            } else {
                clearPersistedKeyPairs();
            }
        } catch (e) {}
    }

    /**
     * Генерирует или загружает пару ключей для алгоритма (только ECDH-P256-AES-GCM поддерживается через Web Crypto).
     * @param {string} algorithm
     * @returns {Promise<CryptoKeyPair|null>}
     */
    const GOST_ALGORITHM = 'GOST-Kuznechik-MGM';
    const GOST_MAGMA_ALGORITHM = 'GOST-Magma-MGM';

    async function generateKeyPairForAlgorithm(algorithm) {
        var cfg = await getE2EEConfig();
        var useGostVko = (cfg.gost_key_agreement === 'GOST-R-34.10') && (algorithm === GOST_ALGORITHM || algorithm === GOST_MAGMA_ALGORITHM);

        if ((algorithm === GOST_ALGORITHM || algorithm === GOST_MAGMA_ALGORITHM) && !useGostVko) {
            var pair = await generateKeyPairForAlgorithm(DEFAULT_ALGORITHM);
            if (pair && keyPairsByAlgorithm && keyPairsByAlgorithm[DEFAULT_ALGORITHM]) {
                keyPairsByAlgorithm[algorithm] = keyPairsByAlgorithm[DEFAULT_ALGORITHM];
                saveKeyPairsToStorage();
            }
            return pair;
        }

        if (!keyPairsByAlgorithm || Object.keys(keyPairsByAlgorithm).length === 0) {
            loadKeyPairsFromStorage();
        }

        if (keyPairsByAlgorithm && keyPairsByAlgorithm[algorithm]) {
            var jwks = keyPairsByAlgorithm[algorithm];
            if (jwks.type === 'gost') return jwks;
            if (algorithm === DEFAULT_ALGORITHM) {
                try {
                    var publicKey = await crypto.subtle.importKey('jwk', jwks.publicKey, ECDH_ALGORITHM, true, []);
                    var privateKey = await crypto.subtle.importKey('jwk', jwks.privateKey, ECDH_ALGORITHM, false, ['deriveBits', 'deriveKey']);
                    return { publicKey: publicKey, privateKey: privateKey };
                } catch (e) {
                    console.warn('E2EE: ошибка импорта ключа для ' + algorithm, e);
                }
            }
            return null;
        }

        if (useGostVko) {
            var vko = await ensureGostVkoLoaded();
            if (!vko || !vko.getPublicKey || !vko.kek_34102012256 || !vko[GOST_CURVE_NAME]) return null;
            var curve = vko[GOST_CURVE_NAME];
            var privBytes = crypto.getRandomValues(new Uint8Array(64));
            var pubBytes = vko.getPublicKey(curve, privBytes);
            if (!pubBytes) return null;
            if (!keyPairsByAlgorithm || typeof keyPairsByAlgorithm !== 'object') keyPairsByAlgorithm = Object.create(null);
            var gostPair = { type: 'gost', privateKey: privBytes, publicKey: pubBytes };
            keyPairsByAlgorithm[GOST_ALGORITHM] = gostPair;
            keyPairsByAlgorithm[GOST_MAGMA_ALGORITHM] = gostPair;
            saveKeyPairsToStorage();
            return gostPair;
        }

        if (SUPPORTED_KEY_ALGORITHMS.indexOf(algorithm) === -1) return null;
        if (!crypto.subtle) return null;
        try {
            var pair = await crypto.subtle.generateKey(ECDH_ALGORITHM, true, ['deriveBits', 'deriveKey']);
            var publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
            var privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
            if (!keyPairsByAlgorithm || typeof keyPairsByAlgorithm !== 'object') keyPairsByAlgorithm = Object.create(null);
            keyPairsByAlgorithm[algorithm] = { publicKey: publicJwk, privateKey: privateJwk };
            saveKeyPairsToStorage();
            return pair;
        } catch (e) {
            console.warn('E2EE: ошибка генерации ключа для ' + algorithm, e);
            return null;
        }
    }

    /**
     * Загружает пару ключей из sessionStorage (если есть), иначе генерирует новую и сохраняет.
     * Для обратной совместимости возвращает ключ для ECDH-P256-AES-GCM (или первый доступный).
     * @returns {Promise<CryptoKeyPair|null>}
     */
    async function generateKeyPair() {
        if (keyPair) return keyPair;
        if (!crypto.subtle) {
            console.warn('E2EE: crypto.subtle недоступен');
            return null;
        }
        try {
            loadKeyPairsFromStorage();
            const algorithms = await getAlgorithms();
            for (let i = 0; i < algorithms.length; i++) {
                const algo = algorithms[i];
                if (algo === DEFAULT_ALGORITHM) {
                    const pair = await generateKeyPairForAlgorithm(algo);
                    if (pair) {
                        keyPair = pair;
                        return keyPair;
                    }
                }
            }
            const pair = await generateKeyPairForAlgorithm(DEFAULT_ALGORITHM);
            if (pair) keyPair = pair;
            return keyPair;
        } catch (e) {
            console.warn('E2EE: ошибка генерации/загрузки ключей', e);
            keyPair = null;
            return null;
        }
    }

    /**
     * Экспортирует публичный ключ в формате JWK (для указанного алгоритма или первого доступного).
     * @param {string} [algorithm] — идентификатор алгоритма, иначе используется первый из конфига
     * @returns {Promise<object|null>}
     */
    async function exportPublicKeyJwk(algorithm) {
        if (algorithm) {
            var pair = await generateKeyPairForAlgorithm(algorithm);
            if (!pair) return null;
            if (pair.type === 'gost' && pair.publicKey) return { kty: 'GOST-R-34.10', curve: GOST_CURVE_NAME, publicKey: base64urlEncode(pair.publicKey) };
            try {
                return await crypto.subtle.exportKey('jwk', pair.publicKey);
            } catch (e) {
                return null;
            }
        }
        var pair = await generateKeyPair();
        if (!pair) return null;
        if (pair.type === 'gost' && pair.publicKey) return { kty: 'GOST-R-34.10', curve: GOST_CURVE_NAME, publicKey: base64urlEncode(pair.publicKey) };
        try {
            return await crypto.subtle.exportKey('jwk', pair.publicKey);
        } catch (e) {
            console.warn('E2EE: ошибка экспорта публичного ключа', e);
            return null;
        }
    }

    /**
     * Отправляет публичные ключи на сервер для всех алгоритмов из конфига (приоритет задаётся сервером).
     * @returns {Promise<boolean>}
     */
    async function uploadMyPublicKey() {
        const algorithms = await getAlgorithms();
        let anyOk = false;
        for (let i = 0; i < algorithms.length; i++) {
            const algo = algorithms[i];
            const jwk = await exportPublicKeyJwk(algo);
            if (!jwk) continue;
            try {
                const r = await fetch(API_BASE + '/api/keys.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ public_key: jwk, algorithm: algo })
                });
                const data = await r.json().catch(() => ({}));
                if (data && data.success) anyOk = true;
            } catch (e) {
                console.warn('E2EE: ошибка загрузки ключа на сервер для ' + algo, e);
            }
        }
        return anyOk;
    }

    /**
     * Получает все публичные ключи пользователя с сервера (массив по алгоритмам).
     * @param {string} userUuid
     * @returns {Promise<{algorithm: string, public_key: object, updated_at?: string}[]>}
     */
    async function getRemotePublicKeys(userUuid) {
        if (!userUuid) return [];
        try {
            const r = await fetch(API_BASE + '/api/keys.php?user_uuid=' + encodeURIComponent(userUuid), { credentials: 'include' });
            const data = await r.json().catch(() => ({}));
            if (!data || !data.success || !data.data) return [];
            if (Array.isArray(data.data.keys)) {
                return data.data.keys.map(function (k) {
                    return { algorithm: k.algorithm, public_key: k.public_key, updated_at: k.updated_at };
                });
            }
            if (data.data.public_key) {
                return [{ algorithm: data.data.algorithm || DEFAULT_ALGORITHM, public_key: data.data.public_key, updated_at: data.data.updated_at }];
            }
            return [];
        } catch (e) {
            console.warn('E2EE: ошибка получения ключей пользователя', e);
            return [];
        }
    }

    /**
     * Выбирает первый общий алгоритм по приоритету сервера: первый из списка сервера, для которого есть ключ у нас и у удалённой стороны.
     * @param {{algorithm: string, public_key: object}[]} remoteKeys
     * @returns {Promise<string|null>}
     */
    async function pickFirstCommonAlgorithm(remoteKeys) {
        const serverOrder = await getAlgorithms();
        for (let i = 0; i < serverOrder.length; i++) {
            const algo = serverOrder[i];
            const weHave = await generateKeyPairForAlgorithm(algo);
            if (!weHave) continue;
            for (let j = 0; j < remoteKeys.length; j++) {
                if (remoteKeys[j].algorithm === algo && remoteKeys[j].public_key) return algo;
            }
        }
        return null;
    }

    /**
     * Получает публичный ключ пользователя (один ключ для первого общего алгоритма — обратная совместимость).
     * @param {string} userUuid
     * @returns {Promise<object|null>} JWK публичного ключа или null
     */
    async function getRemotePublicKey(userUuid) {
        const keys = await getRemotePublicKeys(userUuid);
        const algo = await pickFirstCommonAlgorithm(keys);
        if (!algo) return null;
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].algorithm === algo) return keys[i].public_key;
        }
        return null;
    }

    /**
     * Инициализация: генерирует ключи для всех алгоритмов из конфига сервера и опционально регистрирует их.
     * Приоритет алгоритмов задаётся только на сервере.
     * @param {boolean} registerOnServer — загрузить публичные ключи на сервер
     * @returns {Promise<boolean>}
     */
    async function init(registerOnServer) {
        const algorithms = await getAlgorithms();
        let hasAny = false;
        for (let i = 0; i < algorithms.length; i++) {
            const pair = await generateKeyPairForAlgorithm(algorithms[i]);
            if (pair) {
                hasAny = true;
                if (!keyPair) keyPair = pair;
            }
        }
        if (!hasAny && !keyPair) {
            const p = await generateKeyPair();
            if (!p) return false;
        }
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
    const E2EE_REMOTE_KEYS_PREFIX = 'e2ee_remote_keys_';
    const MAX_PREVIOUS_REMOTE_KEYS = 2;

    function jwkFingerprint(jwk) {
        if (!jwk || typeof jwk !== 'object') return '';
        if (jwk.kty === 'GOST-R-34.10') return 'GOST-R-34.10|' + (jwk.publicKey || '');
        return (jwk.kty || '') + '|' + (jwk.crv || '') + '|' + (jwk.x || '') + '|' + (jwk.y || '');
    }

    function loadRemoteKeysState(conversationId) {
        try {
            if (typeof localStorage === 'undefined') return { currentJwk: null, previousJwks: [] };
            const raw = localStorage.getItem(E2EE_REMOTE_KEYS_PREFIX + String(conversationId));
            if (!raw) return { currentJwk: null, previousJwks: [] };
            const data = JSON.parse(raw);
            return {
                currentJwk: data.currentJwk || null,
                previousJwks: Array.isArray(data.previousJwks) ? data.previousJwks : []
            };
        } catch (e) {
            return { currentJwk: null, previousJwks: [] };
        }
    }

    function saveRemoteKeysState(conversationId, currentJwk, previousJwks) {
        try {
            if (typeof localStorage === 'undefined') return;
            const key = E2EE_REMOTE_KEYS_PREFIX + String(conversationId);
            if (!currentJwk && (!previousJwks || !previousJwks.length)) {
                localStorage.removeItem(key);
                return;
            }
            localStorage.setItem(key, JSON.stringify({
                currentJwk: currentJwk || null,
                previousJwks: (previousJwks || []).slice(0, MAX_PREVIOUS_REMOTE_KEYS)
            }));
        } catch (e) {}
    }

    /**
     * Выводит общий ключ беседы (AES-GCM или ГОСТ) из ECDH либо VKO (ГОСТ Р 34.10) с публичным ключом собеседника.
     * @param {object} remotePublicKeyJwk — JWK или ГОСТ-ключ (kty, publicKey) другого пользователя
     * @param {string} [algorithm] — идентификатор алгоритма
     * @param {number|string} [conversationId] — для VKO используется как материал UKM (детерминированно для обеих сторон)
     * @returns {Promise<CryptoKey|{type:'gost',keyBytes:Uint8Array,algorithm:string}|null>}
     */
    async function deriveConversationKey(remotePublicKeyJwk, algorithm, conversationId) {
        var algo = algorithm || DEFAULT_ALGORITHM;
        var myPair = await generateKeyPairForAlgorithm(algo);
        if (!myPair || !remotePublicKeyJwk) return null;

        if (myPair.type === 'gost' && remotePublicKeyJwk.kty === 'GOST-R-34.10') {
            var vko = await ensureGostVkoLoaded();
            if (!vko || !vko.kek_34102012256 || !vko[GOST_CURVE_NAME]) return null;
            var remotePubBytes = base64urlDecode(remotePublicKeyJwk.publicKey);
            if (!remotePubBytes) return null;
            var ukmInput = new TextEncoder().encode('e2ee-vko-' + (conversationId != null ? String(conversationId) : ''));
            var ukmHash = await crypto.subtle.digest('SHA-256', ukmInput);
            var ukm = new Uint8Array(ukmHash).slice(0, 8);
            try {
                var kek = vko.kek_34102012256(vko[GOST_CURVE_NAME], myPair.privateKey, remotePubBytes, ukm);
                if (!kek || kek.length !== 32) return null;
                return { type: 'gost', keyBytes: kek instanceof Uint8Array ? kek : new Uint8Array(kek), algorithm: algo };
            } catch (e) {
                console.warn('E2EE: ошибка VKO', e);
                return null;
            }
        }

        if (!crypto.subtle) return null;
        // Для ECDH deriveBits нужна пара Web Crypto (CryptoKey); пара ГОСТ — это байты, не CryptoKey
        if (myPair.type === 'gost') {
            myPair = await generateKeyPairForAlgorithm(DEFAULT_ALGORITHM);
            if (!myPair || !myPair.privateKey) return null;
        }
        try {
            var remotePublic = await crypto.subtle.importKey(
                'jwk',
                remotePublicKeyJwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                []
            );
            var sharedBits = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: remotePublic },
                myPair.privateKey,
                256
            );
            var hash = await crypto.subtle.digest('SHA-256', sharedBits);
            if (algo === GOST_ALGORITHM || algo === GOST_MAGMA_ALGORITHM) {
                return { type: 'gost', keyBytes: new Uint8Array(hash), algorithm: algo };
            }
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
     * Получает или создаёт ключ беседы для личного чата (1-на-1). Алгоритм выбирается по приоритету сервера (первый общий).
     * Кэширует по conversationId; в кэше хранится также algorithm для передачи в encryption_algorithm при отправке.
     * @param {number} conversationId
     * @param {string} otherUserUuid — UUID собеседника
     * @returns {Promise<CryptoKey|null>} ключ для шифрования (новые сообщения)
     */
    async function getOrCreateConversationKey(conversationId, otherUserUuid) {
        if (!conversationId || !otherUserUuid) return null;
        const cacheKey = String(conversationId);
        const cached = CONV_KEY_CACHE.get(cacheKey);
        if (cached && cached.encryptionKey) return cached.encryptionKey;
        if (cached) return cached;

        const remoteKeys = await getRemotePublicKeys(otherUserUuid);
        const chosenAlgo = await pickFirstCommonAlgorithm(remoteKeys);
        if (!chosenAlgo) return null;
        let remoteJwk = null;
        for (let i = 0; i < remoteKeys.length; i++) {
            if (remoteKeys[i].algorithm === chosenAlgo) {
                remoteJwk = remoteKeys[i].public_key;
                break;
            }
        }
        if (!remoteJwk) return null;

        let state = loadRemoteKeysState(conversationId);
        const currentFp = jwkFingerprint(remoteJwk);
        const savedFp = jwkFingerprint(state.currentJwk);
        if (savedFp && savedFp !== currentFp) {
            state.previousJwks = [state.currentJwk].concat(state.previousJwks).slice(0, MAX_PREVIOUS_REMOTE_KEYS);
        }
        state.currentJwk = remoteJwk;
        saveRemoteKeysState(conversationId, state.currentJwk, state.previousJwks);

        const encryptionKey = await deriveConversationKey(remoteJwk, chosenAlgo, conversationId);
        if (!encryptionKey) return null;
        const decryptionKeys = [encryptionKey];
        for (let i = 0; i < state.previousJwks.length; i++) {
            const k = await deriveConversationKey(state.previousJwks[i], chosenAlgo, conversationId);
            if (k) decryptionKeys.push(k);
        }
        CONV_KEY_CACHE.set(cacheKey, { encryptionKey, algorithm: chosenAlgo, decryptionKeys });
        return encryptionKey;
    }

    /**
     * Возвращает идентификатор алгоритма, выбранного для беседы (по приоритету сервера). Для передачи в encryption_algorithm при отправке.
     * @param {number} conversationId
     * @returns {string|null}
     */
    function getConversationAlgorithm(conversationId) {
        if (!conversationId) return null;
        const cached = CONV_KEY_CACHE.get(String(conversationId));
        return (cached && cached.algorithm) ? cached.algorithm : null;
    }

    /**
     * Возвращает массив ключей для расшифровки сообщений личного чата (текущий + предыдущие после смены ключей).
     * Вызывать после getOrCreateConversationKey(conversationId, otherUserUuid).
     * @param {number} conversationId
     * @returns {CryptoKey[]}
     */
    function getConversationDecryptionKeys(conversationId) {
        if (!conversationId) return [];
        const cached = CONV_KEY_CACHE.get(String(conversationId));
        if (cached && cached.decryptionKeys) return cached.decryptionKeys;
        if (cached) return [cached];
        return [];
    }

    /**
     * Расшифровывает сообщение, перебирая ключи (текущий и предыдущие). Для старых сообщений после смены ключей у собеседника.
     * @param {string} payload — ivBase64:ciphertextBase64
     * @param {CryptoKey[]} keysArray — массив ключей для перебора
     * @returns {Promise<string|null>}
     */
    async function decryptCiphertextWithKeys(payload, keysArray) {
        if (!payload || typeof payload !== 'string' || !keysArray || !keysArray.length) return null;
        for (let i = 0; i < keysArray.length; i++) {
            const dec = await decryptCiphertext(payload, keysArray[i]);
            if (dec !== null) return dec;
        }
        return null;
    }

    /**
     * Шифрует текст сообщения (AES-GCM, IV 12 байт). Возвращает строку "ivBase64: ciphertextBase64".
     * @param {string} plaintext
     * @param {CryptoKey} conversationKey
     * @returns {Promise<string|null>}
     */
    async function encryptPlaintext(plaintext, conversationKey) {
        if (!conversationKey) return null;
        if (conversationKey.type === 'gost' && conversationKey.keyBytes && typeof window !== 'undefined' && window.E2EE_GOST) {
            const gost = window.E2EE_GOST;
            const result = conversationKey.algorithm === GOST_MAGMA_ALGORITHM
                ? gost.encryptMagmaMGM(plaintext, conversationKey.keyBytes)
                : gost.encrypt(plaintext, conversationKey.keyBytes);
            return result !== null ? result : null;
        }
        if (!crypto.subtle) return null;
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
        if (conversationKey.type === 'gost' && conversationKey.keyBytes && typeof window !== 'undefined' && window.E2EE_GOST) {
            const gost = window.E2EE_GOST;
            return conversationKey.algorithm === GOST_MAGMA_ALGORITHM
                ? gost.decryptMagmaMGM(payload, conversationKey.keyBytes)
                : gost.decrypt(payload, conversationKey.keyBytes);
        }
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
            if (!decryptionErrorLogged) {
                decryptionErrorLogged = true;
                console.warn('E2EE: ошибка расшифровки (ключи недоступны или не подходят). Часть сообщений показывается как недоступные. Восстановите ключи: Настройки → Аккаунт → Восстановить ключи.');
            }
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
     * Шифрует ключ группы для участника (ECDH или VKO с его публичным ключом + AES-GCM/ГОСТ). Формат "ivBase64:ciphertextBase64".
     * @param {CryptoKey} groupKey
     * @param {object} remotePublicKeyJwk
     * @param {string} [algorithm]
     * @param {number|string} [conversationId] — для VKO (UKM)
     * @returns {Promise<string|null>}
     */
    async function encryptGroupKeyForUser(groupKey, remotePublicKeyJwk, algorithm, conversationId) {
        const derived = await deriveConversationKey(remotePublicKeyJwk, algorithm || DEFAULT_ALGORITHM, conversationId);
        if (!derived) return null;
        try {
            const raw = await crypto.subtle.exportKey('raw', groupKey);
            const rawArr = new Uint8Array(raw);
            if (derived.type === 'gost' && derived.keyBytes && typeof window !== 'undefined' && window.E2EE_GOST) {
                const plainB64 = btoa(String.fromCharCode.apply(null, rawArr));
                const gost = window.E2EE_GOST;
                return derived.algorithm === GOST_MAGMA_ALGORITHM
                    ? gost.encryptMagmaMGM(plainB64, derived.keyBytes)
                    : gost.encrypt(plainB64, derived.keyBytes);
            }
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
     * @param {string|null} [algorithm]
     * @param {number|string} [conversationId] — для VKO (UKM)
     * @returns {Promise<CryptoKey|null>}
     */
    async function decryptGroupKeyFromBlob(blob, encryptedByUuid, algorithm, conversationId) {
        if (!blob || !encryptedByUuid) return null;
        let remoteJwk = null;
        if (algorithm) {
            const keys = await getRemotePublicKeys(encryptedByUuid);
            for (let i = 0; i < keys.length; i++) {
                if (keys[i].algorithm === algorithm) {
                    remoteJwk = keys[i].public_key;
                    break;
                }
            }
        }
        if (!remoteJwk) remoteJwk = await getRemotePublicKey(encryptedByUuid);
        const derived = await deriveConversationKey(remoteJwk, algorithm || DEFAULT_ALGORITHM, conversationId);
        if (!derived) return null;
        if (derived.type === 'gost' && derived.keyBytes && typeof window !== 'undefined' && window.E2EE_GOST) {
            const gost = window.E2EE_GOST;
            const plainB64 = derived.algorithm === GOST_MAGMA_ALGORITHM
                ? gost.decryptMagmaMGM(blob, derived.keyBytes)
                : gost.decrypt(blob, derived.keyBytes);
            if (!plainB64) return null;
            try {
                const raw = Uint8Array.from(atob(plainB64), c => c.charCodeAt(0));
                return await crypto.subtle.importKey(
                    'raw',
                    raw,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
            } catch (e) {
                console.warn('E2EE: ошибка импорта ключа группы (GOST)', e);
                return null;
            }
        }
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
            const key = await decryptGroupKeyFromBlob(data.data.key_blob, data.data.encrypted_by_uuid, data.data.algorithm || null, conversationId);
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
            const remoteKeys = await getRemotePublicKeys(userUuid);
            const algo = await pickFirstCommonAlgorithm(remoteKeys);
            if (!algo) continue;
            let jwk = null;
            for (let i = 0; i < remoteKeys.length; i++) {
                if (remoteKeys[i].algorithm === algo) {
                    jwk = remoteKeys[i].public_key;
                    break;
                }
            }
            if (jwk) {
                const blob = await encryptGroupKeyForUser(groupKey, jwk, algo, conversationId);
                if (blob) await storeGroupKeyForUser(conversationId, userUuid, blob, algo);
            }
        }
        return groupKey;
    }

    /**
     * Отправляет зашифрованный ключ группы участнику на сервер (POST set_group_key).
     * @param {number} conversationId
     * @param {string} userUuid
     * @param {string} keyBlob
     * @param {string|null} [algorithm] — алгоритм (по приоритету сервера)
     * @returns {Promise<boolean>}
     */
    async function storeGroupKeyForUser(conversationId, userUuid, keyBlob, algorithm) {
        try {
            const body = { action: 'set_group_key', conversation_id: conversationId, user_uuid: userUuid, key_blob: keyBlob };
            if (algorithm) body.algorithm = algorithm;
            const r = await fetch(API_BASE + '/api/keys.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
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
            var storages = [];
            if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
            if (isPersistKeysEnabled() && typeof localStorage !== 'undefined') storages.push(localStorage);
            for (var i = 0; i < storages.length; i++) {
                var storage = storages[i];
                var newS = storage.getItem(E2EE_KEYPAIRS_STORAGE_KEY);
                if (newS) {
                    var parsed = JSON.parse(newS);
                    if (parsed && typeof parsed === 'object') {
                        var first = parsed[DEFAULT_ALGORITHM] || (parsed[Object.keys(parsed)[0]]);
                        if (first && first.publicKey && first.privateKey) return first;
                    }
                }
                var s = storage.getItem(E2EE_STORAGE_KEY);
                if (s) {
                    var j = JSON.parse(s);
                    if (j && j.publicKey && j.privateKey) return j;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Есть ли сохранённая пара ключей в sessionStorage или localStorage (при включённом сохранении).
     * @returns {boolean}
     */
    function hasStoredKeyPair() {
        if (typeof sessionStorage === 'undefined' && !isPersistKeysEnabled()) return false;
        loadKeyPairsFromStorage();
        if (keyPairsByAlgorithm && Object.keys(keyPairsByAlgorithm).length > 0) return true;
        const j = getStoredKeyPairJson();
        return !!(j && j.publicKey && j.privateKey);
    }

    function setPersistKeys(enabled) {
        try {
            if (typeof localStorage === 'undefined') return;
            localStorage.setItem(E2EE_PERSIST_KEYS_FLAG, enabled ? '1' : '0');
            if (enabled) {
                saveKeyPairsToStorage();
            } else {
                clearPersistedKeyPairs();
            }
        } catch (e) {}
    }

    function getPersistKeys() {
        return isPersistKeysEnabled();
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
     * Получить параметры защиты с сервера (для клиентской задержки и KDF). Использует action=config при наличии.
     * @returns {Promise<{client_delay_base_sec: number, client_delay_max_sec: number, kdf_iterations: number}>}
     */
    async function getBackupLimits() {
        const cfg = await getE2EEConfig();
        if (cfg.key_backup && typeof cfg.key_backup === 'object') {
            return {
                client_delay_base_sec: cfg.key_backup.client_delay_base_sec ?? 2,
                client_delay_max_sec: cfg.key_backup.client_delay_max_sec ?? 300,
                kdf_iterations: cfg.key_backup.kdf_iterations ?? 100000
            };
        }
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
     * Создать зашифрованный blob ключей для резервной копии.
     * Новый формат: в ciphertext хранится { keys: { "ECDH-P256-AES-GCM": { publicKey, privateKey }, ... } }.
     * Внешний формат: saltB64:ivB64:ciphertextB64
     * @param {string} password
     * @param {number} iterations
     * @returns {Promise<string|null>}
     */
    async function createKeyBackupBlob(password, iterations) {
        if (!crypto.subtle) return null;
        loadKeyPairsFromStorage();
        var keysToSave = null;
        if (keyPairsByAlgorithm && Object.keys(keyPairsByAlgorithm).length > 0) {
            keysToSave = serializeKeyPairsForStorage(keyPairsByAlgorithm);
        } else {
            var j = getStoredKeyPairJson();
            if (j && j.publicKey && j.privateKey) {
                keysToSave = { [DEFAULT_ALGORITHM]: { publicKey: j.publicKey, privateKey: j.privateKey } };
            }
        }
        if (!keysToSave || Object.keys(keysToSave).length === 0) return null;
        var payload = { keys: keysToSave };
        try {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await deriveKeyFromPassword(password, salt, iterations);
            const plaintext = new TextEncoder().encode(JSON.stringify(payload));
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
     * Поддерживает новый формат { keys: { "algo": { publicKey, privateKey }, ... } } и старый (одна пара = ECDH-P256-AES-GCM).
     * После восстановления перерегистрирует публичные ключи на сервере.
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
            if (!j) return false;

            const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
            keyPairsByAlgorithm = Object.create(null);

            if (j.keys && typeof j.keys === 'object') {
                keyPairsByAlgorithm = deserializeKeyPairsFromStorage(j.keys);
            } else if (j.publicKey && j.privateKey) {
                keyPairsByAlgorithm = { [DEFAULT_ALGORITHM]: { publicKey: j.publicKey, privateKey: j.privateKey } };
            }

            if (!keyPairsByAlgorithm || Object.keys(keyPairsByAlgorithm).length === 0) return false;

            if (typeof sessionStorage !== 'undefined') {
                saveKeyPairsToStorage();
            }

            var defaultEntry = keyPairsByAlgorithm[DEFAULT_ALGORITHM] || keyPairsByAlgorithm[Object.keys(keyPairsByAlgorithm)[0]];
            if (defaultEntry && defaultEntry.publicKey && defaultEntry.privateKey && defaultEntry.type !== 'gost') {
                try {
                    var publicKey = await crypto.subtle.importKey('jwk', defaultEntry.publicKey, ECDH, true, []);
                    var privateKey = await crypto.subtle.importKey('jwk', defaultEntry.privateKey, ECDH, false, ['deriveBits', 'deriveKey']);
                    keyPair = { publicKey: publicKey, privateKey: privateKey };
                } catch (e) {
                    keyPair = null;
                }
            } else {
                keyPair = null;
            }

            clearRestoreFailCount();
            CONV_KEY_CACHE.clear();
            uploadMyPublicKey().catch(function () {});
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
        getRemotePublicKeys,
        getAlgorithms,
        getE2EEConfig,
        addSupportedAlgorithm,
        getKeyPair,
        deriveConversationKey,
        getOrCreateConversationKey,
        getConversationAlgorithm,
        getConversationDecryptionKeys,
        decryptCiphertextWithKeys,
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
        getPersistKeys,
        setPersistKeys,
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
