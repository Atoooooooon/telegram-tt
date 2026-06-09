---
name: sync-upstream-snapshot
description: Use in telegram-tt when syncing Ajaxy/telegram-tt upstream into this fork without tracking generated release artifacts, rebasing local dev, updating prod/dev, or triggering the production deploy workflow.
---

# Sync Upstream Snapshot

Use this skill for this repository when the user asks to sync upstream, update from Ajaxy/telegram-tt, refresh origin/master, rebase dev after upstream sync, push to prod/dev, or trigger deployment.

This fork intentionally does not preserve upstream commit history on `origin/master`. Upstream publishes generated release artifacts such as `dist/`; this fork keeps those artifacts out of tracking. Sync upstream by creating a source snapshot commit that records the upstream commit hash.

## Remotes

- `upstream`: `Ajaxy/telegram-tt`
- `origin`: personal fork, safe to update when requested
- `prod`: production repository

## Artifact Policy

Do not re-track generated build or report artifacts from upstream.

Keep excluded:

- `dist/`
- `dist/build-stats.json`
- `public/build-stats.json`
- `public/statoscope-report.html`

Check `.gitignore` before committing. Keep the fork-specific ignore rules unless the user explicitly changes the policy.

## Upstream Sync Workflow

1. Inspect current state.

```bash
git status --short --branch
git fetch --all --prune
git rev-parse HEAD origin/master origin/dev upstream/master
```

2. Back up branches before rewriting or snapshotting.

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
git branch "backup/origin-master-before-upstream-sync-$STAMP" origin/master
git branch "backup/origin-dev-before-upstream-sync-$STAMP" origin/dev
git branch "backup/dev-before-upstream-sync-$STAMP" dev
```

3. Update `origin/master` as a source snapshot of `upstream/master`.

Recommended approach:

- Create or reuse a temporary worktree/branch from `origin/master`.
- Replace the tracked source tree with upstream's tree.
- Restore fork policy files such as `.gitignore` when needed.
- Remove generated artifacts from the index.
- Commit a single snapshot commit.

The commit message must include the exact upstream commit:

```text
chore(upstream): sync source snapshot

Sync Ajaxy/telegram-tt master at <UPSTREAM_SHA> while keeping generated build artifacts out of the fork.

Excluded dist/ and public/build-stats.json from tracking.
```

4. Push the snapshot to the personal fork.

```bash
git push origin HEAD:master
```

5. Update `dev` on top of the new snapshot.

```bash
git switch dev
git rebase origin/master
```

Resolve conflicts by preserving project-specific customer service, rule engine, native component, backend, deployment, and artifact-ignore changes. After resolving, run focused checks before pushing.

6. Push personal fork dev.

```bash
git push --force-with-lease origin dev
```

Use `--force-with-lease` after a rebase because `dev` history changes.

## Verification

Before pushing to production, run at least:

```bash
npm test
npx tsc --noEmit
git diff --check
```

`npm run check:ts` may fail because `eslint-plugin-react-hooks-static-deps` can throw `e.getSourceCode is not a function` while linting `babel.config.js`. If that happens, report it separately and do not describe it as a TypeScript failure if `tsc` passed.

## Production Deploy Workflow

Production branch state is separate from `origin`.

1. Confirm current production refs.

```bash
git fetch prod --prune
git rev-parse dev prod/dev prod/master-deploy
```

2. Update `prod/dev` to the current `dev`.

If `prod/dev` diverged, use a lease against the exact fetched remote sha:

```bash
REMOTE_PROD_DEV=$(git rev-parse prod/dev)
git push --force-with-lease=refs/heads/dev:$REMOTE_PROD_DEV prod refs/heads/dev:refs/heads/dev
```

3. Trigger deployment.

The GitHub Actions workflow in `.github/workflows/main.yml` listens to `master-deploy`, not `master`.

Merge current `dev` into `prod/master-deploy` and push:

```bash
git switch -C master-deploy prod/master-deploy
git merge --no-ff dev -m "Merge dev into master-deploy"
git push prod master-deploy
git switch dev
```

If the user explicitly wants a fast deployment branch reset instead of a merge commit, use `--force-with-lease` only after stating the tradeoff.

## Final Report

Report:

- upstream commit hash used for the snapshot
- new `origin/master` commit
- new `origin/dev` commit
- whether `prod/dev` was force-with-lease updated
- `prod/master-deploy` commit pushed to trigger Actions
- verification commands and results
