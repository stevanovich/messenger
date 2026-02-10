/**
 * E2EE п. 5.3: блокировка доступа к ключам на устройстве по WebAuthn (отпечаток / Face ID) + запасной PIN/пароль.
 * Ключи хранятся в зашифрованном виде в localStorage и выпускаются только после успешной биометрии или ввода PIN.
 */
(function (global) {
    'use strict';

    const LOCK_STORAGE_PREFIX = 'e2ee_lock_';
    const LOCK_FLAG = LOCK_STORAGE_PREFIX + 'active';
    const CREDENTIAL_ID_KEY = LOCK_STORAGE_PREFIX + 'credential_id';
    const LOCKED_BLOB_KEY = LOCK_STORAGE_PREFIX + 'blob';
    const SALT_KEY = LOCK_STORAGE_PREFIX + 'salt';
    const E2EE_STORAGE_KEY = 'e2ee_keypair_jwk';
    const PIN_KDF_ITERATIONS = 100000;

    function bufferToBase64url(buf) {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64urlToBuffer(str) {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    function getStorage(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function setStorage(key, value) {
        try {
            if (value == null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch (e) {}
    }

    /**
     * Поддерживается ли WebAuthn (платформенный аутентификатор, userVerification).
     */
    function isWebAuthnSupported() {
        return typeof window !== 'undefined' &&
            window.PublicKeyCredential &&
            typeof window.PublicKeyCredential === 'function' &&
            window.navigator && typeof window.navigator.credentials !== 'undefined';
    }

    /**
     * Включена ли блокировка на устройстве (есть зашифрованный blob и флаг).
     */
    function isDeviceLockActive() {
        const flag = getStorage(LOCK_FLAG);
        const blob = getStorage(LOCKED_BLOB_KEY);
        return flag === '1' && !!blob;
    }

    function deriveKeyFromPin(pin, salt) {
        const enc = new TextEncoder();
        return crypto.subtle.importKey(
            'raw',
            enc.encode(pin),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        ).then(function (keyMaterial) {
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: salt, iterations: PIN_KDF_ITERATIONS, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        });
    }

    /**
     * Зашифровать ключи (JSON ключевой пары) ключом, выведенным из PIN.
     * Формат: saltB64:ivB64:ctB64
     */
    function encryptKeyPairWithPin(keyPairJson, pin) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        return deriveKeyFromPin(pin, salt).then(function (key) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const plaintext = new TextEncoder().encode(JSON.stringify(keyPairJson));
            return crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv, tagLength: 128 },
                key,
                plaintext
            ).then(function (ciphertext) {
                const saltB64 = btoa(String.fromCharCode.apply(null, salt));
                const ivB64 = btoa(String.fromCharCode.apply(null, iv));
                const ctB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ciphertext)));
                return saltB64 + ':' + ivB64 + ':' + ctB64;
            });
        });
    }

    /**
     * Расшифровать blob и вернуть JSON ключевой пары или null.
     */
    function decryptKeyPairWithPin(blob, pin) {
        const parts = blob.split(':');
        if (parts.length !== 3) return Promise.resolve(null);
        const salt = Uint8Array.from(atob(parts[0]), function (c) { return c.charCodeAt(0); });
        const iv = Uint8Array.from(atob(parts[1]), function (c) { return c.charCodeAt(0); });
        const ct = Uint8Array.from(atob(parts[2]), function (c) { return c.charCodeAt(0); });
        return deriveKeyFromPin(pin, salt).then(function (key) {
            return crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv, tagLength: 128 },
                key,
                ct
            );
        }).then(function (dec) {
            return JSON.parse(new TextDecoder().decode(dec));
        }).catch(function () {
            return null;
        });
    }

    /**
     * Включить блокировку: создать WebAuthn-учётные данные, зашифровать ключи PIN-ом, сохранить, очистить sessionStorage.
     * @param {string} pin — PIN или пароль (минимум 4 символа)
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    function enableDeviceLock(pin) {
        if (!pin || pin.length < 4) return Promise.resolve({ ok: false, error: 'PIN не менее 4 символов' });
        const keyPairStr = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(E2EE_STORAGE_KEY) : null;
        if (!keyPairStr) return Promise.resolve({ ok: false, error: 'Ключи не найдены. Сначала откройте чат.' });
        let keyPairJson;
        try {
            keyPairJson = JSON.parse(keyPairStr);
        } catch (e) {
            return Promise.resolve({ ok: false, error: 'Ключи не найдены. Сначала откройте чат.' });
        }
        let credId = null;
        const userUuid = typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.userUuid ? document.body.dataset.userUuid : 'user';
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const createOptions = {
            publicKey: {
                challenge: challenge,
                rp: { name: 'Мессенджер' },
                user: {
                    id: new TextEncoder().encode(userUuid.slice(0, 64)),
                    name: userUuid,
                    displayName: 'E2EE Lock'
                },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                    residentKey: 'preferred',
                    requireResidentKey: false
                },
                timeout: 60000
            }
        };
        return (isWebAuthnSupported() ? navigator.credentials.create(createOptions) : Promise.resolve(null))
            .then(function (cred) {
                if (cred && cred.rawId) credId = bufferToBase64url(cred.rawId);
                return encryptKeyPairWithPin(keyPairJson, pin);
            })
            .then(function (blob) {
                const salt = blob.split(':')[0];
                setStorage(LOCK_FLAG, '1');
                setStorage(LOCKED_BLOB_KEY, blob);
                setStorage(SALT_KEY, salt);
                if (credId) setStorage(CREDENTIAL_ID_KEY, credId);
                else setStorage(CREDENTIAL_ID_KEY, null);
                if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(E2EE_STORAGE_KEY);
                return { ok: true };
            })
            .catch(function (err) {
                return { ok: false, error: (err && err.message) ? err.message : 'Ошибка включения блокировки' };
            });
    }

    /**
     * Выключить блокировку (после разблокировки): очистить данные блокировки в localStorage.
     */
    function disableDeviceLock() {
        setStorage(LOCK_FLAG, null);
        setStorage(CREDENTIAL_ID_KEY, null);
        setStorage(LOCKED_BLOB_KEY, null);
        setStorage(SALT_KEY, null);
    }

    /**
     * Разблокировать по PIN: расшифровать blob, записать ключи в sessionStorage (блокировка остаётся включённой до следующей загрузки).
     * @param {string} pin
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    function unlockWithPin(pin) {
        const blob = getStorage(LOCKED_BLOB_KEY);
        if (!blob) return Promise.resolve({ ok: false, error: 'Нет сохранённой блокировки' });
        return decryptKeyPairWithPin(blob, pin).then(function (keyPairJson) {
            if (!keyPairJson || !keyPairJson.publicKey || !keyPairJson.privateKey) {
                return { ok: false, error: 'Неверный PIN' };
            }
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(E2EE_STORAGE_KEY, JSON.stringify(keyPairJson));
            }
            return { ok: true };
        }).catch(function () {
            return { ok: false, error: 'Неверный PIN' };
        });
    }

    /**
     * Выполнить WebAuthn assertion (биометрия). Возвращает true при успехе.
     * @returns {Promise<boolean>}
     */
    function performWebAuthnAssertion() {
        const credIdB64 = getStorage(CREDENTIAL_ID_KEY);
        if (!credIdB64 || !isWebAuthnSupported()) return Promise.resolve(false);
        try {
            const credId = base64urlToBuffer(credIdB64);
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            return navigator.credentials.get({
                publicKey: {
                    challenge: challenge,
                    allowCredentials: [{ type: 'public-key', id: credId }],
                    userVerification: 'required',
                    timeout: 60000
                }
            }).then(function (assertion) {
                return !!assertion;
            });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    global.E2EE_WEBAUTHN_LOCK = {
        isWebAuthnSupported: isWebAuthnSupported,
        isDeviceLockActive: isDeviceLockActive,
        enableDeviceLock: enableDeviceLock,
        disableDeviceLock: disableDeviceLock,
        unlockWithPin: unlockWithPin,
        performWebAuthnAssertion: performWebAuthnAssertion
    };
})(typeof window !== 'undefined' ? window : this);
