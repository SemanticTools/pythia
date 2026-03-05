#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd $SCRIPT_DIR/.. && pwd)"
echo "Root directory: $ROOT_DIR"

PID_FILE="$ROOT_DIR/pythia.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "Pythia is not running (no PID file found)"
  exit 1
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Pythia is not running (stale PID $PID)"
  rm -f "$PID_FILE"
  exit 1
fi

echo "Stopping Pythia (PID $PID)..."
kill "$PID"
rm -f "$PID_FILE"
echo "Pythia stopped"
