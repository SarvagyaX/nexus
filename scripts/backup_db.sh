#!/usr/bin/env bash
# ==============================================================================
# NEXUS Database Backup Shell Script
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
CONTAINER="${POSTGRES_CONTAINER:-nexus-postgres-1}"
DB_NAME="${POSTGRES_DB:-nexus_dev}"
USER="${POSTGRES_USER:-nexus_dev}"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/nexus_backup_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

echo "=== NEXUS Database Backup ==="
echo "Container: ${CONTAINER}"
echo "Database:  ${DB_NAME}"
echo "Output:    ${BACKUP_FILE}"

docker exec -i "${CONTAINER}" pg_dump -U "${USER}" -d "${DB_NAME}" \
    --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILE}"

if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"
elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${BACKUP_FILE}" > "${CHECKSUM_FILE}"
fi

echo "=== Backup Complete ==="
ls -lh "${BACKUP_FILE}"
