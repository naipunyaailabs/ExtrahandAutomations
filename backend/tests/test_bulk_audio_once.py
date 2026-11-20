from types import SimpleNamespace

from app.api import bulk_calling
from app.services import tts_audio


def test_campaign_audio_is_made_once_for_all_members(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(tts_audio, "_dir", lambda: tmp_path)
    monkeypatch.setattr(tts_audio, "_synthesize", lambda text, source="ivr": calls.append(text) or b"RIFFwav")
    monkeypatch.setattr(bulk_calling, "get_settings", lambda: SimpleNamespace(sarvam_api_key="k"))

    paths = {bulk_calling.campaign_audio(7, "Hello members ") for _ in range(1000)}
    assert len(calls) == 1 and len(paths) == 1  # one Sarvam charge, one shared file
    assert bulk_calling.campaign_audio(7, "  Hello members") in paths  # whitespace doesn't remake it

    bulk_calling.campaign_audio(7, "New script")  # an edited script gets fresh audio
    assert len(calls) == 2
