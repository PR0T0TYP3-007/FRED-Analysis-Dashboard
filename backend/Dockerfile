# syntax=docker/dockerfile:1
FROM python:3.13-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so the layer caches across code changes.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Run as a non-root user; nothing here needs elevated privileges.
RUN useradd --create-home --uid 10001 ledger && chown -R ledger:ledger /app
USER ledger

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
