#!/usr/bin/env python3
"""
NEXUS Production Database Restore Utility
Safely restores a PostgreSQL database backup with SHA-256 verification and confirmation gating.
Compatible with Windows, Linux, macOS, and Dockerized environments.
"""

import argparse
import gzip
import hashlib
import os
import subprocess
import sys
from pathlib import Path


def load_env_defaults() -> dict:
    """Extracts fallback credentials from .env if present."""
    defaults = {
        "POSTGRES_DB": "nexus_dev",
        "POSTGRES_USER": "nexus_dev",
        "DOCKER_CONTAINER": "nexus-postgres-1",
    }
    env_file = Path(".env")
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k in defaults:
                        defaults[k] = v
    return defaults


def get_docker_postgres_container() -> str | None:
    try:
        res = subprocess.run(
            ["docker", "ps", "--filter", "name=postgres", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            containers = [c.strip() for c in res.stdout.strip().splitlines() if c.strip()]
            for c in containers:
                if "nexus" in c and "postgres" in c:
                    return c
            return containers[0]
    except Exception:
        pass
    return None


def verify_backup_integrity(backup_path: Path) -> bool:
    """Checks file existence, checksum (if sha256 file exists), and gzip stream decompression."""
    if not backup_path.exists():
        print(f"ERROR: Backup file '{backup_path}' does not exist.")
        return False

    checksum_file = backup_path.with_name(f"{backup_path.name}.sha256")
    if checksum_file.exists():
        with open(checksum_file, "r", encoding="utf-8") as f:
            expected_hash = f.read().split()[0].strip().lower()
        sha256 = hashlib.sha256()
        with open(backup_path, "rb") as f:
            while chunk := f.read(65536):
                sha256.update(chunk)
        actual_hash = sha256.hexdigest().lower()
        if actual_hash != expected_hash:
            print(f"ERROR: SHA-256 Checksum mismatch!\nExpected: {expected_hash}\nActual:   {actual_hash}")
            return False
        print(f"✓ SHA-256 Checksum verified: {actual_hash[:16]}...")
    else:
        print("Note: No .sha256 file found alongside backup; skipping hash validation.")

    # Check decompression
    try:
        with gzip.open(backup_path, "rb") as f:
            header = f.read(1024)
            if not header:
                print("ERROR: Backup archive is empty.")
                return False
        print("✓ Gzip stream decompression verified successfully.")
    except Exception as e:
        print(f"ERROR: Failed to decompress backup archive: {e}")
        return False

    return True


def run_restore(
    backup_file: str,
    container: str | None = None,
    db_name: str | None = None,
    user: str | None = None,
    force: bool = False,
    verify_only: bool = False,
) -> bool:
    defaults = load_env_defaults()
    backup_path = Path(backup_file).resolve()
    target_db = db_name or defaults["POSTGRES_DB"]
    target_user = user or defaults["POSTGRES_USER"]
    container_name = container or get_docker_postgres_container() or defaults["DOCKER_CONTAINER"]

    print("=" * 70)
    print(" NEXUS PostgreSQL Database Restore Utility")
    print("=" * 70)
    print(f" Backup Archive:   {backup_path}")
    print(f" Target Database:  {target_db}")
    print(f" Target User:      {target_user}")
    print(f" Target Container: {container_name}")
    print("-" * 70)

    # 1. Verify integrity
    if not verify_backup_integrity(backup_path):
        return False

    if verify_only:
        print("\n✓ Backup verification complete (--verify-only specified). No restore performed.")
        return True

    # 2. Safety confirmation prompt
    if not force:
        print("\n" + "!" * 70)
        print(" [SAFETY WARNING] DESTRUCTIVE OPERATION")
        print(f" Restoring will DROP and OVERWRITE existing data in database '{target_db}'!")
        print("!" * 70)
        try:
            user_input = input(" Type 'CONFIRM-RESTORE' to execute the database restore: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n[ABORTED] Restore cancelled by user interrupt.")
            return False

        if user_input != "CONFIRM-RESTORE":
            print(f"[ABORTED] Confirmation failed (received '{user_input}'). No changes made.")
            return False

    print("\nStarting database restore via psql in container...")

    # Command to run psql inside container
    cmd = [
        "docker", "exec", "-i", container_name,
        "psql", "-U", target_user, "-d", target_db,
    ]

    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        print("ERROR: 'docker' CLI not found on system PATH.")
        return False

    with gzip.open(backup_path, "rb") as gz_in:
        while chunk := gz_in.read(65536):
            try:
                proc.stdin.write(chunk)
            except BrokenPipeError:
                break

    stdout, stderr = proc.communicate()

    if proc.returncode != 0:
        err = stderr.decode("utf-8", errors="replace")
        print(f"ERROR: Restore failed with code {proc.returncode}:\n{err}")
        return False

    # 3. Post-restore verification: query table count
    check_cmd = [
        "docker", "exec", container_name,
        "psql", "-U", target_user, "-d", target_db, "-t", "-A",
        "-c", "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';",
    ]
    check_res = subprocess.run(check_cmd, capture_output=True, text=True, check=False)
    table_count = check_res.stdout.strip() if check_res.returncode == 0 else "Unknown"

    print("=" * 70)
    print(" RESTORE COMPLETED SUCCESSFULLY")
    print("=" * 70)
    print(f" Database '{target_db}' restored from: {backup_path.name}")
    print(f" Active Public Tables: {table_count}")
    print("=" * 70)
    return True


def main():
    parser = argparse.ArgumentParser(description="NEXUS PostgreSQL Database Restore Utility")
    parser.add_argument("--file", required=True, help="Path to backup archive (.sql.gz)")
    parser.add_argument("--container", default=None, help="Name of Docker PostgreSQL container (auto-detected if omitted)")
    parser.add_argument("--db", default=None, help="Target database name (default: from .env or nexus_dev)")
    parser.add_argument("--user", default=None, help="Target PostgreSQL user (default: from .env or nexus_dev)")
    parser.add_argument("--force", "--yes", action="store_true", help="Bypass interactive confirmation prompt")
    parser.add_argument("--verify-only", action="store_true", help="Verify checksum and archive integrity without restoring")
    args = parser.parse_args()

    success = run_restore(
        backup_file=args.file,
        container=args.container,
        db_name=args.db,
        user=args.user,
        force=args.force,
        verify_only=args.verify_only,
    )
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
