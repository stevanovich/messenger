#!/bin/sh
# Перезапуск WebSocket-сервера: остановка (stop.sh) и запуск в фоне (start.sh)

SCRIPT_DIR="$(dirname "$0")"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"
"$SCRIPT_DIR/stop.sh"
"$SCRIPT_DIR/start.sh"
