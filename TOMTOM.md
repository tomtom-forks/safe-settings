# TomTom fork of safe-settings

## 1. Purpose

TomTom's production fork of [safe-settings](https://github.com/github-community-projects/safe-settings):
upstream **2.1.18** plus a small TomTom patch set (§3).

- **Never push to, or open PRs against, upstream** from this repo.
- The GitHub web UI defaults to the **parent** repo: *Contribute → Open pull request*, the
  *Compare & pull request* banner and the base-repository picker all target upstream; *Sync fork*
  pulls upstream changes into our branch. Don't use them.
- `gh` in a fork clone can also pick the parent. Always be explicit:

```bash
gh repo set-default tomtom-forks/safe-settings          # once per clone
gh pr create -R tomtom-forks/safe-settings --base main --head <branch>
git remote add upstream https://github.com/github-community-projects/safe-settings.git
#   (if `upstream` already exists: git remote set-url upstream <same URL>)
git remote set-url --push upstream DISABLED             # upstream is fetch-only
```

## 2. Branches and tags

| Ref | Meaning |
|---|---|
| `main` | Release branch. Production runs the deployed tag (rc.7); `main` can be ahead of it. Ruleset: PR + 1 approval, linear history, squash merge queue, no force-push or deletion. |
| `2.1.18-tomtom-rc.7` | **Production.** The only rollback target. |
| `2.1.18-tomtom-rc.4` … `rc.6` | Superseded. **Not rollback targets**: each lacks later fixes (see the tag message). |
| `0.3.3` | Legacy line (upstream 0.x + TomTom patches). Historical only. |
| `archive/*` | Abandoned branches kept as tags. |
| `main-tomtom`, `main-tomtom-v2` | Old branch names (`main-tomtom` = `0.3.3`, `main-tomtom-v2` = rc.7). Will be deleted; don't branch from them. |
| Other tags (`0.1.x`–`0.3.2*`, `0.NaN.*`, `1.x`, `2.0.x`, `2.1.0`–`2.1.10`) | Inherited from upstream or old builds. Ignore. Upstream tags after 2.1.10 (incl. `2.1.18`) are not on the fork: `git fetch upstream --tags`. |

- **Rule: image tag `X` is built only from git tag `X`** (§6). For the existing rc.4–rc.7 and `0.3.3`
  images, the tag message records that the image's app files are byte-identical to the tagged commit.
- rc.1–rc.3 images have no git tags. Don't deploy them.
- The `*-tomtom*`, `0.3.3` and `archive/*` tags are annotated and signed. A tag ruleset blocks deleting or moving them.
- `package.json` says `2.1.18-tomtom-rc.1` in every build. It doesn't identify the build; the tag does.
- The intended deployed tag is pinned in an internal TomTom deployment repository. Deploys are applied
  manually, so confirm against the running deployment.
- Rollback below rc.7 is unsafe. Fix forward instead: revert or fix on `main`, then tag `2.1.18-tomtom-rc.<n+1>`.

## 3. TomTom patch set (vs upstream 2.1.18)

```bash
git log --oneline --reverse 594f3c7..2.1.18-tomtom-rc.7   # 594f3c7 = upstream tag 2.1.18
git log --oneline 2.1.18-tomtom-rc.7..origin/main          # anything newer on main
```

Oldest first; the three rebase-record commits share one row.

| SHA | Area | Change and reason |
|---|---|---|
| `3341076` | `conf/`, `docker-compose.yml` | Ported legacy deployment config + dev compose file. Not used (§7). |
| `fd97e6f` | teams | `FEATURE_CREATE_TEAMS_IF_NOT_EXIST` flag: teams are managed outside safe-settings. |
| `cf1d8d8` | mergeDeep / autolinks | Change detection skipped every key containing `url`, so `url_template` edits were dropped. |
| `50c2ffd` | settings | Disabled rulesets plugin + org-level guard (plugin re-enabled by `79e6e5f`). |
| `9fedcec` `11cf9d4` `39b3280` | `docs/rebase-2.1.18/baselines/` | Rebase records: port decisions, test and smoke-test logs. |
| `b4dc3e5` | `package.json` | Version `2.1.18-tomtom-rc.1` (never bumped since). |
| `e9ff3bc` | settings | Clone shared org/suborg `repository` config per repo: shared mutation leaked `name` across concurrent repos, which caused unintended rename `PATCH`es. |
| `742fc40` | labels, collaborators, mergeDeep, environments | Label rename via `name`/`new_name`; full invite permission map; milestones matched by `title`; singular `{name, type}` env branch policy. |
| `79e6e5f` | settings | Re-enabled rulesets plugin. |
| `754b8b2` | settings (suborgs) | Suborg conflict: last file wins + `SUBORG_CONFLICT` warning, instead of aborting the whole sync. |
| `c1216de` | branches | Always send `required_status_checks`, so branch protection no longer fails with a 422. |
| `fefb710` | settings, autolinks | Bounded repo worker pool; `await` on autolink create so its errors are caught; `RECONCILE_DONE` marker. |
| `2a5dbaa` | settings | A failing repo is logged and counted instead of killing a pool worker. |

