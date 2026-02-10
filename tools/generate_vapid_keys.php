<?php
/**
 * Генерация VAPID-ключей для Web Push.
 * Запуск: php tools/generate_vapid_keys.php
 * Ключи вывести в config или в переменные окружения PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY.
 */

function base64url_encode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

$key = openssl_pkey_new([
    'curve_name' => 'prime256v1',
    'private_key_type' => OPENSSL_KEYTYPE_EC,
]);
if ($key === false) {
    fwrite(STDERR, "Ошибка создания ключа: " . openssl_error_string() . "\n");
    exit(1);
}

$details = openssl_pkey_get_details($key);
if (!isset($details['ec'])) {
    fwrite(STDERR, "Ошибка: ключ не в формате EC\n");
    exit(1);
}

$curve = $details['ec'];
// Приватный ключ: d (32 байта). В PHP он идёт после заголовка.
$privateBytes = $curve['d'];
// Публичный ключ: некомпрессированный 04 + x + y (65 байт)
$x = $curve['x'];
$y = $curve['y'];
$publicBytes = "\x04" . $x . $y;

$publicKey = base64url_encode($publicBytes);
$privateKey = base64url_encode($privateBytes);

echo "Скопируйте в config/config.php или в переменные окружения:\n\n";
echo "PUSH_VAPID_PUBLIC_KEY:\n" . $publicKey . "\n\n";
echo "PUSH_VAPID_PRIVATE_KEY:\n" . $privateKey . "\n";
