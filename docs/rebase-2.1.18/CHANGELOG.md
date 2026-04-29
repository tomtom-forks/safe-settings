<!-- Copyright (C) 2026 TomTom NV. All rights reserved. -->

# safe-settings 2.1.18-tomtom Changelog

> Rebase of `tomtom-forks/safe-settings` from production tag `0.3.3`
> (based on upstream 2.1.10) onto upstream 2.1.18.
>
> Image: `internalplatform.azurecr.io/tomtom-forks/safe-settings:2.1.18-tomtom-rc.1`
> Branch: `main-tomtom-v2` (head `39b3280`)
> Date: 2026-04-29

## 1. Why this rebase

Four production problems that this rebase resolves:

1. **Environment variables are not provisioned** — a reference bug in the
   fork's `MergeDeep.compareDeepIfVisited()` silently drops nested array
   additions (new variables).
2. **Custom branch policies for environments don't work** — fork's
   `environments.js` does not expand string / `{type, names: []}` entries
   into the `{name, type}` schema GitHub's API requires.
3. **Pod restarts every few minutes** — the fork's
   `eachRepositoryRepos()` walks all 12,000+ installation repos
   synchronously on every suborg change, blocking the event loop past the
   45 s K8s liveness threshold.
4. **GitHub API rate-limit "death spiral"** — `loadYaml()` issues one
   uncached API call per file; a full sync exhausts the 15,000 req/h
   quota mid-pass and triggers a restart loop.

## 2. Upstream changes consumed

Versions consumed: 2.1.10 → 2.1.18.

Highlights:

- **2.1.16 → 2.1.17** — environment variables (PR #766 + new `sync()`
  override on `environments.js`), custom branch-policy expansion,
  enhanced ruleset overrides, custom-properties refactor.
