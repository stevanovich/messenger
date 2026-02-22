<?php
/**
 * Локализация: определение текущего языка и функция перевода t().
 * Поддерживаемые: ru, en, sr. По умолчанию по региону (Accept-Language), иначе en.
 */

if (!defined('LOCALE_SUPPORTED')) {
    define('LOCALE_SUPPORTED', ['ru', 'en', 'sr']);
}

$GLOBALS['_locale_strings'] = [];
$GLOBALS['_current_locale'] = 'en';

/**
 * Инициализация локали. Вызывать в начале страницы (например из header).
 * Порядок: GET lang → session → cookie → (если залогинен) user.locale → Accept-Language → en.
 */
function initLocale() {
    global $pdo;
    $supported = LOCALE_SUPPORTED;
    $lang = isset($_GET['lang']) ? trim(strtolower($_GET['lang'])) : '';

    // Явный выбор: ?lang=ru|en|sr — сохраняем и редирект без параметра
    if ($lang !== '' && in_array($lang, $supported, true)) {
        $_SESSION['locale'] = $lang;
        if (function_exists('setcookie')) {
            $path = defined('BASE_URL') ? parse_url(BASE_URL, PHP_URL_PATH) : '/';
            if ($path === null || $path === false) $path = '/';
            $path = rtrim($path, '/');
            if ($path === '') $path = '/';
            setcookie('locale', $lang, time() + 86400 * 365, $path, '', false, true);
        }
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        $uri = preg_replace('#[?&]lang=' . preg_quote($lang, '#') . '(&|$)#', '$1', $uri);
        $uri = preg_replace('#\?&|&\?|\?$|&$#', '', $uri);
        $uri = rtrim($uri, '?');
        if ($uri === '') $uri = '/';
        $uri = function_exists('normalize_request_uri_path') ? normalize_request_uri_path($uri) : $uri;
        if ($uri === '' || $uri === '?') $uri = '/';
        header('Location: ' . $uri);
        exit;
    }

    $locale = null;
    if (!empty($_SESSION['locale']) && in_array($_SESSION['locale'], $supported, true)) {
        $locale = $_SESSION['locale'];
    }
    if ($locale === null && !empty($_COOKIE['locale']) && in_array($_COOKIE['locale'], $supported, true)) {
        $locale = $_COOKIE['locale'];
    }
    if ($locale === null && function_exists('isLoggedIn') && isLoggedIn() && isset($pdo)) {
        $uuid = $_SESSION['user_uuid'] ?? '';
        if ($uuid !== '') {
            try {
                $stmt = $pdo->prepare("SELECT locale FROM users WHERE uuid = ?");
                $stmt->execute([$uuid]);
                $row = $stmt->fetch();
                if ($row && !empty($row['locale']) && in_array($row['locale'], $supported, true)) {
                    $locale = $row['locale'];
                    $_SESSION['locale'] = $locale;
                }
            } catch (Exception $e) {
                // ignore
            }
        }
    }
    if ($locale === null && !empty($_SERVER['HTTP_ACCEPT_LANGUAGE'])) {
        $locale = localeFromAcceptLanguage($_SERVER['HTTP_ACCEPT_LANGUAGE'], $supported);
    }
    if ($locale === null) {
        $locale = 'en';
    }

    $GLOBALS['_current_locale'] = $locale;
    $file = __DIR__ . '/../locale/' . $locale . '.php';
    if (is_file($file) && is_readable($file)) {
        $GLOBALS['_locale_strings'] = include $file;
    } else {
        $GLOBALS['_locale_strings'] = [];
    }
    return $locale;
}

/**
 * По Accept-Language выбирает первый поддерживаемый язык.
 */
function localeFromAcceptLanguage($header, array $supported) {
    $list = [];
    foreach (array_map('trim', explode(',', $header)) as $part) {
        if (preg_match('/^([a-z]{2})(?:[-_][a-z0-9]+)?/i', $part, $m)) {
            $code = strtolower($m[1]);
            $q = 1.0;
            if (preg_match('/;q=([\d.]+)/', $part, $qM)) {
                $q = (float) $qM[1];
            }
            $list[$code] = $q;
        }
    }
    arsort($list, SORT_NUMERIC);
    foreach (array_keys($list) as $code) {
        if (in_array($code, $supported, true)) {
            return $code;
        }
    }
    return null;
}

/**
 * Текущий код локали (ru, en, sr).
 */
function getLocale() {
    return $GLOBALS['_current_locale'] ?? 'en';
}

/**
 * Перевод по ключу. Ключ в виде "section.key". Если перевода нет — возвращается ключ.
 */
function t($key) {
    $strings = $GLOBALS['_locale_strings'] ?? [];
    return isset($strings[$key]) ? $strings[$key] : $key;
}

/**
 * Проверка, инициализирована ли локаль (загружены ли строки).
 */
function isLocaleInitialized() {
    return isset($GLOBALS['_current_locale']) && $GLOBALS['_current_locale'] !== '';
}
