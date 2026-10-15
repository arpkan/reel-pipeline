#!/bin/bash
# rollback.sh — roll back code and/or database to a previous state
#
# Usage:
#   ./rollback.sh              # list recent commits and DB backups
#   ./rollback.sh code <hash>  # roll back source code to a git commit
#   ./rollback.sh db <file>    # roll back DB to a backup file
#   ./rollback.sh all <hash>   # roll back code + closest DB backup by timestamp

set -e
cd "$(dirname "$0")"

BACKUP_DIR="data/backups"

list() {
  echo "=== Recent code commits ==="
  git log --oneline -15
  echo ""
  echo "=== DB backups (newest first) ==="
  ls -lt "$BACKUP_DIR"/pipeline-*.db 2>/dev/null | awk '{print $NF}' | xargs -I{} basename {} || echo "  No backups found"
}

rollback_code() {
  local HASH="$1"
  if [ -z "$HASH" ]; then
    echo "Usage: ./rollback.sh code <commit-hash>"
    echo ""
    list
    exit 1
  fi
  echo "Rolling back code to $HASH..."
  git reset --hard "$HASH"
  npm run build
  pm2 restart pipeline
  echo "✓ Code rolled back to $HASH and server restarted"
}

rollback_db() {
  local FILE="$1"
  if [ -z "$FILE" ]; then
    echo "Usage: ./rollback.sh db <backup-filename>"
    echo ""
    echo "Available backups:"
    ls -lt "$BACKUP_DIR"/pipeline-*.db 2>/dev/null | awk '{print $NF}' | xargs -I{} basename {} || echo "  None"
    exit 1
  fi
  # Accept either full path or just the filename
  local BACKUP_PATH
  if [ -f "$FILE" ]; then
    BACKUP_PATH="$FILE"
  elif [ -f "$BACKUP_DIR/$FILE" ]; then
    BACKUP_PATH="$BACKUP_DIR/$FILE"
  else
    echo "Backup not found: $FILE"
    exit 1
  fi
  echo "Restoring DB from $BACKUP_PATH..."
  pm2 stop pipeline
  cp "$BACKUP_PATH" data/pipeline.db
  pm2 restart pipeline
  echo "✓ DB restored and server restarted"
}

rollback_all() {
  local HASH="$1"
  if [ -z "$HASH" ]; then
    echo "Usage: ./rollback.sh all <commit-hash>"
    list
    exit 1
  fi
  # Find the commit timestamp and pick the closest DB backup
  local COMMIT_TIME
  COMMIT_TIME=$(git log -1 --format="%ct" "$HASH" 2>/dev/null)
  if [ -z "$COMMIT_TIME" ]; then
    echo "Unknown commit: $HASH"
    exit 1
  fi
  local COMMIT_DATE
  COMMIT_DATE=$(date -d "@$COMMIT_TIME" '+%Y-%m-%d %H:%M:%S')
  echo "Commit $HASH was at: $COMMIT_DATE"

  # Find closest backup (by filename timestamp, newest backup <= commit time)
  local BEST_BACKUP=""
  for BACKUP in $(ls -t "$BACKUP_DIR"/pipeline-*.db 2>/dev/null); do
    local FNAME
    FNAME=$(basename "$BACKUP" .db)
    # Filename format: pipeline-YYYY-MM-DD-HHMMSS
    local BACKUP_DATE_STR="${FNAME#pipeline-}"
    # Convert to comparable format: YYYY-MM-DD-HHMMSS → YYYY-MM-DD HH:MM:SS
    local FORMATTED="${BACKUP_DATE_STR:0:10} ${BACKUP_DATE_STR:11:2}:${BACKUP_DATE_STR:13:2}:${BACKUP_DATE_STR:15:2}"
    local BACKUP_TIME
    BACKUP_TIME=$(date -d "$FORMATTED" '+%s' 2>/dev/null || echo 0)
    if [ "$BACKUP_TIME" -le "$COMMIT_TIME" ]; then
      BEST_BACKUP="$BACKUP"
      break
    fi
  done

  if [ -n "$BEST_BACKUP" ]; then
    echo "Closest DB backup: $(basename "$BEST_BACKUP")"
    rollback_db "$BEST_BACKUP"
  else
    echo "  No DB backup found at or before $COMMIT_DATE — skipping DB rollback"
  fi

  rollback_code "$HASH"
}

case "${1:-}" in
  ""|list)   list ;;
  code)      rollback_code "$2" ;;
  db)        rollback_db "$2" ;;
  all)       rollback_all "$2" ;;
  *)
    echo "Unknown command: $1"
    echo "Usage: ./rollback.sh [list|code <hash>|db <file>|all <hash>]"
    exit 1
    ;;
esac
