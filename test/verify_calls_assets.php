<?php
/**
 * Проверка, что в загружаемых assets есть последние изменения (аудиозвонок, btn-call-audio).
 * Откройте в браузере: .../test/verify_calls_assets.php
 * Если видите "OK" и версии — на сервере лежит актуальный код. Если "MISSING" — обновите файлы или сбросьте кэш.
 */
header('Content-Type: text/plain; charset=utf-8');

$base = dirname(__DIR__);
$callsJs = @file_get_contents($base . '/assets/js/calls.js');
$chatCss = @file_get_contents($base . '/assets/css/chat.css');

$checks = [];
$checks['callPanelRemoteAudio (аудио в аудиозвонке)'] = $callsJs && strpos($callsJs, 'callPanelRemoteAudio') !== false;
$checks['btn-call-audio (переименование кнопки)'] = $callsJs && strpos($callsJs, 'btn-call-audio') !== false;
$checks['remoteA.srcObject (воспроизведение в audio)'] = $callsJs && strpos($callsJs, 'remoteA.srcObject') !== false;
$checks['CSS .btn-call-audio'] = $chatCss && strpos($chatCss, '.btn-call-audio') !== false;

$allOk = true;
foreach ($checks as $name => $ok) {
    echo ($ok ? 'OK' : 'MISSING') . ' — ' . $name . "\n";
    if (!$ok) $allOk = false;
}

echo "\n";
echo "Версия files (для сброса кэша):\n";
echo "  calls.js:  " . (file_exists($base . '/assets/js/calls.js') ? date('Y-m-d H:i:s', filemtime($base . '/assets/js/calls.js')) : '—') . "\n";
echo "  chat.css:  " . (file_exists($base . '/assets/css/chat.css') ? date('Y-m-d H:i:s', filemtime($base . '/assets/css/chat.css')) : '—') . "\n";

if ($allOk) {
    echo "\nИтог: все проверки пройдены. Если на устройстве всё ещё старый вид — сделайте жёсткое обновление: Ctrl+Shift+R (или Cmd+Shift+R), либо откройте сайт в режиме инкогнито.\n";
} else {
    echo "\nИтог: часть изменений не найдена в файлах. Убедитесь, что правки сохранены и задеплоены.\n";
}
