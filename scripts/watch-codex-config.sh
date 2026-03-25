#!/usr/bin/env bash
set -euo pipefail

HOME_DIR="${1:?home directory is required}"
UNIT_NAME="${2:-codex-wechat-channel.service}"
CODEX_HOME="${HOME_DIR}/.codex"
CONFIG_FILE="${CODEX_HOME}/config.toml"
AGENTS_FILE="${CODEX_HOME}/AGENTS.md"
SKILLS_DIR="${CODEX_HOME}/skills"
PROMPTS_DIR="${CODEX_HOME}/prompts"

log() {
  echo "[watcher] $*"
  logger -t codex-wechat-channel-watch "$*"
}

ROOT_WATCH_PATHS=()
RECURSIVE_WATCH_PATHS=()

if [ -d "${CODEX_HOME}" ]; then
  ROOT_WATCH_PATHS+=("${CODEX_HOME}")
fi

for target in "${SKILLS_DIR}" "${PROMPTS_DIR}"; do
  if [ -d "${target}" ]; then
    RECURSIVE_WATCH_PATHS+=("${target}")
  fi
done

if [ "${#ROOT_WATCH_PATHS[@]}" -eq 0 ] && [ "${#RECURSIVE_WATCH_PATHS[@]}" -eq 0 ]; then
  log "no existing watch roots found under ${CODEX_HOME}"
  exit 1
fi

last_restart=0

should_restart() {
  local changed_path="$1"

  case "${changed_path}" in
    "${CONFIG_FILE}"|\
    "${AGENTS_FILE}"|\
    "${SKILLS_DIR}"/*|\
    "${PROMPTS_DIR}"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_watchers() {
  local pids=()

  if [ "${#ROOT_WATCH_PATHS[@]}" -gt 0 ]; then
    /usr/bin/inotifywait -m \
      -e close_write,create,delete,move \
      --format '%w%f %e' \
      "${ROOT_WATCH_PATHS[@]}" &
    pids+=("$!")
  fi

  if [ "${#RECURSIVE_WATCH_PATHS[@]}" -gt 0 ]; then
    /usr/bin/inotifywait -m -r \
      -e close_write,create,delete,move \
      --format '%w%f %e' \
      "${RECURSIVE_WATCH_PATHS[@]}" &
    pids+=("$!")
  fi

  trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT
  wait "${pids[@]}"
}

run_watchers | while read -r changed_path events; do
    if ! should_restart "${changed_path}"; then
      continue
    fi

    now=$(date +%s)
    if (( now - last_restart < 5 )); then
      continue
    fi

    last_restart=$now
    log "change detected: ${events} ${changed_path}; restarting ${UNIT_NAME}"
    /bin/systemctl restart "${UNIT_NAME}"
  done
