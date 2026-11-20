"""How the voice agent talks to the backend: read a call's context, post what it learned."""

import asyncio
import logging

import httpx

logger = logging.getLogger("handoff.backend_client")

# The backend answered definitively; trying again cannot change its decision.
_NO_RETRY = (400, 401, 403, 404, 409, 422)


class BackendError(Exception):
    """The backend could not be reached, refused the request, or answered in an unusable way."""


class BackendClient:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None,
                 retry_delays: tuple[float, ...] = (0.5, 1.0)):
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=10.0, transport=transport)
        self._delays = retry_delays

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, token: str, attempts: int,
                       body: dict | None = None) -> httpx.Response | None:
        """Retries on network errors and 5xx. Returns the last response (None if the network never answered);
        a definitive 4xx is returned at once."""
        response = None
        for attempt in range(attempts):
            try:
                response = await self._http.request(method, path, json=body, headers={"X-Handoff-Token": token})
            except httpx.HTTPError as exc:
                logger.warning("%s %s attempt %s/%s failed: %s", method, path, attempt + 1, attempts, exc)
                response = None
            else:
                if response.status_code < 500 or response.status_code in _NO_RETRY:
                    return response
                logger.warning("%s %s returned %s (attempt %s/%s)", method, path, response.status_code, attempt + 1, attempts)
            if attempt + 1 < attempts:
                await asyncio.sleep(self._delays[min(attempt, len(self._delays) - 1)] if self._delays else 0)
        return response

    async def get_context(self, attempt_id: int, token: str) -> dict:
        """What the agent may know about the call. Raises BackendError if it cannot be read."""
        response = await self._request("GET", f"/api/handoff/{int(attempt_id)}/context", token, attempts=len(self._delays) + 1)
        if response is None:
            raise BackendError("the backend could not be reached")
        if response.status_code >= 400:
            raise BackendError(f"the backend refused the context request ({response.status_code})")
        try:
            data = response.json()
        except ValueError as exc:
            raise BackendError("the backend's context was not JSON") from exc
        if not isinstance(data, dict):
            raise BackendError("the backend's context was not an object")
        return data

    async def post_result(self, attempt_id: int, token: str, body: dict) -> bool:
        """Reports what the agent learned. True only when the backend accepted it (three tries)."""
        response = await self._request("POST", f"/api/handoff/{int(attempt_id)}/result", token, attempts=3, body=body)
        return response is not None and response.status_code < 400
