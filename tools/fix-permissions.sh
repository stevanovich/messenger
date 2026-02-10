#!/bin/sh
# Исправление прав доступа для веб-сервера (Synology: пользователь http).
# Запускать из корня проекта: sudo sh tools/fix-permissions.sh
# Или: cd /path/to/messenger && sudo tools/fix-permissions.sh

WEB_USER="${1:-http}"
WEB_GROUP="${2:-users}"

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Working in: $ROOT"
echo "Web user: $WEB_USER:$WEB_GROUP"

# Точки входа и ключевые файлы в корне — владелец веб-сервер, читаемые
for f in index.php login.php register.php logout.php call-room.php join-call.php join-conversation.php sw.js .htaccess composer.json composer.lock; do
    if [ -e "$f" ]; then
        chown "$WEB_USER:$WEB_GROUP" "$f"
        chmod 644 "$f"
        echo "  fixed: $f"
    fi
done

# Каталоги и всё внутри — владелец веб-сервер, каталоги 755, файлы 644
chown -R "$WEB_USER:$WEB_GROUP" admin api assets auth config includes sql docs tools uploads vendor websocket 2>/dev/null || true
find admin api assets auth config includes sql docs tools uploads vendor websocket -type d -exec chmod 755 {} \; 2>/dev/null || true
find admin api assets auth config includes sql docs tools uploads vendor websocket -type f -exec chmod 644 {} \; 2>/dev/null || true

# Логи и uploads — запись для веб-сервера (уже владелец после chown -R)
[ -d uploads ] && chmod -R u+rwX uploads
[ -d logs ]    && chmod -R u+rwX logs 2>/dev/null || true

echo "Done. Try opening the site in the browser."
