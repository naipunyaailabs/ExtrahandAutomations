import sip_meta

TOKEN = "ab12" * 10  # a 40-character hex token, as the backend issues
OTHER = "cd34" * 10


def test_reads_attempt_and_token_from_headers():
    assert sip_meta.read({"handoff.attempt": "12", "handoff.token": TOKEN}, None) == (12, TOKEN)
    assert sip_meta.read({"sip.h.x-vh-attempt": "12", "sip.h.x-vh-token": TOKEN}, None) == (12, TOKEN)
    assert sip_meta.read({"SIP.H.X-VH-ATTEMPT": "12", "SIP.H.X-VH-TOKEN": TOKEN}, None) == (12, TOKEN)


def test_reads_from_called_user_part():
    for called in (f"ivr-12-{TOKEN}", f"+ivr-12-{TOKEN}", f"sip:ivr-12-{TOKEN}@abc.sip.livekit.cloud"):
        assert sip_meta.read({}, called) == (12, TOKEN)


def test_headers_win_over_the_called_number():
    assert sip_meta.read({"handoff.attempt": "7", "handoff.token": TOKEN}, f"ivr-12-{OTHER}") == (7, TOKEN)


def test_incomplete_headers_fall_back_to_the_called_number():
    assert sip_meta.read({"handoff.attempt": "7"}, f"ivr-12-{TOKEN}") == (12, TOKEN)


def test_missing_meta_returns_none():
    for attrs, called in (
        ({}, None), ({}, ""), ({"handoff.attempt": "12"}, None), ({"handoff.token": TOKEN}, None),
        ({"handoff.attempt": "abc", "handoff.token": TOKEN}, None), ({"handoff.attempt": "12", "handoff.token": "short"}, None),
        ({}, "ivr-12-short"), ({}, "+919000000000"), ({}, f"ivr-x-{TOKEN}"),
    ):
        assert sip_meta.read(attrs, called) is None, (attrs, called)
