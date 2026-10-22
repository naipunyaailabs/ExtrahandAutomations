"""Client for the ExtraHand APIs described in Doc/data.docx."""

import logging
import threading
from typing import Any, Protocol

import httpx

from ..config import get_settings
from .mapping import extract_list, extract_obj, has_next_page

log = logging.getLogger(__name__)


class ExtraHandError(Exception):
    pass


class CandidatesUnavailable(ExtraHandError):
    """The Task Service matching route is not configured or not reachable."""


class ExtraHandSource(Protocol):
    mode: str

    def iter_tasks(self, max_pages: int = 50) -> list[dict]: ...
    def get_task(self, task_id: str) -> dict: ...
    def get_user(self, user_id: str) -> dict: ...
    def list_users(self, role: str, max_pages: int = 10) -> list[dict]: ...
    def search_helpers(self, q: str) -> list[dict]: ...
    def get_candidates(self, task_id: str, lat: float | None, lng: float | None, radius_km: float) -> list[dict]: ...
    def assign_helper(self, task_id: str, helper_uid: str, helper_profile_id: str | None, helper_name: str | None) -> dict: ...


class LiveExtraHandClient:
    mode = "live"
    page_size = 50

    def __init__(self) -> None:
        self.s = get_settings()
        self._token: str | None = None
        self._lock = threading.Lock()
        self._http = httpx.Client(timeout=30, headers={"Accept": "application/json"})

    # --- auth (doc section 2) -------------------------------------------------
    def _login(self) -> str:
        if not (self.s.extrahand_email and self.s.extrahand_password):
            raise ExtraHandError("EXTRAHAND_EMAIL / EXTRAHAND_PASSWORD are not set")
        r = self._http.post(
            f"{self.s.extrahand_main_base_url}/auth/login",
            json={
                "email": self.s.extrahand_email,
                "password": self.s.extrahand_password,
                "dashboardType": self.s.extrahand_dashboard_type,
            },
        )
        if r.status_code >= 400:
            raise ExtraHandError(f"Login failed ({r.status_code}): {r.text[:300]}")
        token = (((r.json() or {}).get("data") or {}).get("tokens") or {}).get("accessToken")
        if not token:
            raise ExtraHandError("Login response has no data.tokens.accessToken")
        return token

    def _token_value(self, refresh: bool = False) -> str:
        with self._lock:
            if refresh or not self._token:
                self._token = self._login()
            return self._token

    def _main(self, method: str, path: str, **kw) -> Any:
        url = f"{self.s.extrahand_main_base_url}{path}"
        for attempt in range(2):
            headers = {"Authorization": f"Bearer {self._token_value(refresh=attempt > 0)}"}
            r = self._http.request(method, url, headers=headers, **kw)
            if r.status_code == 401 and attempt == 0:
                continue
            if r.status_code >= 400:
                raise ExtraHandError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
            return r.json()
        raise ExtraHandError(f"{method} {path} unauthorized")

    def _paged(self, path: str, params: dict, max_pages: int) -> list[dict]:
        out: list[dict] = []
        for page in range(1, max_pages + 1):
            resp = self._main("GET", path, params={**params, "page": page, "limit": self.page_size})
            items = extract_list(resp)
            out.extend(items)
            if not items or not has_next_page(resp, page, len(items), self.page_size):
                break
        return out

    # --- reads ------------------------------------------------------------------
    def iter_tasks(self, max_pages: int = 50) -> list[dict]:  # section 3
        params = {"postedBy": self.s.extrahand_posted_by} if self.s.extrahand_posted_by else {}
        return self._paged("/tasks", params, max_pages)

    def get_task(self, task_id: str) -> dict:  # section 4
        return extract_obj(self._main("GET", f"/tasks/{task_id}"))

    def get_user(self, user_id: str) -> dict:  # section 6
        return extract_obj(self._main("GET", f"/users/{user_id}"))

    def list_users(self, role: str, max_pages: int = 10) -> list[dict]:  # sections 5 and 7
        return self._paged("/users", {"role": role}, max_pages)

    def search_helpers(self, q: str) -> list[dict]:  # section 8
        return extract_list(self._main("GET", "/users/helpers/search", params={"q": q}))

    def get_candidates(self, task_id: str, lat: float | None, lng: float | None, radius_km: float) -> list[dict]:
        # Section 9: Task Service route that needs internal service auth
        if not self.s.extrahand_service_auth:
            raise CandidatesUnavailable("EXTRAHAND_SERVICE_AUTH not configured")
        params: dict[str, Any] = {"radiusKm": radius_km}
        if lat is not None and lng is not None:
            params.update(lat=lat, lng=lng)
        headers = {"X-Service-Auth": self.s.extrahand_service_auth}
        if self.s.extrahand_service_user_id:
            headers["X-User-Id"] = self.s.extrahand_service_user_id
        try:
            r = self._http.get(
                f"{self.s.extrahand_task_base_url}/api/v1/matches/tasks/{task_id}/candidates",
                params=params,
                headers=headers,
            )
        except httpx.HTTPError as e:
            raise CandidatesUnavailable(str(e)) from e
        if r.status_code >= 400:
            raise CandidatesUnavailable(f"candidates -> {r.status_code}: {r.text[:200]}")
        return extract_list(r.json())

    # --- write (section 10) -----------------------------------------------------
    def assign_helper(self, task_id: str, helper_uid: str, helper_profile_id: str | None, helper_name: str | None) -> dict:
        body = {"helperUid": helper_uid, "helperProfileId": helper_profile_id, "helperName": helper_name}
        return self._main("POST", f"/tasks/{task_id}/assign", json={k: v for k, v in body.items() if v})


_client: ExtraHandSource | None = None


def get_source() -> ExtraHandSource:
    global _client
    if _client is None:
        if get_settings().extrahand_mode == "live":
            _client = LiveExtraHandClient()
        else:
            from .mock_extrahand import MockExtraHand

            _client = MockExtraHand()
    return _client
