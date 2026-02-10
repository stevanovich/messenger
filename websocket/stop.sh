#!/bin/sh
# Остановка WebSocket-сервера, запущенного через websocket/start.sh
# Если в config задан WEBSOCKET_RUN_AS_USER — скрипт перезапускает себя под этим пользователем (чтобы веб и CLI могли останавливать один и тот же процесс).

SCRIPT_DIR="$(dirname "$0")"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$ROOT/config/config.php"

# Всегда работать от одного пользователя (как в start.sh)
if [ -z "$WEBSOCKET_RUN_AS_USER" ] && [ -f "$CONFIG_FILE" ]; then
    WEBSOCKET_RUN_AS_USER=$(grep -E "define\s*\(\s*['\"]WEBSOCKET_RUN_AS_USER['\"]\s*," "$CONFIG_FILE" 2>/dev/null | sed -n "s/.*,\s*['\"]\\([^'\"]*\\)['\"].*/\1/p" | head -1)
fi
if [ -n "$WEBSOCKET_RUN_AS_USER" ] && [ "$(whoami)" != "$WEBSOCKET_RUN_AS_USER" ]; then
    export WEBSOCKET_RUN_AS_USER
    exec sudo -u "$WEBSOCKET_RUN_AS_USER" "$0"
fi

PID_FILE="$ROOT/websocket/server.pid"
KILLED=0

# Читаем порт из config (тот же формат, что в info.sh)
PORT=8081
if [ -f "$CONFIG_FILE" ]; then
    _p=$(grep -E "define\s*\(\s*['\"]WEBSOCKET_PORT['\"]\s*," "$CONFIG_FILE" 2>/dev/null | sed -n "s/.*,\s*\([0-9]*\).*/\1/p")
    [ -n "$_p" ] && PORT="$_p"
fi

# Убить процесс: SIGTERM, через 1 с при необходимости SIGKILL. Возврат 0 только если процесс действительно завершился.
do_kill() {
    _pid="$1"
    [ -z "$_pid" ] && return 1
    ! kill -0 "$_pid" 2>/dev/null && return 1
    kill "$_pid" 2>/dev/null
    sleep 1
    if kill -0 "$_pid" 2>/dev/null; then
        kill -9 "$_pid" 2>/dev/null
        sleep 1
    fi
    if kill -0 "$_pid" 2>/dev/null; then
        return 1
    fi
    return 0
}

# Найти PID процесса, слушающего порт (ss, netstat или lsof)
get_pid_by_port() {
    _port="$1"
    _pid=""
    # ss (Linux): LISTEN ... *:8081 *:* users:(("php",pid=12345,fd=3))
    if command -v ss >/dev/null 2>&1; then
        _line=$(ss -tlnp 2>/dev/null | grep ":$_port[^0-9]")
        if [ -n "$_line" ]; then
            _pid=$(echo "$_line" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
        fi
    fi
    # netstat (Linux/BusyBox): ... 0.0.0.0:8081 ... LISTEN 12345/php
    if [ -z "$_pid" ]; then
        _netstat=""
        for _cmd in netstat /usr/bin/netstat /bin/netstat; do
            if command -v "$_cmd" >/dev/null 2>&1 || [ -x "$_cmd" ]; then
                _netstat="$_cmd"
                break
            fi
        done
        if [ -n "$_netstat" ]; then
            _line=$($_netstat -tlnp 2>/dev/null | grep ":$_port[^0-9]")
            if [ -n "$_line" ]; then
                _pid=$(echo "$_line" | awk '{print $NF}' | sed 's/\/.*//' | head -1)
            fi
        fi
    fi
    # lsof
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

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if do_kill "$PID"; then
        KILLED=1
        echo "WebSocket-сервер остановлен (PID $PID)"
    else
        if kill -0 "$PID" 2>/dev/null; then
            echo "Нет прав остановить процесс PID $PID. Запустите от того же пользователя или по SSH: ./websocket/stop.sh"
        else
            echo "Процесс PID $PID не найден, проверяю порт $PORT..."
        fi
    fi
    rm -f "$PID_FILE"
fi

if [ "$KILLED" -eq 0 ]; then
    PID=$(get_pid_by_port "$PORT")
    if [ -n "$PID" ]; then
        if do_kill "$PID"; then
            echo "Процесс на порту $PORT остановлен (PID $PID)"
        else
            echo "Нет прав остановить процесс на порту $PORT (PID $PID). Запустите от того же пользователя или по SSH: ./websocket/stop.sh"
        fi
    else
        echo "Процесс на порту $PORT не обнаружен."
    fi
fi
