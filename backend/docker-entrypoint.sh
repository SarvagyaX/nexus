#!/bin/sh
set -e

# If RUN_MIGRATIONS is true, automatically run Alembic migrations on startup
if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "[NEXUS Startup] Applying Alembic database migrations..."
    alembic upgrade head
    echo "[NEXUS Startup] Migrations completed successfully."
fi

exec "$@"
