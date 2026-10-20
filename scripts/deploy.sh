#!/usr/bin/env bash
#
# Reel Studio: deploy main on the server.
#
#   sudo ./scripts/deploy.sh              pull, install, migrate, build, restart
#   sudo ./scripts/deploy.sh --rollback   go back to the previously deployed commit
#
# The build runs before either service is touched, so a broken build fails the
# deploy and the running version keeps serving. Setup: docs/hosting.md.
#
APP_DIR="${APP_DIR:-/srv/reel-studio}"
BRANCH="${BRANCH:-main}"
APP_USER="${APP_USER:-reelstudio}"
SERVICES=(reel-studio-api reel-studio-web)

set -Eeuo pipefail

# The git reset below rewrites this file while bash is reading it; run from a copy.
if [ -z "${REEL_DEPLOY_SELF:-}" ]; then
  _self="$(mktemp /tmp/reel-deploy.XXXXXX)"
  cat -- "$0" > "$_self"
  chmod 700 "$_self"
  export REEL_DEPLOY_SELF="$_self"
  exec bash "$_self" "$@"
fi
case "$REEL_DEPLOY_SELF" in
  /tmp/reel-deploy.*) trap 'rm -f -- "$REEL_DEPLOY_SELF"' EXIT ;;
esac

ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
# Everything except systemctl runs as the app user, with a fixed PATH and no prompts.
as_app() {
  sudo -u "$APP_USER" -H env CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PATH="/usr/local/bin:/usr/bin:/bin" \
    NEXT_PUBLIC_API_URL="${PUBLIC_URL:-}" bash -c "cd '$APP_DIR' && $*"
}

trap 'die "failed at line $LINENO. The running version was not touched."' ERR

[ "$(id -u)" = "0" ] || die "run with sudo: systemctl and sudo -u both need it."
cd "$APP_DIR" || die "$APP_DIR does not exist."
[ -d .git ] || die "$APP_DIR is not a git checkout."
[ -f .env ] || die "$APP_DIR/.env is missing. See docs/hosting.md, step 4."

bold "Preflight"
command -v node >/dev/null || die "node is not installed."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || die "Node $(node --version) is too old; Reel Studio needs 22.12+."
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || die "ffmpeg/ffprobe missing: sudo apt install ffmpeg"
command -v corepack >/dev/null || die "corepack missing (it ships with Node 22)."
PUBLIC_URL="$(grep -E '^PUBLIC_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
[ -n "$PUBLIC_URL" ] || die "PUBLIC_URL is not set in .env; the web app needs it at build time."
ok "node $(node --version), $(ffmpeg -version | head -1 | cut -d' ' -f1-3), PUBLIC_URL=$PUBLIC_URL"

bold "Code"
PREV="$(sudo -u "$APP_USER" -H git -C "$APP_DIR" rev-parse HEAD)"
if [ "$ROLLBACK" = 1 ]; then
  [ -f .deploy-last-sha ] || die "nothing to roll back to."
  TARGET="$(cat .deploy-last-sha)"
else
  sudo -u "$APP_USER" -H git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  TARGET="$(sudo -u "$APP_USER" -H git -C "$APP_DIR" rev-parse "origin/$BRANCH")"
fi
sudo -u "$APP_USER" -H git -C "$APP_DIR" reset --quiet --hard "$TARGET"
ok "$(sudo -u "$APP_USER" -H git -C "$APP_DIR" log --oneline -1)"

bold "Install"
as_app "corepack pnpm install --frozen-lockfile"
# Face, pose and hand models for badge placement (git-ignored; fetched once).
[ -n "$(ls -A apps/web/public/mediapipe 2>/dev/null)" ] || as_app "corepack pnpm --filter @reel/web mediapipe"
ok "dependencies"

bold "Database"
as_app "corepack pnpm --filter @reel/api exec prisma migrate deploy"
ok "migrations applied"

bold "Build"
as_app "corepack pnpm build"
ok "built (API URL $PUBLIC_URL)"

bold "Restart"
systemctl restart "${SERVICES[@]}"
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:4100/api/health >/dev/null 2>&1 && curl -fsS -o /dev/null http://127.0.0.1:3100/ 2>/dev/null && break
  [ "$i" = 30 ] && die "not healthy after 60s. Logs: journalctl -u reel-studio-api -u reel-studio-web -n 100"
  sleep 2
done
ok "API and web answering"

[ "$PREV" != "$TARGET" ] && echo "$PREV" > .deploy-last-sha
printf '\n\033[32mDeployed %s\033[0m\n' "$(sudo -u "$APP_USER" -H git -C "$APP_DIR" log --oneline -1)"
