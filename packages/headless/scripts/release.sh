#!/usr/bin/env bash
# One-shot pipeline: sync upstream -> install -> build -> test -> safety scan -> smoke test -> package.
# Runs identically on your machine and in CI (.github/workflows/headless-release.yml).
#
#   packages/headless/scripts/release.sh                    # full run
#   STEPS=merge packages/headless/scripts/release.sh        # only some steps: merge,install,build,test,scan,smoke,package
#
# Env: UPSTREAM_REMOTE (upstream) UPSTREAM_BRANCH (main) UPSTREAM_URL (adds the remote if missing)
#      NPM_REGISTRY (https://registry.npmjs.org) OUT (release) SMOKE_PORT (1297) KEEP_MERGE_ON_FAIL=0
# Exit codes: 0 ok, 2 upstream merge conflict, 3 safety scan failed, 4 tests/smoke failed, 1 other.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HL=packages/headless
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
OUT="${OUT:-$ROOT/release}"
SMOKE_PORT="${SMOKE_PORT:-1297}"
STEPS="${STEPS:-merge,install,build,test,scan,smoke,package}"
step() { [[ ",$STEPS," == *",$1,"* ]]; }
log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$2" >&2; exit "$1"; }

PREV_HEAD="$(git rev-parse HEAD)"
UPSTREAM_SHA=""
NEW_UPSTREAM_COMMITS=0
MERGED=0
SRV=""

# On any failure after a successful merge, put the branch back (the tree was verified clean before merging),
# so a broken upstream state is never left behind. Set KEEP_MERGE_ON_FAIL=1 to inspect it instead.
on_exit() {
	local rc=$?
	[[ -n "$SRV" ]] && { kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; }
	if [[ $rc -ne 0 && "$MERGED" == 1 ]]; then
		echo "Pipeline failed; no commit will be pushed. Inspect this disposable checkout." >&2
	fi
	exit $rc
}
trap on_exit EXIT

