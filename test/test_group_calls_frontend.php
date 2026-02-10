<?php
/**
 * Проверка фронтенда групповых звонков (Этап 3).
 * Проверяет наличие в assets/js/calls.js и chat.js ожидаемых функций и строк.
 * Ручная проверка: открыть групповой чат — должны быть кнопки «Групповой голосовой/видеозвонок»; начать звонок — панель с сеткой; в 1-на-1 — кнопка «Добавить участника».
 */
$callsJs = @file_get_contents(__DIR__ . '/../assets/js/calls.js');
$chatJs = @file_get_contents(__DIR__ . '/../assets/js/chat.js');

$errors = [];

if ($callsJs === false) {
    $errors[] = 'assets/js/calls.js не найден';
} else {
    $required = ['startGroupCall', 'joinGroupCall', 'leaveGroupCall', 'endGroupCallForAll', 'getGroupCallStatus', 'addParticipantToCall', 'getCallInvites', 'groupCallId', 'showGroupCallPanel', 'hideGroupCallPanel', 'call.converted_to_group', 'call.group.joined'];
    foreach ($required as $s) {
        if (strpos($callsJs, $s) === false) {
            $errors[] = "В calls.js не найдено: {$s}";
        }
    }
    if (strpos($callsJs, 'groupCallPanel') === false) {
        $errors[] = 'В calls.js не найдена разметка groupCallPanel';
    }
    if (strpos($callsJs, 'modalAddParticipant') === false) {
        $errors[] = 'В calls.js не найдена модалка добавления участника';
    }
}

if ($chatJs === false) {
    $errors[] = 'assets/js/chat.js не найден';
} else {
    if (strpos($chatJs, 'chatHeaderGroupCallVoice') === false || strpos($chatJs, 'chatHeaderGroupCallVideo') === false || strpos($chatJs, 'startGroupCall') === false) {
        $errors[] = 'В chat.js не найдены кнопки группового звонка';
    }
    if ((strpos($chatJs, 'chatGroupCallPlaque') === false && strpos($chatJs, 'chatHeaderGroupCallBanner') === false) || strpos($chatJs, 'getGroupCallStatus') === false) {
        $errors[] = 'В chat.js не найден баннер/плашка присоединиться к групповому звонку';
    }
    if (strpos($chatJs, 'onGroupCallStarted') === false) {
        $errors[] = 'В chat.js не найден onGroupCallStarted';
    }
}

$css = @file_get_contents(__DIR__ . '/../assets/css/chat.css');
if ($css !== false && strpos($css, 'group-call-panel') === false) {
    $errors[] = 'В chat.css не найдены стили .group-call-panel';
}

if (!empty($errors)) {
    foreach ($errors as $e) echo "FAIL: $e\n";
    exit(1);
}

echo "OK: Фронтенд групповых звонков — экспорты и разметка присутствуют.\n";
echo "Ручная проверка: откройте групповой чат, нажмите «Групповой видеозвонок», затем «Присоединиться» с другого аккаунта; в 1-на-1 нажмите «Добавить участника».\n";
exit(0);
