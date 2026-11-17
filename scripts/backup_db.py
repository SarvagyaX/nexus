#!/usr/bin/env python3
"""
NEXUS Production Database Backup Utility
Creates a timestamped, gzip-compressed PostgreSQL backup with SHA-256 checksum.
Compatible with Windows, Linux, macOS, and Dockerized environments.
"""

import argparse
import gzip
import hashlib
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_env_defaults() -> dict:
    """Extracts fallback credentials from .env if present."""
    defaults = {
        "POSTGRES_DB": "nexus_dev",
        "POSTGRES_USER": "nexus_dev",
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
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
    """Checks if a Nexus Postgres container is running."""
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


def run_backup(output_dir: str = "backups", container: str | None = None, db_name: str | None = None, user: str | None = None) -> Path:
    defaults = load_env_defaults()
    target_db = db_name or defaults["POSTGRES_DB"]
    target_user = user or defaults["POSTGRES_USER"]
    container_name = container or get_docker_postgres_container() or defaults["DOCKER_CONTAINER"]

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_filename = f"nexus_backup_{timestamp}.sql.gz"
    backup_filepath = out_path / backup_filename
    checksum_filepath = out_path / f"{backup_filename}.sha256"

    print("=" * 60)
    print(" NEXUS PostgreSQL Backup Utility")
    print("=" * 60)
    print(f" Timestamp:  {datetime.now(timezone.utc).isoformat()}Z")
    print(f" Database:   {target_db}")
    print(f" User:       {target_user}")
    print(f" Container:  {container_name}")
    print(f" Target:     {backup_filepath.resolve()}")
    print("-" * 60)

    # Command to run pg_dump inside container
    cmd = [
        "docker", "exec", "-i", container_name,
        "pg_dump", "-U", target_user, "-d", target_db,
        "--clean", "--if-exists", "--no-owner", "--no-privileges",
    ]

    print("Executing pg_dump stream and compressing with gzip...")
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        print("ERROR: 'docker' CLI not found on system PATH. Please ensure Docker is installed and running.")
        sys.exit(1)

    total_uncompressed_bytes = 0

    with gzip.open(backup_filepath, "wb") as gz_out:
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            gz_out.write(chunk)
            total_uncompressed_bytes += len(chunk)

    _, stderr = proc.communicate()

    if proc.returncode != 0:
        error_msg = stderr.decode("utf-8", errors="replace")
        print(f"ERROR: pg_dump failed with exit code {proc.returncode}:\n{error_msg}")
        if backup_filepath.exists():
            backup_filepath.unlink()
        sys.exit(proc.returncode)

    # Compute SHA-256 of the created archive file
    sha256 = hashlib.sha256()
    with open(backup_filepath, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)

    compressed_size = backup_filepath.stat().st_size
    checksum_hex = sha256.hexdigest()

    # Write sha256 checksum file
    with open(checksum_filepath, "w", encoding="utf-8") as f:
        f.write(f"{checksum_hex}  {backup_filename}\n")

    print("=" * 60)
    print(" BACKUP COMPLETED SUCCESSFULLY")
    print("=" * 60)
    print(f" Archive:       {backup_filepath}")
    print(f" Compressed:    {compressed_size / 1024:.2f} KB ({compressed_size:,} bytes)")
    print(f" Raw SQL:       {total_uncompressed_bytes / 1024:.2f} KB ({total_uncompressed_bytes:,} bytes)")
    print(f" SHA-256:       {checksum_hex}")
    print(f" Checksum file: {checksum_filepath}")
    print("-" * 60)
    print(" Restore Command:")
    print(f"   python scripts/restore_db.py --file {backup_filepath}")
    print("=" * 60)

    return backup_filepath


def main():
    parser = argparse.ArgumentParser(description="NEXUS PostgreSQL Database Backup Utility")
    parser.add_argument("--output-dir", default="backups", help="Directory where backup files are saved (default: backups)")
    parser.add_argument("--container", default=None, help="Name of Docker PostgreSQL container (auto-detected if omitted)")
    parser.add_argument("--db", default=None, help="Database name (default: from .env or nexus_dev)")
    parser.add_argument("--user", default=None, help="PostgreSQL user (default: from .env or nexus_dev)")
    args = parser.parse_args()

    run_backup(output_dir=args.output_dir, container=args.container, db_name=args.db, user=args.user)


if __name__ == "__main__":
    main()
