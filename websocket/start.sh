#!/bin/sh
# Запуск WebSocket-сервера в фоне. Консоль сразу возвращается.
# Остановка: ./stop.sh или kill $(cat websocket/server.pid)
# На Synology используем PHP из Web Station (с pdo_mysql), т.к. системный php часто без MySQL.
# Если в config задан WEBSOCKET_RUN_AS_USER — скрипт перезапускает себя под этим пользователем (чтобы веб и CLI работали с одним процессом).

SCRIPT_DIR="$(dirname "$0")"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$ROOT/config/config.php"

# Всегда работать от одного пользователя (пользователь веб-сервера): тогда остановка из веб сработает
if [ -z "$WEBSOCKET_RUN_AS_USER" ] && [ -f "$CONFIG_FILE" ]; then
    WEBSOCKET_RUN_AS_USER=$(grep -E "define\s*\(\s*['\"]WEBSOCKET_RUN_AS_USER['\"]\s*," "$CONFIG_FILE" 2>/dev/null | sed -n "s/.*,\s*['\"]\\([^'\"]*\\)['\"].*/\1/p" | head -1)
fi
if [ -n "$WEBSOCKET_RUN_AS_USER" ] && [ "$(whoami)" != "$WEBSOCKET_RUN_AS_USER" ]; then
    export WEBSOCKET_RUN_AS_USER
    exec sudo -u "$WEBSOCKET_RUN_AS_USER" "$0"
fi

cd "$ROOT"

# Найти PHP с поддержкой pdo_mysql (для Synology NAS). Можно задать вручную: export PHP_CMD=/path/to/php
PHP_CMD="${PHP_CMD:-}"
if [ -z "$PHP_CMD" ]; then
    for _php in /volume1/@appstore/PHP7.3/usr/local/bin/php73 /usr/local/php/bin/php /var/packages/WebStation/target/usr/bin/php /usr/bin/php; do
        if [ -x "$_php" ] && "$_php" -m 2>/dev/null | grep -q pdo_mysql; then
            PHP_CMD="$_php"
            break
        fi
    done
fi
[ -z "$PHP_CMD" ] && PHP_CMD="php"

# Проверить, что выбранный PHP умеет работать с MySQL (иначе процесс сразу упадёт)
if ! "$PHP_CMD" -m 2>/dev/null | grep -q pdo_mysql; then
    echo "Ошибка: PHP ($PHP_CMD) не поддерживает pdo_mysql. WebSocket-серверу нужна БД."
    echo ""
    echo "На Synology найдите PHP из Web Station и задайте его перед запуском:"
    echo "  find /usr/local /var/packages -name php -type f 2>/dev/null"
    echo "  /путь/к/php -m | grep pdo_mysql   # должен вывести pdo_mysql"
    echo "  export PHP_CMD=/путь/к/php"
    echo "  ./websocket/start.sh"
    echo ""
    echo "Подробнее: websocket/docs/WEBSOCKET_NAS_SETUP.md"
    exit 1
fi

PID_FILE="$ROOT/websocket/server.pid"
LOG_FILE="$ROOT/websocket/server.log"

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "WebSocket-сервер уже запущен (PID $OLD_PID). Сначала остановите: ./websocket/stop.sh"
        exit 1
    fi
    rm -f "$PID_FILE"
fi

nohup "$PHP_CMD" websocket/server.php >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "WebSocket-сервер запущен в фоне, PID: $(cat "$PID_FILE")"
echo "PHP: $PHP_CMD"
echo "Лог: $LOG_FILE"
echo "Остановка: ./websocket/stop.sh"
