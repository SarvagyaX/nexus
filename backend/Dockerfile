FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BACKEND_PORT=8000

WORKDIR /app

# Install security updates and curl for container health checks
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged system user and group (UID/GID 10001)
RUN groupadd -g 10001 nexus \
    && useradd -u 10001 -g nexus -s /sbin/nologin -M nexus

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files and entrypoint
COPY app ./app
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Configure execution permissions and directory ownership
RUN chmod +x ./docker-entrypoint.sh \
    && chown -R nexus:nexus /app

USER nexus:nexus

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
    CMD curl -f http://127.0.0.1:8000/api/v1/health/liveness || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
