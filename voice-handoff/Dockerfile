# syntax=docker/dockerfile:1
# The IVR hand-off voice agent image, deployed to LiveKit Cloud (separate from the backend image).
ARG PYTHON_VERSION=3.12
FROM python:${PYTHON_VERSION}-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

ARG UID=10001
RUN adduser --disabled-password --gecos "" --home /app --uid "${UID}" appuser

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=appuser:appuser *.py ./

USER appuser
# The turn detector loads its models with local_files_only=True, so they must be in the image.
ENV HF_HOME=/app/.cache/huggingface XDG_CACHE_HOME=/app/.cache
RUN mkdir -p /app/.cache && python agent.py download-files
# Secrets (SARVAM_API_KEY, OPENROUTER_API_KEY, BACKEND_BASE_URL) come from the LiveKit Cloud agent environment,
# never from the image. The worker refuses to start without them.
CMD ["python", "agent.py", "start"]
