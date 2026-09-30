#!/usr/bin/env bash
# Local dev servers: the app (next dev, hot reload) and the docs preview (mkdocs serve).
#
#   scripts/dev.sh start    # start both in the background
#   scripts/dev.sh stop     # stop both
#   scripts/dev.sh status   # show what's running and where
#
# App: http://localhost:$APP_PORT, token $NOTEFEED_TOKEN (default "dev"), notes in ./data.
# Docs: http://localhost:$DOCS_PORT/notefeed/ (the site path from site_url), via the pinned mkdocs-material image (no Python needed).
# Both listen on all interfaces so you can open them from another machine on the LAN.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_PORT=${APP_PORT:-3001}   # 3000 is usually the deployed instance
DOCS_PORT=${DOCS_PORT:-8000}
PIDFILE=.dev/app.pid
DOCS_CONTAINER=notefeed-docs-dev
DOCS_IMAGE=squidfunk/mkdocs-material:9.7.7

app_running() { [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
docs_running() { [[ -n $(docker ps -q --filter "name=^${DOCS_CONTAINER}$") ]]; }

start() {
  mkdir -p .dev data
  if app_running; then
    echo "app already running"
  else
    # setsid gives next dev its own process group, so stop can end it and its workers together.
    NOTEFEED_TOKEN=${NOTEFEED_TOKEN:-dev} DATA_DIR=./data \
      setsid node_modules/.bin/next dev -p "$APP_PORT" -H 0.0.0.0 > .dev/app.log 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    echo "app starting (log: .dev/app.log)"
  fi
  if docs_running; then
    echo "docs already running"
  else
    docker run -d --rm --name "$DOCS_CONTAINER" -u "$(id -u):$(id -g)" \
      -p "$DOCS_PORT:8000" -v "$PWD:/docs" "$DOCS_IMAGE" serve -a 0.0.0.0:8000 > /dev/null
    echo "docs starting (log: docker logs -f $DOCS_CONTAINER)"
  fi
  status
}

stop() {
  if app_running; then
    kill -- -"$(cat "$PIDFILE")" 2>/dev/null || true
    echo "app stopped"
  fi
  rm -f "$PIDFILE"
  if docs_running; then
    docker stop "$DOCS_CONTAINER" > /dev/null
    echo "docs stopped"
  fi
}

status() {
  if app_running; then echo "app:  http://localhost:$APP_PORT (token: ${NOTEFEED_TOKEN:-dev})"; else echo "app:  stopped"; fi
  if docs_running; then echo "docs: http://localhost:$DOCS_PORT/notefeed/"; else echo "docs: stopped"; fi
}

case ${1:-} in
  start | stop | status) "$1" ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
