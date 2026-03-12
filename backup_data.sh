#!/bin/bash

# Backup script for Agentic Boards data
BACKUP_DIR="./backups"
DATA_DIR="./data"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Starting backup of $DATA_DIR to $BACKUP_DIR..."

# Copy the data directory with a timestamp
cp -r "$DATA_DIR" "$BACKUP_DIR/backup_$TIMESTAMP"

echo "Backup completed: $BACKUP_DIR/backup_$TIMESTAMP"

# keep only the last 7 backups to save space
ls -dt "$BACKUP_DIR"/backup_* | tail -n +8 | xargs -d '\n' rm -rf -- 2>/dev/null

echo "Old backups cleaned up (keeping last 7)."
