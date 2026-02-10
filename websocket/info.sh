#!/bin/sh
# Отображение текущего статуса WebSocket-сервера (процесс, порты, лог).
# Если ошибка "bad interpreter" (^M): на NAS выполнить: sed -i 's/\r$//' websocket/info.sh

SCRIPT_DIR="$(dirname "$0")"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$ROOT/config/config.php"
PID_FILE="$ROOT/websocket/server.pid"

WS_PORT=8081
EVENT_PORT=8082

if [ -f "$CONFIG_FILE" ]; then
    _p=$(grep -E "define\s*\(\s*['\"]WEBSOCKET_PORT['\"]\s*," "$CONFIG_FILE" 2>/dev/null | sed -n "s/.*,\s*\([0-9]*\).*/\1/p")
    [ -n "$_p" ] && WS_PORT="$_p"
    _e=$(grep -E "define\s*\(\s*['\"]WEBSOCKET_EVENT_PORT['\"]\s*," "$CONFIG_FILE" 2>/dev/null | sed -n "s/.*,\s*\([0-9]*\).*/\1/p")
    [ -n "$_e" ] && EVENT_PORT="$_e"
fi

# Есть ли процесс, слушающий порт (по выводу ss или netstat)
check_port_listening() {
    _port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -tln 2>/dev/null | grep -q ":$_port[^0-9]"
        return $?
    fi
    for _cmd in netstat /usr/bin/netstat /bin/netstat; do
        if command -v "$_cmd" >/dev/null 2>&1 || [ -x "$_cmd" ]; then
            $_cmd -tln 2>/dev/null | grep -q ":$_port[^0-9]"
            return $?
        fi
    done
    return 1
}

# Найти PID процесса на порту (для вывода подсказки)
get_pid_on_port() {
    _port="$1"
    _pid=""
    if command -v ss >/dev/null 2>&1; then
        _line=$(ss -tlnp 2>/dev/null | grep ":$_port[^0-9]")
        [ -n "$_line" ] && _pid=$(echo "$_line" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
    fi
    if [ -z "$_pid" ]; then
        for _cmd in netstat /usr/bin/netstat /bin/netstat; do
            if command -v "$_cmd" >/dev/null 2>&1 || [ -x "$_cmd" ]; then
                _line=$($_cmd -tlnp 2>/dev/null | grep ":$_port[^0-9]")
                [ -n "$_line" ] && _pid=$(echo "$_line" | awk '{print $NF}' | sed 's/\/.*//' | head -1)
                [ -n "$_pid" ] && break
            fi
        done
    fi
    if [ -z "$_pid" ]; then
        for _lsof in lsof /usr/bin/lsof /usr/sbin/lsof; do
            if command -v "$_lsof" >/dev/null 2>&1 || [ -x "$_lsof" ]; then
                _pid=$("$_lsof" -ti ":$_port" 2>/dev/null | head -1)
                [ -n "$_pid" ] && break
            fi
        done
    fi
    echo "$_pid"
}

echo "=== WebSocket-сервер (websocket/server.php) ==="
echo ""

# Статус процесса: по PID-файлу и по порту
PROC_BY_PID=""
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        PROC_BY_PID="yes"
        echo "Процесс:  запущен (PID $PID)"
        if [ -d /proc ] && [ -r "/proc/$PID/cmdline" ]; then
            _cmd=$(cat "/proc/$PID/cmdline" 2>/dev/null | tr '\0' ' ')
            echo "Команда:  $_cmd"
        fi
    else
        echo "Процесс:  не запущен (PID $PID из server.pid не найден)"
        if ! rm -f "$PID_FILE" 2>/dev/null; then
            [ -f "$PID_FILE" ] && echo "           Файл server.pid не удалось удалить (нет прав). Чтобы сбросить: sudo rm websocket/server.pid"
        fi
    fi
else
    echo "Процесс:  по server.pid не запущен (файл отсутствует)"
fi

# Если по PID не определили «запущен» — проверяем порт и показываем, кто держит
if [ -z "$PROC_BY_PID" ] && check_port_listening "$WS_PORT"; then
    _pid_on_port=$(get_pid_on_port "$WS_PORT")
    echo "Порт:     $WS_PORT занят (слушается другим процессом; возможно, сервер запущен не через start.sh или другим пользователем)"
    if [ -n "$_pid_on_port" ]; then
        _user=$(ps -o user= -p "$_pid_on_port" 2>/dev/null || true)
        [ -n "$_user" ] && echo "           → PID $_pid_on_port (пользователь: $_user). Остановка: sudo kill $_pid_on_port или выполните ./websocket/stop.sh под пользователем $_user"
        [ -z "$_user" ] && echo "           → PID $_pid_on_port (нет прав посмотреть пользователя). Остановка: sudo kill $_pid_on_port"
    fi
fi

echo ""
echo "Порты из конфига: WebSocket=$WS_PORT, HTTP-хук (события)=$EVENT_PORT"
echo ""

echo "Слушающие порты (WebSocket / event):"
if command -v ss >/dev/null 2>&1; then
    _out=$(ss -tlnp 2>/dev/null | grep -E ":$WS_PORT[^0-9]|:$EVENT_PORT[^0-9]")
    [ -n "$_out" ] && echo "$_out" | sed 's/^/  /' || echo "  Порт $WS_PORT или $EVENT_PORT не слушается"
elif command -v netstat >/dev/null 2>&1 || [ -x /usr/bin/netstat ] || [ -x /bin/netstat ]; then
    _out=$(netstat -tlnp 2>/dev/null | grep -E ":$WS_PORT[^0-9]|:$EVENT_PORT[^0-9]")
    [ -n "$_out" ] && echo "$_out" | sed 's/^/  /' || echo "  Порт $WS_PORT или $EVENT_PORT не слушается"
else
    echo "  (ss/netstat не найдены)"
fi
