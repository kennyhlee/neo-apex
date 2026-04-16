#!/usr/bin/env bash
#
# Start NeoApex services.
#
# Usage:
#   ./start-services.sh          # Non-interactive (default): kill existing, start all
#   ./start-services.sh -i       # Interactive mode: choose which to kill/start
#   ./start-services.sh --interactive  # Same as -i
#
set -euo pipefail

# Load environment variables (API keys, etc.)
# Extract export lines from shell profile (works in both bash and zsh)
if [ -f "$HOME/.zshrc" ]; then
  eval "$(grep '^export ' "$HOME/.zshrc" 2>/dev/null)" || true
elif [ -f "$HOME/.bashrc" ]; then
  eval "$(grep '^export ' "$HOME/.bashrc" 2>/dev/null)" || true
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Parse args ────────────────────────────────────────────────

INTERACTIVE=false
for arg in "$@"; do
  case "$arg" in
    -i|--interactive) INTERACTIVE=true ;;
    -h|--help)
      echo "Usage: $0 [-i|--interactive]"
      echo "  -i, --interactive   Interactive mode: choose which services to kill/start"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ── Read ports from services.json ─────────────────────────────

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is required"
  exit 1
fi

read_port() {
  python3 -c "import json; print(json.load(open('services.json'))['services']['$1']['port'])"
}

DATACORE_PORT=$(read_port "datacore")
LAUNCHPAD_BE_PORT=$(read_port "launchpad-backend")
PAPERMITE_BE_PORT=$(read_port "papermite-backend")
ADMINDASH_BE_PORT=$(read_port "admindash-backend")
LAUNCHPAD_FE_PORT=$(read_port "launchpad-frontend")
PAPERMITE_FE_PORT=$(read_port "papermite-frontend")
ADMINDASH_FE_PORT=$(read_port "admindash-frontend")

# Service definitions: name, port, type (backend/frontend)
SERVICES=(
  "datacore:$DATACORE_PORT:backend"
  "launchpad-backend:$LAUNCHPAD_BE_PORT:backend"
  "papermite-backend:$PAPERMITE_BE_PORT:backend"
  "admindash-backend:$ADMINDASH_BE_PORT:backend"
  "launchpad-frontend:$LAUNCHPAD_FE_PORT:frontend"
  "papermite-frontend:$PAPERMITE_FE_PORT:frontend"
  "admindash-frontend:$ADMINDASH_FE_PORT:frontend"
)

# ── Helpers ───────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
fail()  { echo -e "${RED}[fail]${NC}  $1"; }

find_pid_on_port() {
  lsof -ti :"$1" 2>/dev/null || true
}

kill_port() {
  local port=$1
  local pids
  pids=$(find_pid_on_port "$port")
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 0.5
    # Force kill if still running
    pids=$(find_pid_on_port "$port")
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
      sleep 0.3
    fi
  fi
}

wait_for_port() {
  local port=$1
  local name=$2
  local max_wait=15
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if lsof -ti :"$port" &>/dev/null; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# ── Step 1: Check for running services ────────────────────────

echo ""
echo -e "${BOLD}Checking for running services...${NC}"
echo ""

RUNNING=()
for entry in "${SERVICES[@]}"; do
  IFS=: read -r name port type <<< "$entry"
  pid=$(find_pid_on_port "$port")
  if [ -n "$pid" ]; then
    RUNNING+=("$entry")
    warn "$name is running on port $port (PID: $(echo $pid | tr '\n' ' '))"
  fi
done

if [ ${#RUNNING[@]} -eq 0 ]; then
  ok "No services currently running"
else
  echo ""
  if $INTERACTIVE; then
    echo -e "${BOLD}Running services found. What would you like to do?${NC}"
    echo "  1) Kill all running services"
    echo "  2) Choose which to kill"
    echo "  3) Skip (leave running)"
    read -rp "Choice [1/2/3]: " choice
    echo ""

    case "$choice" in
      1)
        for entry in "${RUNNING[@]}"; do
          IFS=: read -r name port type <<< "$entry"
          info "Stopping $name on port $port..."
          kill_port "$port"
          ok "Stopped $name"
        done
        ;;
      2)
        for entry in "${RUNNING[@]}"; do
          IFS=: read -r name port type <<< "$entry"
          read -rp "Kill $name on port $port? [y/N]: " yn
          if [[ "$yn" =~ ^[Yy] ]]; then
            info "Stopping $name on port $port..."
            kill_port "$port"
            ok "Stopped $name"
          else
            info "Skipping $name"
          fi
        done
        ;;
      3)
        info "Leaving running services as-is"
        ;;
      *)
        info "Invalid choice, skipping"
        ;;
    esac
  else
    info "Non-interactive mode: stopping all running services..."
    for entry in "${RUNNING[@]}"; do
      IFS=: read -r name port type <<< "$entry"
      info "Stopping $name on port $port..."
      kill_port "$port"
      ok "Stopped $name"
    done
  fi
