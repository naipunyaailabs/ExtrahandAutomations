# ExtraHand Intelligence Platform: Backend Service
# Runs FastAPI, autonomous dispatch engine, telephony, Meta WhatsApp & pricing engine.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    PORT=5074 \
    IVR_AUDIO_DIR=/audio \
    MARKETING_POSTERS_DIR=/data/posters \
    WHATSAPP_BANNERS_DIR=/data/whatsapp_banners \
    TZ=Asia/Kolkata

# India time: Advertisement and festival schedules align with IST
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install python dependencies first (cached across code edits)
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

# Copy backend source code
COPY backend/ ./

# Copy branding assets for poster generator
COPY frontend/public /app/frontend/public

# Run as non-privileged service user
RUN useradd --system --uid 10001 --create-home extrahand \
    && mkdir -p /audio /data/posters /data/whatsapp_banners \
    && chown -R extrahand:extrahand /audio /data /app/backend

USER extrahand
VOLUME ["/audio", "/data"]

EXPOSE 5074

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5074/api/health', timeout=4).status == 200 else 1)"

# Single worker protects the in-memory dispatch lock and IVR state
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5074", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
