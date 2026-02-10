#!/bin/sh
# Проверка: в каком PHP из /usr/local/etc/ (и связанных путей) настроен pdo_mysql.
# Запуск на NAS: sh check-php-pdo-mysql.sh или после chmod +x: ./check-php-pdo-mysql.sh
# Или с вашей машины: ssh Milos@192.168.0.101 "sh -s" < test/check-php-pdo-mysql.sh
# Если ошибка bad interpreter или do\r: на NAS выполнить sed -i 's/\r$//' test/check-php-pdo-mysql.sh

echo "=== Содержимое /usr/local/etc/ ==="
ls -la /usr/local/etc/ 2>/dev/null || echo "Нет доступа или пусто"

echo ""
echo "=== Поиск исполняемых php в /usr/local ==="
find /usr/local -name "php" -type f 2>/dev/null | while read p; do
  [ -x "$p" ] && echo "$p"
done

echo ""
echo "=== Проверка pdo_mysql для каждого найденного php ==="
for p in /usr/local/php*/bin/php /usr/local/php*/bin/php-cgi /var/packages/WebStation/target/usr/bin/php /var/packages/PHP*/target/usr/bin/php /usr/local/bin/php /usr/bin/php; do
  [ -x "$p" ] || continue
  has_mysql=$("$p" -m 2>/dev/null | grep -i pdo_mysql)
  if [ -n "$has_mysql" ]; then
    echo "OK (pdo_mysql есть): $p"
    "$p" -v 2>/dev/null
  else
    echo "--- (pdo_mysql нет): $p"
  fi
done

echo ""
echo "=== Поиск ВСЕХ php в /var/packages и /usr/local (может занять время) ==="
find /var/packages /usr/local -name "php" -type f 2>/dev/null | while read p; do
  [ -x "$p" ] || continue
  has_mysql=$("$p" -m 2>/dev/null | grep -i pdo_mysql)
  if [ -n "$has_mysql" ]; then
    echo "OK (pdo_mysql есть): $p"
    "$p" -v 2>/dev/null
  else
    echo "--- (pdo_mysql нет): $p"
  fi
done

echo ""
echo "=== Конфиги php.ini в /usr/local/etc/ ==="
find /usr/local/etc -name "php.ini" 2>/dev/null
for ini in /usr/local/etc/php*/cli/php.ini /usr/local/etc/php*/php.ini; do
  [ -f "$ini" ] && echo "$ini" && grep -l "extension.*pdo_mysql\|extension.*mysqli" "$ini" 2>/dev/null && echo "  -> в этом файле есть упоминание extension pdo_mysql/mysqli"
done