# ---------------------------------------------------------------- merge
if step merge; then
	[[ "${GITHUB_ACTIONS:-}" == "true" || "${TCODE_ALLOW_LOCAL_MERGE:-0}" == "1" ]] || die 1 "merge requires disposable CI checkout (or explicit TCODE_ALLOW_LOCAL_MERGE=1 in a throwaway clone)"
	log "sync upstream"
	[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die 1 "working tree has uncommitted changes; commit or stash first"
	if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
		[[ -n "${UPSTREAM_URL:-}" ]] || die 1 "remote '$UPSTREAM_REMOTE' missing; set UPSTREAM_URL"
		git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
	fi
	git fetch --quiet "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
	UPSTREAM_SHA="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
	NEW_UPSTREAM_COMMITS="$(git rev-list --count "HEAD..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
	if [[ "$NEW_UPSTREAM_COMMITS" -gt 0 ]]; then
		echo "$NEW_UPSTREAM_COMMITS new upstream commit(s)"
		if ! git -c user.name="${GIT_AUTHOR_NAME:-headless-release}" -c user.email="${GIT_AUTHOR_EMAIL:-headless-release@localhost}" \
			merge --no-edit "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
			git status --short | grep -E '^(UU|AA|DU|UD|AU|UA|DD)' || true
			git merge --abort || true
			die 2 "merge conflict with $UPSTREAM_REMOTE/$UPSTREAM_BRANCH; resolve by hand (nothing was changed)"
		fi
		MERGED=1
	else
		echo "already up to date with upstream"
	fi
else
	UPSTREAM_SHA="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || true)"
fi

# ---------------------------------------------------------------- install
if step install; then
	log "npm ci"
	ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund \
		--registry="$NPM_REGISTRY" --replace-registry-host=always \
		${NODEDIR:+--nodedir="$NODEDIR"}
fi

# ---------------------------------------------------------------- build
if step build; then
	log "build renderer + headless server"
	VITE_TCODE_HEADLESS=1 npm run build -w packages/desktop
	npm run build -w packages/headless
fi

# ---------------------------------------------------------------- test
if step test; then
	log "typecheck and all workspace tests"
	npm run typecheck || die 4 "typecheck failed"
	npm test || die 4 "workspace tests failed"
fi

# ---------------------------------------------------------------- scan
if step scan; then
	log "safety scan of dist/server.mjs"
	BUNDLE="$HL/dist/server.mjs"
	[[ -f "$BUNDLE" ]] || die 1 "$BUNDLE missing (run the build step)"
	bad=0
	for pat in 'yqcc\.cn' 'new ServiceLink' 'new ManagedConfig' 'new WebSocket\('; do
		if grep -Eq "$pat" "$BUNDLE"; then
			echo "FORBIDDEN pattern in bundle: $pat"
			grep -En "$pat" "$BUNDLE" | cut -c1-160 | head -3
			bad=1
		fi
	done
	allow="$ROOT/$HL/scripts/egress-allowlist.txt"
	while read -r host; do
		grep -qxF "$host" <(grep -vE '^\s*(#|$)' "$allow") || { echo "NEW network host in bundle (review, then add to egress-allowlist.txt): $host"; bad=1; }
	done < <(grep -oE '(https?|wss?)://[A-Za-z0-9.-]+' "$BUNDLE" | sed -E 's#^[a-z]+://##' | sort -u)
	[[ "$bad" == 0 ]] || die 3 "safety scan failed"
	echo "scan ok"
fi

# ---------------------------------------------------------------- smoke
if step smoke; then
	log "smoke test against a fresh server on port $SMOKE_PORT"
	TMP="$(mktemp -d)"
	UI_SMOKE=0
	if [[ "${CI:-}" == "true" || "${TCODE_UI_SMOKE:-0}" == "1" ]]; then
		UI_SMOKE=1
		npx --no-install playwright-core install --with-deps chromium
		mkdir -p "$TMP/home/.pi/agent"
		# Isolated test-only provider. No real credentials or model requests.
		printf '%s\n' '{"providers":{"ui-smoke":{"name":"UI Smoke","baseUrl":"http://127.0.0.1:9/v1","api":"openai-completions","models":[{"id":"ui-model-a","name":"UI Model A","contextWindow":8192,"maxTokens":1024},{"id":"ui-model-b","name":"UI Model B","contextWindow":8192,"maxTokens":1024}]}}}' >"$TMP/home/.pi/agent/models.json"
		printf '%s\n' '{"ui-smoke":{"type":"api_key","key":"fixture-not-a-real-key"}}' >"$TMP/home/.pi/agent/auth.json"
	fi
	TOKEN="smoke-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
	HOME="$TMP/home" TCODE_DATA_DIR="$TMP/data" PI_CODING_AGENT_DIR="$TMP/home/.pi/agent" \
		TCODE_PORT="$SMOKE_PORT" TCODE_TOKEN="$TOKEN" \
		node "$HL/dist/server.mjs" >"$TMP/server.log" 2>&1 &
	SRV=$!
	for _ in $(seq 1 60); do
		curl -fs -o /dev/null "http://127.0.0.1:$SMOKE_PORT/api/auth-check?token=$TOKEN" && break
		kill -0 "$SRV" 2>/dev/null || { cat "$TMP/server.log"; die 4 "server exited during startup"; }
		sleep 1
	done
	if [[ "$UI_SMOKE" == 1 ]]; then
		if ! TCODE_TOKEN="$TOKEN" TCODE_URL="http://127.0.0.1:$SMOKE_PORT" node "$HL/scripts/smoke-ui.mjs"; then
			tail -40 "$TMP/server.log"
			die 4 "browser UI smoke test failed"
		fi
	fi
	if ! TCODE_TOKEN="$TOKEN" TCODE_URL="http://127.0.0.1:$SMOKE_PORT" node "$HL/scripts/smoke.mjs"; then
		tail -40 "$TMP/server.log"
		die 4 "smoke test failed"
	fi
	kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; SRV=""
fi

# ---------------------------------------------------------------- package
if step package; then
	log "package Windows bundle"
	TCODE_VERSION_STR="${TCODE_VERSION:-$(date -u +%Y.%m.%d)-$(git rev-parse --short HEAD)}"
	PI_VERSION="$(node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version")"
	export TCODE_RELEASE_VERSION="$TCODE_VERSION_STR"
	node "$HL/scripts/package-win.mjs"
	rm -rf "$OUT"
	mkdir -p "$OUT"
	ZIP="$OUT/tcode-headless-win.zip"
	(cd "$ROOT/$HL/dist-win" && python3 -m zipfile -c "$ZIP" tcode-headless-win)
	SHA="$(sha256sum "$ZIP" | cut -d' ' -f1)"
	printf '%s  %s\n' "$SHA" "tcode-headless-win.zip" >"$OUT/tcode-headless-win.zip.sha256"
	node -e '
		const [v, up, pi, sha, size, n] = process.argv.slice(1);
		console.log(JSON.stringify({ version: v, upstream: up || null, pi: pi, sha256: sha, size: Number(size), upstreamCommits: Number(n), builtAt: new Date().toISOString() }, null, 2));
	' "$TCODE_VERSION_STR" "$UPSTREAM_SHA" "$PI_VERSION" "$SHA" "$(stat -c %s "$ZIP")" "$NEW_UPSTREAM_COMMITS" >"$OUT/latest.json"
	{
		echo "TCode headless $TCODE_VERSION_STR"
		echo
		echo "- Pi SDK: $PI_VERSION"
		echo "- Upstream: ${UPSTREAM_SHA:-n/a} (${NEW_UPSTREAM_COMMITS} new commit(s) merged in this build)"
		echo "- SHA-256: $SHA"
		if [[ "$NEW_UPSTREAM_COMMITS" -gt 0 ]]; then
			echo
			echo "## Upstream changes"
			git log --no-merges --format='- %h %s' "$PREV_HEAD..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | head -50
		fi
	} >"$OUT/notes.md"
	echo "release assets in $OUT:"; ls -la "$OUT"
fi

log "done"
