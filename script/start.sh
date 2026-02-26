#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/pythia.pid"
LOG_FILE="$SCRIPT_DIR/log/pythia.log"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Pythia is already running (PID $PID)"
    exit 1
  else
    rm -f "$PID_FILE"
  fi
fi

mkdir -p "$SCRIPT_DIR/log"

echo "Starting Pythia..."
nohup node "$SCRIPT_DIR/src/main.mjs" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "Pythia started (PID $(cat "$PID_FILE"))"
echo "Logs: $LOG_FILE"
