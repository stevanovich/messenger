<?php
/**
 * API превью ссылок: по URL возвращает title, description, image (Open Graph / meta).
 * GET api/link_preview.php?url=https://example.com
 */
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

if (!isLoggedIn()) {
    jsonError('Не авторизован', 401);
}

$url = isset($_GET['url']) ? trim($_GET['url']) : '';
if ($url === '') {
    jsonError('Не указан параметр url');
}

// Разрешаем только http/https
$parsed = @parse_url($url);
if (empty($parsed['scheme']) || !in_array(strtolower($parsed['scheme']), ['http', 'https'], true)) {
    jsonError('Допустимы только ссылки http и https');
}
$host = isset($parsed['host']) ? strtolower($parsed['host']) : '';
if ($host === '') {
    jsonError('Некорректный URL');
}

// Запрет доступа к внутренним/приватным адресам (SSRF)
$disallowedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
if (in_array($host, $disallowedHosts, true)) {
    jsonError('Ссылка на локальный адрес не разрешена');
}
$ip = @gethostbyname($host);
if ($ip && $ip !== $host) {
    $private = filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    );
    if ($private === false) {
        jsonError('Ссылка на внутренний адрес не разрешена');
    }
}

// Ограничение длины URL
if (strlen($url) > 2048) {
    jsonError('Ссылка слишком длинная');
}

$timeout = 5;
$userAgent = 'Mozilla/5.0 (compatible; MessengerLinkPreview/1.0)';

if (function_exists('curl_init')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_USERAGENT, $userAgent);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
    $html = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
} else {
    $ctx = stream_context_create([
        'http' => [
            'timeout' => $timeout,
            'user_agent' => $userAgent,
            'follow_location' => 1,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);
    $html = @file_get_contents($url, false, $ctx);
    $httpCode = 200;
}

if ($html === false || $html === '' || $httpCode < 200 || $httpCode >= 400) {
    jsonError('Не удалось загрузить страницу');
}

// Парсим Open Graph и meta (первые ~150 KB достаточно для head)
$chunk = substr($html, 0, 150000);
$title = '';
$description = '';
$image = '';

// Open Graph
if (preg_match('/<meta\s+[^>]*property\s*=\s*["\']og:title["\'][^>]*content\s*=\s*["\']([^"\']+)["\']/i', $chunk, $m)) {
    $title = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
} elseif (preg_match('/<meta\s+[^>]*content\s*=\s*["\']([^"\']+)["\'][^>]*property\s*=\s*["\']og:title["\']/i', $chunk, $m)) {
    $title = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}
if (preg_match('/<meta\s+[^>]*property\s*=\s*["\']og:description["\'][^>]*content\s*=\s*["\']([^"\']+)["\']/i', $chunk, $m)) {
    $description = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
} elseif (preg_match('/<meta\s+[^>]*content\s*=\s*["\']([^"\']+)["\'][^>]*property\s*=\s*["\']og:description["\']/i', $chunk, $m)) {
    $description = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}
if (preg_match('/<meta\s+[^>]*property\s*=\s*["\']og:image["\'][^>]*content\s*=\s*["\']([^"\']+)["\']/i', $chunk, $m)) {
    $image = trim($m[1]);
} elseif (preg_match('/<meta\s+[^>]*content\s*=\s*["\']([^"\']+)["\'][^>]*property\s*=\s*["\']og:image["\']/i', $chunk, $m)) {
    $image = trim($m[1]);
}

// Fallback: обычный title и meta description
if ($title === '' && preg_match('/<title[^>]*>([^<]+)<\/title>/i', $chunk, $m)) {
    $title = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}
if ($description === '' && preg_match('/<meta\s+[^>]*name\s*=\s*["\']description["\'][^>]*content\s*=\s*["\']([^"\']+)["\']/i', $chunk, $m)) {
    $description = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
} elseif ($description === '' && preg_match('/<meta\s+[^>]*content\s*=\s*["\']([^"\']+)["\'][^>]*name\s*=\s*["\']description["\']/i', $chunk, $m)) {
    $description = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}

// Ограничиваем длину полей
$title = mb_substr($title, 0, 200);
$description = mb_substr($description, 0, 300);
if ($image !== '' && strlen($image) > 2048) {
    $image = '';
}

// Относительный og:image превращаем в абсолютный
if ($image !== '' && strpos($image, '//') !== 0 && strpos($image, 'http') !== 0) {
    $base = $parsed['scheme'] . '://' . $parsed['host'] . (isset($parsed['port']) && !in_array($parsed['port'], [80, 443]) ? ':' . $parsed['port'] : '');
    $image = (strpos($image, '/') === 0) ? $base . $image : rtrim($base . '/' . dirname($parsed['path'] ?? '/'), '/') . '/' . ltrim($image, '/');
}

jsonSuccess([
    'url' => $url,
    'title' => $title,
    'description' => $description,
    'image' => $image,
]);