- **2.1.17 → 2.1.18** — in-memory file cache (PR #817; ~96 % hit rate
  reported by upstream users), glob fix (PR #808), `syncSelectedRepos`
  + push-event deduplication (commit `594f3c7` — the upstream 2.1.18
  release commit), repository variables (PR #819), bug-bounty security
  fixes (PR #862), miscellaneous dependency updates (`braces 3.0.3`,
  `express 4.21.0`).

## 3. TomTom layer (commits on top of 2.1.18)

```
39b3280 chore(rebase): record local Docker smoke test
11cf9d4 chore(rebase): record test baselines on main-tomtom-v2
b4dc3e5 chore: set version to 2.1.18-tomtom-rc.1
9fedcec docs(rebase): record decisions for evaluated fork commits
50c2ffd chore(deployment): disable rulesets plugin in TomTom deployment
cf1d8d8 fix(autolinks): mark autolink as changed when url_template changes
fd97e6f feat(teams): port FEATURE_CREATE_TEAMS_IF_NOT_EXIST flag (default false)
3341076 chore(tomtom): port deployment config and dev compose files
```

## 4. Decisions for fork commits not carried forward

See [`dropped-commits-impact.md`](./dropped-commits-impact.md) for the
full per-commit functional matrix. Summary:

- 14 fork commits were dropped during the rebase (sync, dep bumps,
  eslint cleanup, test fixups, logging tweaks).
- 1 fork commit (`e6fb3cc`, disable rulesets) was replaced by a
  deployment-targeted disable in `50c2ffd` (PLAN option 7.3b).
- **Zero** drops require a retroactive port.

| Sha       | Subject                                                | Drop verdict |
| --------- | ------------------------------------------------------ | ------------ |
| `670c830` | chore: update from upstream                            | safe         |
| `08da822` | chore: fix info function log child                     | safe         |
| `59d0893` | bump braces 3.0.2 → 3.0.3                              | safe         |
| `a8baa65` | chore: fix eslint errors                               | safe         |
| `72418eb` | chore: fix logging issues                              | safe         |
| `2e347a5` | fixup! chore: fix logging issues                       | safe         |
| `44ddbc0` | fixup! chore: fix logging issues                       | safe         |
| `3b6c293` | chore: fix plugin log spawning                         | safe         |
| `9e45612` | chore: avoid over logging events                       | safe         |
| `647aa49` | fix(tests): properly configure child logger in unit tests | safe       |
| `bacf4cf` | chore: cleanup eslint and logging functions            | safe         |
| `7184b1a` | chore: stringify JSON objects in logs                  | safe         |
| `96c42b5` | chore: fix logging in repository plugin                | safe         |
| `f9f5da5` | bump express 4.19.2 → 4.21.0                           | safe         |
| `e6fb3cc` | fix: disable rulesets plugin                           | replaced by deployment-config disable (PLAN option 7.3b) |

## 5. Code locations of the four fixes

| Problem                        | File:Line                                                           | Notes                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| #1 env variables               | [lib/plugins/environments.js#L321](../../lib/plugins/environments.js#L321) (`sync()` override) and [#L188-L223](../../lib/plugins/environments.js#L188-L223) (variables PATCH/POST/DELETE), [#L283-L290](../../lib/plugins/environments.js#L283-L290) (variables on add) | The `sync()` override at L321 bypasses the buggy upstream `Diffable.sync()` path; `variables` are then handled directly. |
| #2 custom branch policies      | [lib/plugins/environments.js#L17-L30](../../lib/plugins/environments.js#L17-L30) (string→object expansion), [#L168-L185](../../lib/plugins/environments.js#L168-L185) (update path), [#L271-L280](../../lib/plugins/environments.js#L271-L280) (add path) | Converts string entries (and `{type, names: []}`) to GitHub's required `{name, type}` shape. |
| #3 pod restarts (code only)    | [index.js#L76](../../index.js#L76) (`Settings.syncSelectedRepos` call), [lib/settings.js#L45](../../lib/settings.js#L45) (`syncSelectedRepos` definition), [lib/settings.js#L536](../../lib/settings.js#L536) (`eachRepositoryRepos` retained for full org syncs) | Push-event handler now sends only the affected repos/suborgs through the merger instead of iterating every install repo. Deployment-side liveness-probe relaxation tracked in `HUMAN-STEPS.md` "Step B". |
| #4 rate limiting               | [lib/settings.js#L16](../../lib/settings.js#L16) (`Settings.fileCache`), [lib/settings.js#L853-L893](../../lib/settings.js#L853-L893) (`If-None-Match` + HTTP 304 handling) | Per-process in-memory cache keyed by namespaced filepath. Upstream reports ~96 % hit rate. |

## 6. Compatibility with `tomtom-internal/admin`

- **Schema validation:** 396 / 1603 files pass the admin repo's own
  `schemas/safe-settings.json` (see
  [`baselines/admin-schema-validation.json`](./baselines/admin-schema-validation.json)).
  The 1207 failures are **all** instances of admin's own schema being
  stricter than what the configs actually use today; these failures
  reproduce identically against production safe-settings 0.3.3 and
  pre-date this rebase. The dominant failure modes are:
  - 1199× `branches[0].protection` missing one or more of
    `enforce_admins`, `required_pull_request_reviews`, `restrictions`
    (the admin schema marks these as required; safe-settings treats
    them as optional and so do all 1199 affected configs);
  - 24× `repository.homepage` not matching the strict `uri` format
    (configs use bare hostnames or paths);
  - 3× `repository.security` missing `enableVulnerabilityAlerts`;
  - 1× `rulesets[0].bypass_actors[1].type` enum mismatch.
  None of these are regressions introduced by 2.1.18-tomtom; this is a
  divergence between the admin repo's schema and its own data, tracked
  separately by the `tomtom-internal/admin` `quality.yml` `momentuum`
  pipeline. **Not a blocker for this rebase.**

- **Synthetic merge dry-run:** **1602 / 1602** files processed cleanly
  through `MergeDeep.compareDeep` against the org-level config (see
  [`baselines/admin-dryrun.json`](./baselines/admin-dryrun.json)).
  Zero failures.

- **Top-level keys used in admin configs** (from
  [`baselines/admin-used-keys.txt`](./baselines/admin-used-keys.txt)):
  `autolinks`, `branches`, `collaborators`, `environments`, `labels`,
  `repository`, `rulesets`, `suborgrepos`, `teams`, `validator`.

- **Plugin coverage:** every used key is handled by a plugin in
  `Settings.PLUGINS` (see [lib/settings.js#L1001-L1020](../../lib/settings.js#L1001-L1020)),
  except:
  - `suborgrepos` — meta-directive consumed by `Settings` itself for
    suborg membership computation, not a plugin.
  - `rulesets` — **intentionally inert** in this deployment (option
    7.3b in PLAN.md §3). The `Settings.PLUGINS.rulesets` entry is
    commented out and `Settings.updateOrg()` short-circuits any ruleset
    handling. `tomtom-internal/admin` configs that include `rulesets:`
    blocks (30 configs) continue to be reconciled by
    `tomtom-internal/github-settings` (`github-as-code`) until that app
    is retired in a follow-up.

## 7. Test results

| Suite        | main-tomtom (before) | main-tomtom-v2 (after) |
| ------------ | -------------------- | ---------------------- |
| Unit         | 64 passing / 0 failing / 14 skipped (78 total) | 113 passing / 0 failing / 14 skipped (127 total) |
| Integration  | 0 passing / 8 failing — pre-existing `[@octokit/auth-app] appId option is required` fixture issue across all 7 suites | 0 passing / 8 failing — same pre-existing failure as baseline |
| Lint         | n/a                  | not run as part of this rebase |

Regressions (passing → failing): **none**. Upstream added 49 new passing
unit tests on top of the baseline. Integration suite is broken
identically on both branches by a fixture issue that pre-dates the
rebase.

## 8. Known behaviour changes (non-bug)

- **Log line shape:** several fork-only logging commits were dropped (see
  §4). Records now use upstream's `pino`-native serialisation. Field
  semantics are unchanged but boilerplate text differs. Operators keying
  on raw log strings should re-baseline any affected Grafana / Loki
  panels. Specific affected sources:
  - `index.js` event handlers (push, installation, repository, etc.).
  - `lib/plugins/diffable.js` (now logs structured objects rather than
    `JSON.stringify`'d payloads — improvement for LogQL).
  - `lib/plugins/repository.js` (object-vs-string arg ordering aligned
    with upstream `pino` calls).
- **`Settings.fileCache` is per-process and unbounded.** With ~9000 admin
  config entries the steady-state RSS overhead is expected to be in the
  low-hundreds of MB. The kaap deployment manifest already permits 1Gi.
- **Push-event handler does selective syncs.** Webhooks complete in
  seconds rather than minutes once the cache is warm. Grafana panels
  that measured "duration of webhook processing" should be re-baselined.
- **Image surface area grew** (file-list diff in
  [`baselines/file-diff.txt`](./baselines/file-diff.txt)): 21 → 29
  `*.js` files under `/opt/safe-settings/lib`. Notable additions:
  `commentmessage.js`, `error.js`, `proxiedFetch.js`,
  `proxyAwareProbotOctokit.js`, `plugins/archive.js`,
  `plugins/overrides.js`, `plugins/variables.js`. Nothing was removed
  relative to 0.3.3.

## 9. Known behaviour we deliberately did NOT change

- **Rulesets remain unmanaged by safe-settings** (continued ownership by
  `github-as-code`); see PLAN.md §8 follow-up.
- **Team creation remains gated** by `FEATURE_CREATE_TEAMS_IF_NOT_EXIST=true`
  (default `false`). TomTom uses Terraform for teams; safe-settings only
  manages team-permission on repos. Note: `SESSION-1.md` referred to the
  flag as `CREATE_TEAM`, but the actual env-var name preserved from fork
  commit `1a9e70a` is `FEATURE_CREATE_TEAMS_IF_NOT_EXIST` for backward
  compatibility with any existing kaap/Flux deployment that sets it.
- **Production tag `0.3.3` and branch `main-tomtom` are unchanged.**

## 10. Rollback

To revert to production:

1. In the kaap app definition for safe-settings, change the image tag
   back from `2.1.18-tomtom-rc.N` to `0.3.3` (and re-enable the legacy
   Flux deployment in `tomtom-internal/github-settings` if it was
   scaled to zero — see HUMAN-STEPS §B).
2. Wait for the kaap reconcile interval — the deployment will roll
   back.
3. No data migration is required; safe-settings is stateless.

## 11. Follow-ups (not in this rebase)

- Retire `tomtom-internal/github-settings` (`github-as-code`) by
  migrating ruleset configs into safe-settings YAML and re-enabling the
  rulesets plugin (uncomment one line in [lib/settings.js#L1009](../../lib/settings.js#L1009)
  and remove the defensive guard in `updateOrg()`).
- Repair the `Create a release` GitHub Actions workflow in
  `tomtom-forks/safe-settings` (currently broken — produces `0.NaN.0`
  tags from `actionsdesk/semver`).
- Migrate the deployment fully to **kaap** and decommission the legacy
  Flux deployment once the kaap soak proves out.
- Increase liveness-probe tolerance in the kaap deployment manifest
  (see HUMAN-STEPS.md "Step B") — independent of this rebase but
  recommended in the same change window.
- Triage and reconcile the 1207 admin schema-validation failures
  reported in §6: either relax `admin/schemas/safe-settings.json` to
  match real-world data, or update the failing configs to satisfy the
  schema. Independent of this rebase; tracked by the `tomtom-internal/admin`
  team.
