# NEXUS — Database Backup & Disaster Recovery Guide

This document outlines the backup, verification, and restore procedures for the PostgreSQL database in the NEXUS platform.

---

## 1. Overview & Strategy

- **Format**: Gzip-compressed plain-text SQL dumps (`.sql.gz`).
- **Integrity**: Every backup archive is paired with a SHA-256 checksum file (`.sha256`).
- **Safety Gate**: The restore utility requires explicit human confirmation (`CONFIRM-RESTORE`) before executing any destructive operations.
- **Portability**: Utilities are written in Python 3 (`scripts/backup_db.py`, `scripts/restore_db.py`) with native cross-platform support across Windows, Linux, and macOS, alongside POSIX shell wrappers (`scripts/backup_db.sh`, `scripts/restore_db.sh`).
- **Source Control Safety**: The `backups/` directory, `*.sql`, `*.sql.gz`, and `*.sha256` files are strictly excluded from Git.

---

## 2. Taking a Database Backup

### Using Python (Cross-Platform)
```bash
python scripts/backup_db.py
```

### Options:
- `--output-dir <path>`: Destination directory (default: `backups`).
- `--container <name>`: Docker PostgreSQL container name (default: auto-detected).
- `--db <name>`: Database name (default: from `.env` or `nexus_dev`).
- `--user <name>`: Database user (default: from `.env` or `nexus_dev`).

### Using Bash Wrapper:
```bash
bash scripts/backup_db.sh
```

### Sample Output:
```text
============================================================
 NEXUS PostgreSQL Backup Utility
============================================================
 Timestamp:  2026-11-16T07:48:55.090987+00:00Z
 Database:   nexus_dev
 User:       nexus_dev
 Container:  nexus-postgres-1
 Target:     backups\nexus_backup_20261116_074855.sql.gz
------------------------------------------------------------
Executing pg_dump stream and compressing with gzip...
============================================================
 BACKUP COMPLETED SUCCESSFULLY
============================================================
 Archive:       backups\nexus_backup_20261116_074855.sql.gz
 Compressed:    27.72 KB (28,383 bytes)
 Raw SQL:       164.89 KB (168,848 bytes)
 SHA-256:       e57d97033e7cb4660cdbdb2c8a1a98718b7286a7303da3582aed8ed2b32c6459
 Checksum file: backups\nexus_backup_20261116_074855.sql.gz.sha256
------------------------------------------------------------
 Restore Command:
   python scripts/restore_db.py --file backups\nexus_backup_20261116_074855.sql.gz
============================================================
```

---

## 3. Verifying a Backup Archive

You can verify the cryptographic checksum and archive integrity without modifying any database:

```bash
python scripts/restore_db.py --file backups/nexus_backup_YYYYMMDD_HHMMSS.sql.gz --verify-only
```

Expected output:
```text
✓ SHA-256 Checksum verified: e57d97033e7cb466...
✓ Gzip stream decompression verified successfully.
✓ Backup verification complete (--verify-only specified). No restore performed.
```

---

## 4. Restoring a Database Backup

### Safety Confirmation Warning
When restoring, the utility warns the operator and requires typing `CONFIRM-RESTORE` to execute:

```bash
python scripts/restore_db.py --file backups/nexus_backup_YYYYMMDD_HHMMSS.sql.gz
```

Prompt:
```text
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 [SAFETY WARNING] DESTRUCTIVE OPERATION
 Restoring will DROP and OVERWRITE existing data in database 'nexus_dev'!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 Type 'CONFIRM-RESTORE' to execute the database restore: 
```

### Automated / Non-Interactive Restore:
In automated disaster recovery pipelines or CI environments, pass `--force` or `--yes` to bypass the prompt:
```bash
python scripts/restore_db.py --file backups/nexus_backup_YYYYMMDD_HHMMSS.sql.gz --force
```

### Safe Testing into a Staging/Test Database:
To test a restore without impacting your active database:
```bash
# 1. Create a temporary test database
docker exec nexus-postgres-1 psql -U nexus_dev -d nexus_dev -c "CREATE DATABASE nexus_test_restore;"

# 2. Restore into the test database
python scripts/restore_db.py --file backups/nexus_backup_YYYYMMDD_HHMMSS.sql.gz --db nexus_test_restore --force

# 3. Clean up temporary database when done
docker exec nexus-postgres-1 psql -U nexus_dev -d nexus_dev -c "DROP DATABASE nexus_test_restore;"
```

---

## 5. Automated Scheduling (Cron Job)

To schedule automated daily backups at 02:00 UTC on Linux/macOS:

```bash
crontab -e
```

Add the following entry:
```cron
0 2 * * * cd /opt/nexus && python3 scripts/backup_db.py --output-dir /var/backups/nexus >> /var/log/nexus_backup.log 2>&1
```

Retain backups for 30 days:
```cron
30 2 * * * find /var/backups/nexus -name "nexus_backup_*.sql.gz*" -mtime +30 -delete
```
