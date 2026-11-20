"""Where images live: festival posters and WhatsApp banners.

- Azure Blob Storage when AZURE_STORAGE_CONNECTION_STRING is set (MEDIA_STORAGE=auto, the default, or =azure).
  One private container (AZURE_STORAGE_CONTAINER); blobs are named "<kind>/<file name>", e.g. posters/diwali.jpg.
- Local folders otherwise (MARKETING_POSTERS_DIR, WHATSAPP_BANNERS_DIR).

The app keeps serving every image at its own address (/api/advestiment/events/<id>/poster,
/api/whatsapp/banners/<file>), so the dashboard and Meta never need the storage account: the container stays private.
Voice call audio is NOT stored here: it stays on the server's disk (app/services/tts_audio.py).
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from app.config import get_settings

log = logging.getLogger(__name__)

KINDS = ("posters", "posters/art", "whatsapp_banners")

_client_lock = threading.Lock()
_container = None  # azure ContainerClient, made once
_container_key: tuple[str, str] | None = None


def backend() -> str:
    """'azure' or 'local'."""
    s = get_settings()
    choice = (s.media_storage or "auto").strip().lower()
    if choice == "local":
        return "local"
    if choice == "azure" or s.azure_storage_connection_string.strip():
        return "azure"
    return "local"


# ---------------------------------------------------------------------------------------------- local folders

def _folder(kind: str) -> Path:
    s = get_settings()
    if kind == "posters":
        return Path(s.marketing_posters_dir)
    if kind == "posters/art":
        return Path(s.marketing_posters_dir) / "art"
    if kind == "whatsapp_banners":
        return Path(s.whatsapp_banners_dir)
    raise ValueError(f"unknown kind {kind}")


def _safe(name: str) -> str:
    clean = Path(name).name
    if not clean or clean != name or clean in (".", ".."):
        raise ValueError("bad file name")
    return clean


# ---------------------------------------------------------------------------------------------- azure

def _azure():
    global _container, _container_key
    s = get_settings()
    key = (s.azure_storage_connection_string.strip(), (s.azure_storage_container or "extrahand-media").strip())
    if not key[0]:
        raise RuntimeError("MEDIA_STORAGE=azure needs AZURE_STORAGE_CONNECTION_STRING in the backend .env.")
    with _client_lock:
        if _container is None or _container_key != key:
            from azure.core.exceptions import ResourceExistsError
            from azure.storage.blob import BlobServiceClient

            container = BlobServiceClient.from_connection_string(key[0]).get_container_client(key[1])
            try:
                container.create_container()  # private: no public access level
                log.info("Created the Azure Blob container %s", key[1])
            except ResourceExistsError:
                pass
            _container, _container_key = container, key
        return _container


def reset() -> None:
    """Forget the Azure client (tests, or after the settings change)."""
    global _container, _container_key
    with _client_lock:
        _container, _container_key = None, None


# ---------------------------------------------------------------------------------------------- the API

def put(kind: str, name: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    name = _safe(name)
    if backend() == "azure":
        from azure.storage.blob import ContentSettings

        _azure().upload_blob(f"{kind}/{name}", data, overwrite=True,
                             content_settings=ContentSettings(content_type=content_type))
        return
    folder = _folder(kind)
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / f"{name}.tmp"
    tmp.write_bytes(data)
    tmp.replace(folder / name)  # written whole, then renamed: never served half-written


def get(kind: str, name: str) -> bytes | None:
    """The file's bytes, or None when there is no such file."""
    try:
        name = _safe(name)
    except ValueError:
        return None
    if backend() == "azure":
        from azure.core.exceptions import ResourceNotFoundError

        try:
            return _azure().download_blob(f"{kind}/{name}").readall()
        except ResourceNotFoundError:
            return None
    path = _folder(kind) / name
    return path.read_bytes() if path.is_file() else None


def exists(kind: str, name: str) -> bool:
    try:
        name = _safe(name)
    except ValueError:
        return False
    if backend() == "azure":
        return _azure().get_blob_client(f"{kind}/{name}").exists()
    return (_folder(kind) / name).is_file()


def names(kind: str, prefix: str = "") -> list[str]:
    """File names of this kind that start with prefix (only directly under the kind, not its sub-kinds)."""
    if backend() == "azure":
        start = f"{kind}/{prefix}"
        out = []
        for b in _azure().list_blobs(name_starts_with=start):
            rest = b.name[len(kind) + 1:]
            if "/" not in rest:
                out.append(rest)
        return sorted(out)
    folder = _folder(kind)
    if not folder.is_dir():
        return []
    return sorted(p.name for p in folder.iterdir() if p.is_file() and p.name.startswith(prefix) and not p.name.endswith(".tmp"))


def delete(kind: str, name: str) -> bool:
    try:
        name = _safe(name)
    except ValueError:
        return False
    if backend() == "azure":
        from azure.core.exceptions import ResourceNotFoundError

        try:
            _azure().delete_blob(f"{kind}/{name}")
            return True
        except ResourceNotFoundError:
            return False
    path = _folder(kind) / name
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def delete_prefix(kind: str, prefix: str) -> int:
    removed = 0
    for n in names(kind, prefix):
        try:
            removed += delete(kind, n)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not delete %s/%s: %s", kind, n, exc)
    return removed


def media_type(name: str) -> str:
    ext = Path(name).suffix.lower()
    return {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext, "image/jpeg")
