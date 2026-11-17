#!/usr/bin/env bash
# ==============================================================================
# NEXUS Database Restore Shell Script
# ==============================================================================
set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER="${POSTGRES_CONTAINER:-nexus-postgres-1}"
DB_NAME="${POSTGRES_DB:-nexus_dev}"
USER="${POSTGRES_USER:-nexus_dev}"
FORCE="${2:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
    echo "Usage: $0 <path-to-backup.sql.gz> [--force]"
    exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
    echo "ERROR: Backup file '${BACKUP_FILE}' not found."
    exit 1
fi

echo "=== NEXUS Database Restore ==="
echo "Target Container: ${CONTAINER}"
echo "Target Database:  ${DB_NAME}"
echo "Backup File:      ${BACKUP_FILE}"

if [[ "${FORCE}" != "--force" && "${FORCE}" != "-y" ]]; then
    echo "WARNING: Restoring will overwrite data in '${DB_NAME}'!"
    read -r -p "Type 'CONFIRM-RESTORE' to proceed: " CONFIRMATION
    if [[ "${CONFIRMATION}" != "CONFIRM-RESTORE" ]]; then
        echo "Restore cancelled."
        exit 1
    fi
fi

gzip -dc "${BACKUP_FILE}" | docker exec -i "${CONTAINER}" psql -U "${USER}" -d "${DB_NAME}"

echo "=== Restore Complete ==="
docker exec "${CONTAINER}" psql -U "${USER}" -d "${DB_NAME}" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
