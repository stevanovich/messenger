#!/bin/sh
# Выставляет права на скрипты и каталог websocket так, чтобы веб-сервер мог запускать start/stop/restart.
# Запуск: из корня проекта ./websocket/fix-permissions.sh
# Если веб-сервер под другим пользователем — передайте его и запустите скрипт с sudo:
#   sudo ./websocket/fix-permissions.sh http
# Если ошибка $'\r': command not found — на NAS выполните: sed -i 's/\r$//' websocket/fix-permissions.sh

SCRIPT_DIR="$(dirname "$0")"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WS_DIR="$ROOT/websocket"
TARGET_USER="${1:-}"

echo "Каталог проекта: $ROOT"
echo "Каталог websocket: $WS_DIR"
echo ""

# Требуем запуск из корня или из websocket (чтобы пути были предсказуемы)
if [ ! -f "$WS_DIR/start.sh" ]; then
    echo "Ошибка: не найден $WS_DIR/start.sh. Запустите скрипт из корня проекта: ./websocket/fix-permissions.sh"
    exit 1
fi

# 1) Права на каталог: владелец и группа — полный доступ, остальные — вход и чтение
chmod 755 "$WS_DIR"
echo "  chmod 755 websocket/"

# 2) Все .sh — исполняемые для всех (веб-сервер часто работает под отдельным пользователем)
for f in "$WS_DIR"/*.sh; do
    [ -f "$f" ] || continue
    chmod 755 "$f"
    echo "  chmod 755 $(basename "$f")"
done

# 3) server.php и client.js — читаемые
[ -f "$WS_DIR/server.php" ] && chmod 644 "$WS_DIR/server.php" && echo "  chmod 644 server.php"
[ -f "$WS_DIR/client.js" ] && chmod 644 "$WS_DIR/client.js" && echo "  chmod 644 client.js"

# 4) server.pid и server.log — чтобы веб-сервер мог писать (создать пустые, если нет)
for f in server.pid server.log; do
    p="$WS_DIR/$f"
    if [ -f "$p" ]; then
        chmod 664 "$p"
        echo "  chmod 664 $f"
    else
        touch "$p" 2>/dev/null && chmod 664 "$p" && echo "  создан и chmod 664 $f" || true
    fi
done

# 5) Корень проекта: веб-сервер должен иметь право входа (traverse) по пути к websocket
chmod o+x "$ROOT" 2>/dev/null && echo "  chmod o+x корень проекта (проход к websocket)"

# 6) vendor/ и config/: процесс websocket/server.php подключает vendor/autoload.php и config/config.php — нужны права на чтение
if [ -d "$ROOT/vendor" ]; then
    chmod -R o+rX "$ROOT/vendor" 2>/dev/null && echo "  chmod -R o+rX vendor/ (доступ для websocket/server.php)"
fi
if [ -d "$ROOT/config" ]; then
    chmod -R o+rX "$ROOT/config" 2>/dev/null && echo "  chmod -R o+rX config/ (доступ для websocket/server.php)"
fi

# 7) Опционально: сменить владельца на пользователя веб-сервера (только с sudo)
if [ -n "$TARGET_USER" ]; then
    if [ "$(id -u)" -eq 0 ]; then
        chown -R "$TARGET_USER" "$WS_DIR"
        [ -d "$ROOT/vendor" ] && chown -R "$TARGET_USER" "$ROOT/vendor"
        [ -d "$ROOT/config" ] && chown -R "$TARGET_USER" "$ROOT/config"
        echo "  chown -R $TARGET_USER websocket/, vendor/, config/"
    else
        echo ""
        echo "Чтобы назначить владельцем пользователя $TARGET_USER, запустите с sudo:"
        echo "  sudo $WS_DIR/fix-permissions.sh $TARGET_USER"
    fi
fi

echo ""
echo "Готово. Проверьте в админке кнопку «Запустить»."
if [ -z "$TARGET_USER" ]; then
    echo "Если по-прежнему «Permission denied» — узнайте пользователя веб-сервера (например http, sc-web) и выполните:"
    echo "  sudo $WS_DIR/fix-permissions.sh ИМЯ_ПОЛЬЗОВАТЕЛЯ"
fi