Runtime delta: `lib/settings.js`, `lib/env.js`, `lib/mergeDeep.js`, `lib/plugins/{autolinks,branches,collaborators,environments,labels,teams}.js`.

## 4. Configuration knobs (TomTom-only)

| Env var | Default | Effect |
|---|---|---|
| `FEATURE_CREATE_TEAMS_IF_NOT_EXIST` | `false` | Only the string `true` lets the teams plugin create a missing team. Otherwise the team is skipped with the info log `Feature to create teams is disabled. Team <name> not found, skipping.` |
| `SS_REPO_CONCURRENCY` | `4` | Maximum number of repos processed at once during org-wide and suborg syncs. Unset, invalid or `0` → 4; negative → 1. |

All other variables are as upstream (see README).

## 5. Log markers

| Marker (exact format) | Level | When |
|---|---|---|
| `RECONCILE_DONE errors=<n>` | info | End of every non-dry-run sync (org, suborg, selected repos, single repo), including after a caught error. Each webhook event logs its own marker and events overlap, so **correlate by the `id` field** on the log line (the webhook delivery id). **If an event's run starts and its marker never appears, the run died or hung.** `<n>` = errors collected in that run; a non-zero count is common and is not by itself a failure. Not logged in dry-run (PR check) mode, or for a single-repo sync that stops early on a restricted repo. |
| `SUBORG_CONFLICT repo=<repo> winner=<path> loser=<path>` | warn | While suborg configs load, when the same repo name (or the identical glob string) is stored by more than one suborg file (via `suborgrepos`, `suborgteams` or `suborgproperties`). Repeats on every run until the config is fixed. Overlapping but different globs (e.g. `foo-*` vs `foo-bar`) are **not** detected: the earliest-loaded matching entry wins silently. |

## 6. Building an image

Build only from a **clean checkout of a tag**. The Dockerfile copies `package*.json`, `index.js` and
`lib/` from the working tree, and `.dockerignore` excludes `.git`, so the script passes the revision as a label.
Run it as a script (it uses `set -e`), not pasted into an interactive shell.

```bash
#!/usr/bin/env bash
# Usage: bash build-image.sh 2.1.18-tomtom-rc.N     (an existing, pushed git tag)
set -euo pipefail
TAG="$1"
git clone --depth 1 --branch "$TAG" https://github.com/tomtom-forks/safe-settings.git "ss-$TAG"
cd "ss-$TAG"
[ -z "$(git status --porcelain)" ] && [ "$(git describe --tags --exact-match)" = "$TAG" ] \
  || { echo "not a clean checkout of tag $TAG" >&2; exit 1; }
docker buildx build --platform linux/amd64 \
  --label org.opencontainers.image.source=https://github.com/tomtom-forks/safe-settings \
  --label org.opencontainers.image.version="$TAG" \
  --label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
  -t "<registry>/tomtom-forks/safe-settings:$TAG" --push .
```

Never re-push an existing image tag (registry tags are mutable; git tags are not). Record the resulting digest with the deployment change.

## 7. Legacy files

`conf/deployment.yaml` and `docker-compose.yml` are **not used** by the TomTom deployment. The image
doesn't contain them, and the deployment config is supplied at runtime (`DEPLOYMENT_CONFIG_FILE`) by the
internal deployment repository. The upstream deployment samples (`helm/`, `serverless.yml`, …) are
unchanged and unused. Of the inherited workflows, only *Node.js CI* is enabled; the release workflows are disabled.
