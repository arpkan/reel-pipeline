# Deploying Code Changes

The standard deploy path is `./deploy.sh`, which handles backup, commit, build, and restart in one step. Use the manual steps below when you need finer control (e.g., debugging a build error or restarting without committing).

---

## Automated deploy (recommended)

```bash
cd content-pipeline   # repo root
./deploy.sh "describe what changed"
```

What it does:
1. Backs up `data/pipeline.db` to `data/backups/` (keeps last 20)
2. `git add -A && git commit -m "<message>"` (skips if nothing changed)
3. `git push origin main` (skips if no remote configured)
4. `npm run build` (`npx tsc`)
5. `pm2 restart pipeline`

To roll back the last deploy:
```bash
./rollback.sh
```

---

## Manual steps

### 1. Compile TypeScript

```bash
cd content-pipeline   # repo root
npx tsc
```

If there are errors, fix them before continuing. No output = success.

---

### 2. Stop the running server

**If using pm2 (production):**
```bash
pm2 restart pipeline
```

**If running directly:**
```bash
pkill -f "dist/bin/server.js"
```

---

### 3. Start the server (direct only)

```bash
node dist/bin/server.js >> /tmp/server.log 2>&1 &
```

---

### 4. Verify it started

```bash
ps aux | grep "dist/bin/server" | grep -v grep
# or, if using pm2:
pm2 status
```

You should see one `node dist/bin/server.js` process. If nothing shows, check the log:

```bash
cat /tmp/server.log
# or
pm2 logs pipeline --lines 50
```

---

## Notes

- **Environment variables** (`.env`) — changes also require a restart.
- **TypeScript errors** — do not restart with broken compiled output. Fix errors first.
- **Schema changes** — after modifying `src/db/schema.ts`, run `npx drizzle-kit push` before restarting.
- **Logs** — when running directly, the server appends to `/tmp/server.log`. This file is lost on reboot. pm2 logs persist in `~/.pm2/logs/`.
