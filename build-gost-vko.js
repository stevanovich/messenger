/**
 * Собирает один ESM-файл с библиотекой @li0ard/gostcurves для работы VKO без CDN.
 * Запуск: npm install && npm run build:gost-vko
 * Результат: assets/js/vendor/gostcurves-bundle.js
 */
const esbuild = require('esbuild');
const path = require('path');

const outFile = path.join(__dirname, 'assets', 'js', 'vendor', 'gostcurves-bundle.js');

async function run() {
  let entryFile;
  try {
    entryFile = require.resolve('@li0ard/gostcurves');
  } catch (e) {
    console.error('Пакет не найден. Выполните: npm install');
    process.exit(1);
  }
  try {
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      outfile: outFile,
      minify: false,
      target: ['es2020'],
    });
    console.log('OK: ' + outFile);
  } catch (err) {
    console.error('Ошибка сборки:', err.message || err);
    process.exit(1);
  }
}

run();
