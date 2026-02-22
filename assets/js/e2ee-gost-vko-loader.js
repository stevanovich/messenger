/**
 * Загрузчик библиотеки ГОСТ Р 34.10-2012 (VKO) для согласования ключей.
 * Подключается как type="module".
 * Сначала пробует локальный бандл (assets/js/vendor/gostcurves-bundle.js), при отсутствии — CDN esm.sh.
 * Чтобы обойтись без CDN: npm install && npm run build:gost-vko (см. package.json).
 */
const localBundleUrl = new URL('vendor/gostcurves-bundle.js', import.meta.url).href;

function done(m) {
  window.E2EE_GOST_VKO = m;
  window.dispatchEvent(new Event('e2ee-gost-vko-ready'));
}

import(localBundleUrl)
  .catch(function () {
    return import('https://esm.sh/@li0ard/gostcurves');
  })
  .then(done)
  .catch(function (err) {
    console.warn('E2EE: не удалось загрузить библиотеку VKO (ГОСТ Р 34.10). Локальный бандл: npm run build:gost-vko', err);
    window.E2EE_GOST_VKO = null;
  });
