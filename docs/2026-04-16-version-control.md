# Version Control Implementation

**Date:** 2026-04-16
**Goal:** Git-based version control for source code + local DB backups, with GitHub remote and auto-commit on deploy.

---

## What Was Built

### `deploy.sh`
Replaces the manual `npm run build && pm2 restart pipeline` workflow. Run this after every change.

```bash
./deploy.sh                          # auto message: "deploy YYYY-MM-DD HH:MM:SS"
./deploy.sh "fix DS discovery geo"   # custom commit message
```

Steps it performs:
1. Backs up `data/pipeline.db` → `data/backups/pipeline-YYYYMMDD-HHMMSS.db`
2. Retains last 20 backups (deletes oldest)
3. Commits all changed source files to git
4. Pushes to GitHub (if remote is configured)
5. Runs `npm run build`
6. Runs `pm2 restart pipeline`

### `rollback.sh`
Restore any previous state.

```bash
./rollback.sh                                       # list recent commits + DB backups
./rollback.sh code <commit-hash>                    # roll back source code
./rollback.sh db <backup-filename>                  # restore a DB backup
./rollback.sh all <commit-hash>                     # roll back both (auto-matches closest DB backup)
```

### DB Backups (`data/backups/`)
- Binary copies of `data/pipeline.db` taken before every deploy
- Stored locally only — not committed to git (binary, changes every pipeline run)
- Last 20 backups retained automatically

---

## Files Modified / Created

| File | Change |
|---|---|
| `.gitignore` | Updated to exclude `dist/`, `data/*.db`, `assets/music/`, `work/`, `logs/` |
| `deploy.sh` | New — auto backup + commit + build + restart |
| `rollback.sh` | New — list/restore code and DB |
| `data/backups/` | New directory for DB backups |

---

## What Is Tracked in Git

| Tracked | Not Tracked |
|---|---|
| `src/` — all TypeScript source | `dist/` — build output |
| `bin/`, `api/`, `scripts/` | `node_modules/` |
| `src/brands/ds.ts`, `ns.ts` | `.env` — secrets |
| `docs/`, `ref-docs/` | `data/pipeline.db` — live DB |
| `package.json`, `tsconfig.json` | `data/backups/` — DB snapshots |
| `deploy.sh`, `rollback.sh` | `assets/music/` — large binaries |
| `.env.example` | `work/`, `logs/` |

---

## One-Time GitHub Setup (manual)

1. Create a **private** repo on GitHub (private — contains brand configs and page tokens in brand files)
2. Run:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

After this, `deploy.sh` pushes automatically on every run.

---

## Design Decisions

- **DB not in git** — the SQLite DB changes on every pipeline run (new posts, reels, runs). Committing binary blobs that change every hour would bloat the repo quickly. Instead, timestamped binary copies in `data/backups/` give local rollback capability.
- **No git LFS** — avoided additional complexity. Music assets (165 MB) are excluded entirely; DB backups stay on disk.
- **Auto-commit on deploy, not on every save** — commits represent deployed states, making rollbacks meaningful. A commit = a version that was actually running.
- **`rollback.sh all`** — when rolling back both code and DB, it finds the DB backup closest in time to (but not after) the target commit, so the data matches the code that was running at that point.
