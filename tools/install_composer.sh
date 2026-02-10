#!/bin/sh
# Скачать composer.phar в корень проекта и выполнить composer install.
# Запуск из корня проекта: sh tools/install_composer.sh
# Или: cd /path/to/messenger && sh tools/install_composer.sh

cd "$(dirname "$0")/.." || exit 1

if [ -f composer.phar ]; then
    echo "composer.phar уже есть, запускаю install..."
    php composer.phar install
    exit $?
fi

echo "Скачиваю Composer..."
php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');" || { echo "Ошибка: не удалось скачать installer"; exit 1; }
php composer-setup.php --quiet || { php -r "unlink('composer-setup.php');" 2>/dev/null; exit 1; }
php -r "unlink('composer-setup.php');" 2>/dev/null

if [ ! -f composer.phar ]; then
    echo "Ошибка: composer.phar не создан"
    exit 1
fi

echo "Запускаю composer install..."
php composer.phar install
exit $?
