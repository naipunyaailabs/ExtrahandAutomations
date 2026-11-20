import asyncio
import json

import httpx
import pytest

from backend_client import BackendClient, BackendError

TOKEN = "ab12" * 10


def _run(handler, call):
    """Runs `call(client)` against a fake backend with no waiting between retries."""
    async def go():
        client = BackendClient("https://backend.test/", transport=httpx.MockTransport(handler), retry_delays=(0, 0))
        try:
            return await call(client)
        finally:
            await client.aclose()

    return asyncio.run(go())


def test_post_result_sends_token_and_retries():
    seen = []

    def handler(request):
        seen.append(request)
        if len(seen) == 1:
            return httpx.Response(503)
        if len(seen) == 2:
            raise httpx.ConnectError("down")
        return httpx.Response(200, json={"outcome": "declined"})

    assert _run(handler, lambda c: c.post_result(5, TOKEN, {"kind": "reminder"})) is True
    assert len(seen) == 3
    assert all(r.headers["X-Handoff-Token"] == TOKEN and str(r.url) == "https://backend.test/api/handoff/5/result" for r in seen)
    assert json.loads(seen[2].content) == {"kind": "reminder"}


@pytest.mark.parametrize("status", [403, 404, 409, 422])
def test_a_definitive_refusal_is_not_retried(status):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(status)

    assert _run(handler, lambda c: c.post_result(5, TOKEN, {})) is False
    assert len(seen) == 1


def test_post_result_gives_up_after_three_tries():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(500)

    assert _run(handler, lambda c: c.post_result(5, TOKEN, {})) is False
    assert len(seen) == 3


def test_get_context_returns_the_json_and_sends_the_token():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"attempt_id": 5, "purpose": "followup"})

    ctx = _run(handler, lambda c: c.get_context(5, TOKEN))
    assert ctx == {"attempt_id": 5, "purpose": "followup"}
    assert seen[0].headers["X-Handoff-Token"] == TOKEN and str(seen[0].url) == "https://backend.test/api/handoff/5/context"


@pytest.mark.parametrize("response", [httpx.Response(403), httpx.Response(409), httpx.Response(200, text="not json"),
                                      httpx.Response(200, json=["a list"])])
def test_get_context_raises_when_the_backend_refuses_or_answers_oddly(response):
    with pytest.raises(BackendError):
        _run(lambda request: response, lambda c: c.get_context(5, TOKEN))


def test_get_context_raises_when_the_backend_cannot_be_reached():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(BackendError):
        _run(handler, lambda c: c.get_context(5, TOKEN))
