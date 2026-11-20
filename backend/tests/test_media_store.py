"""Posters and WhatsApp banners: one storage layer (Azure Blob or local folders) behind the app's own addresses."""

from app.services import media_store


def test_choice_of_storage(settings):
    settings(media_storage="auto", azure_storage_connection_string="")
    assert media_store.backend() == "local"
    settings(media_storage="auto", azure_storage_connection_string="DefaultEndpointsProtocol=https;AccountName=x")
    assert media_store.backend() == "azure"
    settings(media_storage="local", azure_storage_connection_string="DefaultEndpointsProtocol=https;AccountName=x")
    assert media_store.backend() == "local"


def test_local_files_put_get_list_delete(settings, tmp_path):
    settings(media_storage="local", marketing_posters_dir=str(tmp_path / "p"), whatsapp_banners_dir=str(tmp_path / "b"))
    media_store.put("posters", "ev1.jpg", b"jpg", "image/jpeg")
    media_store.put("posters/art", "ev1-v1.png", b"png", "image/png")
    assert media_store.get("posters", "ev1.jpg") == b"jpg" and media_store.exists("posters", "ev1.jpg")
    assert media_store.names("posters") == ["ev1.jpg"]  # art is its own kind
    assert media_store.get("posters", "../secret") is None and media_store.get("posters", "missing.jpg") is None
    assert media_store.delete_prefix("posters", "ev1.") == 1 and media_store.get("posters", "ev1.jpg") is None


def test_banner_upload_is_served_by_the_app(client, settings, tmp_path, monkeypatch):
    settings(media_storage="local", whatsapp_banners_dir=str(tmp_path / "b"))
    from whatsapp.meta_client import MetaWhatsAppClient

    async def no_meta(self, *a, **k):
        return None

    monkeypatch.setattr(MetaWhatsAppClient, "upload_media", no_meta)
    r = client.post("/api/whatsapp/upload-banner", files={"file": ("diwali.png", b"\x89PNGdata", "image/png")})
    assert r.status_code == 200, r.text
    name = r.json()["filename"]
    assert media_store.get("whatsapp_banners", name) == b"\x89PNGdata"
    got = client.get(f"/api/whatsapp/banners/{name}")
    assert got.status_code == 200 and got.content == b"\x89PNGdata" and got.headers["content-type"] == "image/png"
    assert client.get("/api/whatsapp/banners/nope.png").status_code == 404
