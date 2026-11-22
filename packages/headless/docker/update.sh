#!/usr/bin/env bash
# Update the NAS deployment from your fork (the branch CI builds, tests and scans before pushing).
# Fast-forwards the checkout, rebuilds the image, restarts only the app container, verifies it,
# and rolls back to the previous image + commit if anything fails.
#
#   ./update.sh            update if the branch has new commits
#   FORCE=1 ./update.sh    rebuild even without new commits
# Schedule it (UGREEN: Control Panel -> Task Scheduler) e.g. weekly, after the Monday CI run.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(git rev-parse --show-toplevel)"
REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${HEADLESS_BRANCH:-headless-nas}"
IMAGE="tcode-headless"
dc() { docker compose "$@"; }

[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]] || { echo "checkout has local changes; commit or stash first" >&2; exit 1; }
git -C "$ROOT" fetch --quiet "$REMOTE" "$BRANCH"
OLD="$(git -C "$ROOT" rev-parse HEAD)"
NEW="$(git -C "$ROOT" rev-parse "$REMOTE/$BRANCH")"
if [[ "$OLD" == "$NEW" && "${FORCE:-0}" != 1 ]]; then echo "already up to date ($OLD)"; exit 0; fi

git -C "$ROOT" merge --ff-only "$REMOTE/$BRANCH" || { echo "cannot fast-forward (local commits?)" >&2; exit 1; }
docker image inspect "$IMAGE:local" >/dev/null 2>&1 && docker tag "$IMAGE:local" "$IMAGE:previous" || true

rollback() {
	echo "!! update failed - rolling back to $OLD" >&2
	echo "Not resetting Git checkout: on-disk source remains at $NEW; restoring previous running image only." >&2
	if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
		docker tag "$IMAGE:previous" "$IMAGE:local"
		dc up -d --no-deps --no-build tcode
	fi
	exit 1
}

( dc build && dc up -d --no-deps --no-build tcode ) || rollback

cid="$(dc ps -q tcode)"
ok=0
for _ in $(seq 1 45); do
	st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo gone)"
	[[ "$st" == healthy ]] && { ok=1; break; }
	sleep 2
done
[[ "$ok" == 1 ]] || { dc logs --tail 40 tcode || true; rollback; }
# Light smoke test: no sessions/checkpoints are created in your real data.
dc exec -T -e TCODE_SMOKE_LIGHT=1 tcode node /app/smoke.mjs || { dc logs --tail 40 tcode || true; rollback; }
echo "updated $OLD -> $NEW"
