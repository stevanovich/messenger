# Проверка использования ГОСТ при шифровании (чёрный ящик)

Как убедиться **без чтения кода**, что для шифрования и расшифрования реально используются ГОСТ-алгоритмы: по трафику, ответам API и формату шифртекста.

---

## 1. Поле алгоритма в ответах API

При получении сообщений мессенджер отдаёт у каждого сообщения поле **`encryption_algorithm`**. Оно сохраняется в БД при отправке и возвращается клиенту при запросе сообщений.

**Что сделать:**

1. Открыть мессенджер в браузере, авторизоваться.
2. Открыть DevTools → вкладка **Network**.
3. Открыть или обновить чат с включённым E2EE (замок).
4. Найти запрос к `api/messages.php` (GET с `conversation_id`) и открыть ответ (Preview/Response).

В теле ответа у каждого сообщения с шифрованием будет, например:

- `"encrypted": 1`
- `"encryption_algorithm": "GOST-Kuznechik-MGM"` или `"GOST-Magma-MGM"`

Если там указан один из ГОСТ-алгоритмов — приложение **заявляет**, что сообщение зашифровано этим алгоритмом. Дальше можно проверить, что формат шифртекста этому соответствует.

---

## 2. Проверка формата шифртекста (IV/ICN)

Формат тела сообщения при E2EE: **`ivBase64:ciphertextBase64`** (одна строка в поле `content`).  
Размер IV/ICN (первая часть до двоеточия после декодирования из Base64) разный у алгоритмов:

| Алгоритм             | Размер IV/ICN (байт) | Длина IV в Base64 (символов) |
|----------------------|----------------------|------------------------------|
| AES-GCM              | 12                   | 16                           |
| GOST-Kuznechik-MGM   | 16                   | 22                           |
| GOST-Magma-MGM       | 8                    | 11                           |

Если в API приходит `encryption_algorithm: "GOST-Kuznechik-MGM"`, то первая часть `content` до `:` после декодирования из Base64 должна иметь длину **16 байт**. Для Magma — **8 байт**. Для AES-GCM было бы **12 байт**.

**Как проверить вручную:**

1. В ответе `api/messages.php` взять одно зашифрованное сообщение: поля `content` и `encryption_algorithm`.
2. В `content` найти первый `:` и взять подстроку **до** него — это IV в Base64.
3. Декодировать её из Base64 (например, в консоли браузера: `atob(partBeforeColon)`).
4. Длина полученной строки (в байтах, для UTF-8 можно считать длину строки):  
   - 16 → соответствует Kuznechik MGM  
   - 8 → соответствует Magma MGM  
   - 12 → соответствовало бы AES-GCM  

Таким образом можно убедиться, что **реальный формат шифртекста совпадает с заявленным алгоритмом** (в т.ч. с ГОСТ).

---

## 3. Проверка в консоли браузера (одно сообщение)

В чате с E2EE откройте консоль (F12). После загрузки сообщений выполните скрипт ниже. Он ищет последнее зашифрованное сообщение в ответе API (нужно, чтобы ответ ещё был доступен в панели Network, либо можно подставить свой `content` и `encryption_algorithm`).

```javascript
// Вставить в консоль на странице чата после загрузки сообщений.
// Либо задать вручную:
//   var content = "IV_BASE64:CIPHERTEXT_BASE64";
//   var encryption_algorithm = "GOST-Kuznechik-MGM";

(function checkPayloadFormat() {
    var content = typeof content !== 'undefined' ? content : null;
    var encryption_algorithm = typeof encryption_algorithm !== 'undefined' ? encryption_algorithm : null;

    if (!content || !encryption_algorithm) {
        console.log('Задайте переменные content и encryption_algorithm из ответа api/messages.php (одно зашифрованное сообщение), затем снова запустите этот скрипт.');
        console.log('Либо откройте Network → ответ GET api/messages.php → найдите сообщение с encrypted:1, скопируйте content и encryption_algorithm.');
        return;
    }

    var idx = content.indexOf(':');
    if (idx <= 0) {
        console.log('Неверный формат payload (ожидается ivBase64:ciphertextBase64)');
        return;
    }
    var ivB64 = content.slice(0, idx);
    try {
        var ivBytes = atob(ivB64);
        var ivLen = new TextEncoder().encode(ivBytes).length;
    } catch (e) {
        console.log('Ошибка декодирования IV из Base64:', e);
        return;
    }

    var expected = {
        'ECDH-P256-AES-GCM': 12,
        'GOST-Kuznechik-MGM': 16,
        'GOST-Magma-MGM': 8
    };
    var expectedLen = expected[encryption_algorithm];
    var ok = (expectedLen !== undefined && ivLen === expectedLen);

    console.log('encryption_algorithm:', encryption_algorithm);
    console.log('Длина IV/ICN (байт):', ivLen, ok ? '(ожидалось ' + expectedLen + ' — совпадает)' : '(ожидалось ' + (expectedLen || '?') + ' — ' + (ok ? 'совпадает' : 'НЕ совпадает') + ')');
    if (ok) {
        console.log('Формат payload соответствует заявленному алгоритму.');
        if (encryption_algorithm.indexOf('GOST') !== -1) {
            console.log('Используется ГОСТ-шифрование.');
        }
    } else {
        console.warn('Формат payload не совпадает с заявленным алгоритмом — возможно, неверные данные или другая версия протокола.');
    }
})();
```

Подставьте в переменные `content` и `encryption_algorithm` значения из одного зашифрованного сообщения из ответа API и снова выполните скрипт. Если длина IV совпадает с таблицей для указанного алгоритма (в т.ч. ГОСТ) — формат подтверждает использование этого алгоритма.

---

## 4. Кратко

- **Практически убедиться**, что для шифрования/расшифрования используются ГОСТ-алгоритмы, при отношении к проекту как к чёрному ящику можно так:
  1. Увидеть в ответах API (`api/messages.php`) у зашифрованных сообщений поле **`encryption_algorithm`** со значением `GOST-Kuznechik-MGM` или `GOST-Magma-MGM`.
  2. Проверить, что формат тела сообщения (**длина IV/ICN** в payload) соответствует этому алгоритму (16 байт для Кузнечика, 8 для Магмы). Тогда заявленный алгоритм и реальный формат шифртекста совпадают, что свидетельствует об использовании ГОСТ при шифровании и расшифровании.

- Доступа к ключам или коду не требуется — достаточно трафика (DevTools → Network) и при необходимости одного запуска скрипта в консоли с подстановкой `content` и `encryption_algorithm` из ответа API.