fi

# ── Step 2: Start services ───────────────────────────────────

echo ""
echo -e "${BOLD}Starting services...${NC}"
echo ""

LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"

start_service() {
  local name=$1
  local port=$2

  # Skip if already running
  if lsof -ti :"$port" &>/dev/null; then
    warn "$name already running on port $port, skipping"
    return 0
  fi

  local log_file="$LOG_DIR/$name.log"

  case "$name" in
    datacore)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/datacore"
      uv run uvicorn datacore.api.server:app --host 127.0.0.1 --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
    launchpad-backend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/launchpad/backend"
      source "$SCRIPT_DIR/launchpad/.venv/bin/activate" 2>/dev/null || true
      uvicorn app.main:app --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
    papermite-backend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/papermite/backend"
      source "$SCRIPT_DIR/papermite/.venv/bin/activate" 2>/dev/null || true
      uvicorn app.main:app --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
    admindash-backend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/admindash"
      uv run uvicorn app.main:app --app-dir backend --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
    launchpad-frontend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/launchpad/frontend"
      npm run dev > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
    papermite-frontend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/papermite/frontend"
      npm run dev > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
    admindash-frontend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/admindash/frontend"
      npm run dev > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
  esac

  if wait_for_port "$port" "$name"; then
    ok "$name started on port $port"
  else
    fail "$name failed to start on port $port (check $log_file)"
  fi
}

if $INTERACTIVE; then
  echo "Which services would you like to start?"
  echo "  1) All services"
  echo "  2) Choose individually"
  read -rp "Choice [1/2]: " start_choice
  echo ""

  case "$start_choice" in
    1)
      for entry in "${SERVICES[@]}"; do
        IFS=: read -r name port type <<< "$entry"
        start_service "$name" "$port"
      done
      ;;
    2)
      for entry in "${SERVICES[@]}"; do
        IFS=: read -r name port type <<< "$entry"
        read -rp "Start $name on port $port? [Y/n]: " yn
        if [[ ! "$yn" =~ ^[Nn] ]]; then
          start_service "$name" "$port"
        else
          info "Skipping $name"
        fi
      done
      ;;
    *)
      info "Invalid choice, starting all"
      for entry in "${SERVICES[@]}"; do
        IFS=: read -r name port type <<< "$entry"
        start_service "$name" "$port"
      done
      ;;
  esac
else
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r name port type <<< "$entry"
    start_service "$name" "$port"
  done
fi

# ── Summary ──────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Service Status${NC}"
echo "┌────────────────────────┬──────┬─────────┐"
echo "│ Service                │ Port │ Status  │"
echo "├────────────────────────┼──────┼─────────┤"

for entry in "${SERVICES[@]}"; do
  IFS=: read -r name port type <<< "$entry"
  if lsof -ti :"$port" &>/dev/null; then
    status="${GREEN}running${NC}"
  else
    status="${RED}stopped${NC}"
  fi
  printf "│ %-22s │ %4s │ %b │\n" "$name" "$port" "$status"
done

echo "└────────────────────────┴──────┴─────────┘"
echo ""
echo -e "Logs: ${CYAN}$LOG_DIR/${NC}"
echo ""
