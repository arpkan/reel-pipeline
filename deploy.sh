#!/bin/bash
# deploy.sh — commit, push, build, restart
# Usage:
#   ./deploy.sh                        # auto message: "deploy YYYY-MM-DD HH:MM:SS"
#   ./deploy.sh "fix DS discovery geo" # custom commit message

set -e
cd "$(dirname "$0")"

MSG="${1:-deploy $(date '+%Y-%m-%d %H:%M:%S')}"

# ── 1. Backup database ────────────────────────────────────────────────────────
BACKUP_DIR="data/backups"
if [ -f "data/pipeline.db" ]; then
  BACKUP="$BACKUP_DIR/pipeline-$(date '+%Y-%m-%d-%H%M%S').db"
  cp "data/pipeline.db" "$BACKUP"
  echo "✓ DB backed up → $BACKUP"

  # Keep only the 20 most recent backups
  ls -t "$BACKUP_DIR"/pipeline-*.db 2>/dev/null | tail -n +21 | xargs -r rm --
  KEPT=$(ls "$BACKUP_DIR"/pipeline-*.db 2>/dev/null | wc -l)
  echo "  ($KEPT backup(s) retained)"
else
  echo "  No DB file found — skipping backup"
fi

# ── 2. Git commit ─────────────────────────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  git commit -m "$MSG"
  echo "✓ Committed: $MSG"
else
  echo "  No code changes to commit"
fi

# Push (if a remote is configured)
if git remote | grep -q .; then
  git push origin main && echo "✓ Pushed to remote" || echo "  ⚠ Push failed (build continues)"
else
  echo "  No remote configured — skipping push (see README for GitHub setup)"
fi

# ── 3. Build ──────────────────────────────────────────────────────────────────
npm run build
echo "✓ Build complete"

# ── 4. Restart ────────────────────────────────────────────────────────────────
pm2 restart pipeline
echo "✓ Server restarted"
echo ""
echo "Done. To roll back: ./rollback.sh"
