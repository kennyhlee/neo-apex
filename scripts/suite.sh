#!/usr/bin/env bash
#
# Suite-wide release marker.
#
# Each module deploys independently from its own tag, so no single git commit
# describes "what is live". `deploy/suite-manifest.json` does: it records the
# set of module releases known to be good together, and the `deployable` tag
# marks the commit where that set was last promoted.
#
#   ./scripts/suite.sh status              what is live vs the manifest
#   ./scripts/suite.sh promote             capture live -> manifest, tag it
#   ./scripts/suite.sh rollback [module…]  redeploy the manifest's versions
#
# `promote` reads the deployed image tags off Fly, so the manifest records
# what is actually running rather than what someone believed was running.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/deploy/suite-manifest.json"
MARKER_TAG="deployable"
MODULES=(datacore launchpad papermite admindash)

# datacore is the only module whose Fly app is not "<module>-api".
fly_app_for() { [ "$1" = "datacore" ] && echo "datacore" || echo "$1-api"; }

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not on PATH"; }

# Deployed release tag for a module, read from its Fly image. Empty if unknown.
live_version() {
  local app image
  app="$(fly_app_for "$1")"
  image="$(flyctl status --app "$app" 2>/dev/null | grep -i '^ *Image' | head -1 || true)"
  # ".../admindash-api:admindash-v0.10.4" -> "admindash-v0.10.4"
  printf '%s' "${image##*:}" | tr -d ' '
}

manifest_version() {
  python3 -c "import json,sys; print(json.load(open('$MANIFEST'))['modules'].get('$1',''))"
}

manifest_field() {
  python3 -c "import json,sys; print(json.load(open('$MANIFEST')).get('$1',''))"
}

cmd_status() {
  need flyctl
  printf '%-12s %-22s %-22s %s\n' MODULE LIVE MANIFEST ''
  local drift=0
  for m in "${MODULES[@]}"; do
    local live want mark
    live="$(live_version "$m")"; want="$(manifest_version "$m")"
    if [ -z "$live" ]; then
      mark=$'\033[33m? unreachable\033[0m'
    elif [ "$live" = "$want" ]; then
      mark=$'\033[32m= in sync\033[0m'
    else
      mark=$'\033[33m! drifted\033[0m'; drift=1
    fi
    printf '%-12s %-22s %-22s %b\n' "$m" "${live:-—}" "${want:-—}" "$mark"
  done
  echo
  echo "marker:   $MARKER_TAG -> $(git -C "$REPO_ROOT" rev-parse --short "$MARKER_TAG" 2>/dev/null || echo 'not set')"
  echo "promoted: $(manifest_field promoted_at) from $(manifest_field promoted_from)"
  [ "$drift" -eq 1 ] && echo $'\nLive differs from the manifest. `promote` to accept it as known-good.'
  return 0
}

cmd_promote() {
  need flyctl; need git
  local commit stamp entries=() missing=()
  commit="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  for m in "${MODULES[@]}"; do
    local live; live="$(live_version "$m")"
    [ -z "$live" ] && missing+=("$m") || entries+=("$m=$live")
  done
  [ ${#missing[@]} -gt 0 ] && die "could not read a deployed version for: ${missing[*]}
Is flyctl authenticated? Promoting a partial set would record a rollback point that cannot be restored."

  MODS="${entries[*]}" COMMIT="$commit" STAMP="$stamp" python3 - "$MANIFEST" <<'PY'
import json, os, sys
path = sys.argv[1]
doc = json.load(open(path))
doc['promoted_at'] = os.environ['STAMP']
doc['promoted_from'] = os.environ['COMMIT']
doc['modules'] = dict(p.split('=', 1) for p in os.environ['MODS'].split())
json.dump(doc, open(path, 'w'), indent=2, ensure_ascii=False)
open(path, 'a').write('\n')
PY

  echo "manifest updated:"
  for e in "${entries[@]}"; do printf '  %s\n' "$e"; done
  echo
  echo "Next:"
  echo "  git add deploy/suite-manifest.json && git commit -m 'chore: promote suite marker'"
  echo "  git tag -f -a $MARKER_TAG -m 'Suite known-good: $stamp' && git push -f origin $MARKER_TAG"
}

cmd_rollback() {
  need gh
  local targets=("$@"); [ ${#targets[@]} -eq 0 ] && targets=("${MODULES[@]}")

  echo "Redeploying the manifest's versions:"
  local plan=()
  for m in "${targets[@]}"; do
    local want; want="$(manifest_version "$m")"
    [ -z "$want" ] && die "no version recorded for '$m' in the manifest"
    plan+=("$m:$want"); printf '  %-12s -> %s\n' "$m" "$want"
  done

  echo
  read -r -p "Dispatch these deploys? Each still needs production approval. [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

  for p in "${plan[@]}"; do
    gh workflow run deploy.yml -f module="${p%%:*}" -f version="${p##*:}" \
      && echo "  dispatched ${p%%:*}"
  done
  echo
  echo "Approve each run at: Actions -> Deploy -> Review deployments"
}

case "${1:-}" in
  status)   shift; cmd_status "$@" ;;
  promote)  shift; cmd_promote "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  *) sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 1 ;;
esac
