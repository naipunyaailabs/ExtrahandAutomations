"""Pricing agent: price rules, the evidence checks on what the LLM reads, the list API, and a whole run
with search, pages and the LLM replaced."""

import asyncio
import json
import re
import sys
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app import auth
from app.models import Ticket
from pricing import agent, llm
from pricing.agent import GIVE_UP_AFTER_EMPTY_QUERIES
from pricing.extract import PRICE_SYSTEM, RATING_SYSTEM, Source, mention_excerpts, validate_prices, validate_rating
from pricing.maps import Place, best_match, parse_results_csv
from pricing.reader import PageReader, html_to_text, price_excerpt, public_http_url
from pricing.rules import StrategyValues, compute_price, demand_level, one_value_per_competitor, round_price, sentiment_level
from pricing.search import SearchResult, SearchUnavailable, ddgs_text, searxng_search, web_search
from pricing.tables import AreaReport, Observation, Rating, Recommendation, Run, pricing_session, reset_pricing_db


@pytest.fixture
def pdb(db):
    """Empty pricing tables (and, through `db`, empty app tables)."""
    reset_pricing_db()
    yield


# ---- rules -------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [(1763, 1749), (1780, 1799), (1424.05, 1399), (120, 99), (87, 90), (3, 10)])
def test_round_price(raw, expected):
    assert round_price(raw) == expected


def test_price_is_set_from_the_competitor_median_and_adjustments():
    r = compute_price([1000, 1200, 1400, 1600], basis="area", strategy=StrategyValues(-5, 5, 5), demand="high", sentiment="weak")
    assert r.market_median == 1300 and r.market_low == 1150 and r.market_high == 1450
    assert [a["pct"] for a in r.adjustments] == [-5, 5, 5]
    assert r.price == round_price(1300 * 1.05) == 1349
    assert r.confidence == "high"


def test_outliers_are_dropped_and_city_basis_caps_confidence():
    r = compute_price([1000, 1100, 1200, 1300, 9000], basis="city", strategy=StrategyValues(0, 0, 0), demand="normal", sentiment="neutral")
    assert r.price_count == 4 and r.market_median == 1150
    assert r.confidence == "medium"


def test_min_and_max_price_clamp():
    s = StrategyValues(-50, 0, 0)
    assert compute_price([1000], basis="area", strategy=s, demand="unknown", sentiment="unknown", min_price=800).price == 800
    assert compute_price([1000], basis="area", strategy=StrategyValues(50, 0, 0), demand="unknown", sentiment="unknown", max_price=1200).price == 1200


def test_no_prices_means_no_data():
    assert compute_price([], basis="area", strategy=StrategyValues(), demand="high", sentiment="weak").status == "no_data"


def test_demand_and_sentiment_levels():
    assert demand_level(6, [6, 0]) == "high"
    assert demand_level(0, [6, 0]) == "low"
    assert demand_level(3, [3, 3]) == "normal"
    assert demand_level(2, [2, 1]) == "unknown"  # too few tasks to tell
    assert sentiment_level([(4.6, None, 800), (4.5, 0.2, 400)]) == ("strong", 4.56)
    assert sentiment_level([(3.5, None, 300)]) == ("weak", 3.5)
    assert sentiment_level([(2.2, None, 8), (4.7, None, 3000)]) == ("strong", 4.66)  # 8 reviews do not outvote 3,000
    assert sentiment_level([(2.2, None, None), (4.7, None, None)]) == ("unknown", 3.45)  # no counts: nothing to go on
    assert sentiment_level([(4.9, None, 55)]) == ("unknown", 4.9)  # 55 reviews are too few to move a price
    assert sentiment_level([(None, -0.5)]) == ("weak", None)
    assert sentiment_level([]) == ("unknown", None)


# ---- evidence checks ---------------------------------------------------------------------------

SOURCES = [
    Source(url="https://www.urbancompany.com/hyderabad-cleaning", title="UC", text="Full home deep cleaning ₹1,499 for 2BHK. Sofa cleaning ₹499."),
    Source(url="https://sparkle.example/", title="Sparkle", text="Sparkle Cleaners: 2BHK deep clean Rs. 1,800 - 2,200"),
]


def test_prices_without_a_real_quote_are_rejected():
    reply = {"prices": [
        {"source": 0, "competitor": "UrbanCompany", "price_min": 1499, "matches_service": True, "quote": "deep cleaning ₹1,499 for 2BHK"},
        {"source": 1, "competitor": "Sparkle Cleaners", "price_min": 1800, "price_max": 2200, "matches_service": True, "quote": "2BHK deep clean Rs. 1,800 - 2,200"},
        {"source": 0, "competitor": "Urban Company", "price_min": 999, "matches_service": True, "quote": "deep cleaning ₹999"},  # not on the page
        {"source": 0, "competitor": "Urban Company", "price_min": 1599, "matches_service": True, "quote": "deep cleaning ₹1,499 for 2BHK"},  # wrong number
        {"source": 0, "competitor": "Urban Company", "price_min": 499, "matches_service": False, "quote": "Sofa cleaning ₹499"},  # other service
        {"source": 7, "competitor": "X", "price_min": 100, "matches_service": True, "quote": "x"},  # no such source
    ]}
    kept = validate_prices(reply, SOURCES, ["Urban Company", "Housejoy"])
    assert [(k["competitor"], k["listed"], k["price_min"], k["price_max"]) for k in kept] == [
        ("Urban Company", True, 1499, None),
        ("Sparkle Cleaners", False, 1800, 2200),
    ]
    assert kept[0]["source_url"] == SOURCES[0].url and "1,499" in kept[0]["evidence"]


def test_ratings_need_a_quote_from_the_text():
    texts = ["Housejoy: Rated 4.2 out of 5 from 3,410 reviews. Staff were late twice."]
    ok = validate_rating({"rating": 4.2, "review_count": 3410, "rating_quote": "Rated 4.2 out of 5 from 3,410 reviews",
                          "sentiment": 0.1, "summary": "Mixed."}, texts)
    assert (ok["rating"], ok["review_count"], ok["sentiment"]) == (4.2, 3410, 0.1)
    made_up = validate_rating({"rating": 4.9, "rating_quote": "Rated 4.9", "sentiment": 3}, texts)
    assert made_up["rating"] is None and made_up["sentiment"] == 1.0


# ---- tools -------------------------------------------------------------------------------------

def test_page_text_is_trimmed_to_price_mentions():
    title, text = html_to_text("<html><title>Cleaning</title><script>var p='₹1';</script><p>Intro words.</p><p>Deep clean ₹1,499</p></html>")
    assert title == "Cleaning" and "var p" not in text
    assert "₹1,499" in price_excerpt(text)
    assert price_excerpt("no prices here at all") == ""


def test_maps_csv_is_parsed_and_matched_by_name():
    csv_text = (
        "title,review_rating,review_count,user_reviews,link\n"
        'Urban Company Madhapur,4.7,"1,234","[{""Description"": ""Very punctual""}]",https://maps/1\n'
        "Urban Company Office,4.1,12,[],https://maps/2\n"
    )
    places = parse_results_csv(csv_text)
    assert places[0] == Place(title="Urban Company Madhapur", rating=4.7, review_count=1234, reviews=["Very punctual"], url="https://maps/1")
    assert best_match(places, "urban company").review_count == 1234
    assert best_match(places, "Housejoy") is None


# ---- list API ----------------------------------------------------------------------------------

def test_list_endpoints(client, pdb):
    a = client.post("/api/pricing/areas", json={"city": "hyderabad", "area": "madhapur", "pincode": "500081"})
    assert a.status_code == 201 and a.json()["city"] == "Hyderabad" and a.json()["area"] == "Madhapur"
    assert client.post("/api/pricing/areas", json={"city": "Hyderabad", "area": "Madhapur"}).status_code == 409

    s = client.post("/api/pricing/services", json={"name": "House Cleaning", "scope": "Deep clean of a 2BHK", "unit": "per visit"}).json()
    assert s["slug"] == "house-cleaning" and s["keywords"] == ["house cleaning", "cleaning"]
    assert client.put(f"/api/pricing/services/{s['id']}", json={"name": "Home Cleaning", "min_price": 900, "max_price": 500}).status_code == 422
    edited = client.put(f"/api/pricing/services/{s['id']}", json={"name": "Home Cleaning", "keywords": ["Cleaning"]}).json()
    assert edited["slug"] == "house-cleaning" and edited["keywords"] == ["cleaning"]

    c = client.post("/api/pricing/competitors", json={"name": "Urban Company", "website": "https://www.urbancompany.com"}).json()
    assert client.get("/api/pricing/competitors").json()[0]["name"] == "Urban Company"
    assert client.delete(f"/api/pricing/competitors/{c['id']}").status_code == 204
    assert client.get("/api/pricing/competitors").json() == []

    assert client.get("/api/pricing/strategy").json()["position_pct"] == -5
    saved = client.put("/api/pricing/strategy", json={"position_pct": 0, "demand_adjust_pct": 10, "sentiment_adjust_pct": 0,
                                                       "demand_window_days": 30, "refresh_days": 14}).json()
    assert saved["demand_adjust_pct"] == 10 and client.get("/api/pricing/strategy").json()["refresh_days"] == 14

    st = client.get("/api/pricing/status").json()
    assert st["counts"] == {"areas": 1, "services": 1, "competitors": 0, "priced": 0}
    assert st["search_engine"] == "ddgs" and st["running"] is None


def test_a_second_run_is_refused_while_one_is_going(client, pdb):
    with pricing_session() as db:
        db.add(Run(status="running"))
    assert client.post("/api/pricing/runs").status_code == 409


# ---- a whole run -------------------------------------------------------------------------------

PAGES = {
    "https://uc.example/hyd": "Urban Company Home Cleaning Hyderabad. Full home deep cleaning ₹1,499 for 2BHK.",
    "https://hj.example/clean": "Housejoy deep cleaning packages from Rs 1,299 onwards in Madhapur.",
    "https://sparkle.example/": "Sparkle Cleaners Madhapur: 2BHK deep clean ₹1,800 - ₹2,200",
}


async def fake_search(query):
    if "reviews" in query:
        name = query.split(" reviews")[0]
        return [SearchResult(url="https://reviews.example/x", title="Reviews", snippet=f"{name}: Rated 4.6 out of 5 by 1,200 customers")]
    if "Madhapur" in query:
        return [SearchResult(url=u, title="", snippet="") for u in PAGES]
    return []


class FakeReader:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def read(self, url):
        return "Page", PAGES.get(url, "")


async def no_maps(keywords):
    return None


async def fake_chat(prompt, *, system, json_mode, temperature=0.1, timeout=60.0):
    """Reads the prices like a well-behaved model, plus one made-up price the checks must drop."""
    if system == PRICE_SYSTEM:
        prices = []
        for m in re.finditer(r"\[(\d+)\] [^\n]*\nURL: (\S+)\n(.*?)(?=\n\n\[\d+\] |\Z)", prompt, re.S):
            idx, text = int(m.group(1)), m.group(3)
            pm = re.search(r"((?:₹|Rs )([\d,]+)(?: - ₹([\d,]+))?)", text)
            prices.append({"source": idx, "competitor": " ".join(text.split()[:2]), "price_min": float(pm.group(2).replace(",", "")),
                           "price_max": float(pm.group(3).replace(",", "")) if pm.group(3) else None, "unit": "per job",
                           "matches_service": True, "quote": pm.group(1)})
        prices.append({"source": 0, "competitor": "Ghost", "price_min": 99, "matches_service": True, "quote": "only ₹99 today"})
        return {"prices": prices}
    if system == RATING_SYSTEM:
        return {"rating": 4.6, "review_count": 1200, "rating_quote": "Rated 4.6 out of 5 by 1,200 customers", "sentiment": 0.5, "summary": "Punctual."}
    return None  # the analysis falls back to the template


@pytest.fixture
def listed(client, pdb, db, settings, monkeypatch):
    """The team's list is filled in and recent cleaning tasks exist; no run has happened yet."""
    settings(openrouter_api_key="test-key")
    monkeypatch.setattr(llm, "chat", fake_chat)
    for area in ("Madhapur", "Gachibowli"):
        client.post("/api/pricing/areas", json={"city": "Hyderabad", "area": area})
    client.post("/api/pricing/services", json={"name": "House Cleaning", "scope": "Deep clean of a 2BHK"})
    for name in ("Urban Company", "Housejoy"):
        client.post("/api/pricing/competitors", json={"name": name})
    for i in range(6):  # all the recent cleaning demand is in Madhapur
        db.add(Ticket(id=f"t{i}", title="Deep cleaning", category="cleaning", city="Hyderabad", address=f"Flat {i}, Madhapur"))
    db.commit()


@pytest.fixture
def seeded(listed):
    with pricing_session() as s:
        run = Run()
        s.add(run)
        s.flush()
        run_id = run.id
    asyncio.run(agent.run_pricing(run_id, search=fake_search, reader_factory=FakeReader, maps=no_maps))
    return run_id


def test_a_run_prices_each_area_and_keeps_only_quoted_prices(client, seeded):
    run = client.get(f"/api/pricing/runs/{seeded}").json()
    assert run["status"] == "done", run["error"]
    assert run["message"] == "Priced 2 of 2 service–area pairs" and run["done_steps"] == run["total_steps"]

    with pricing_session() as db:
        obs = db.scalars(select(Observation)).all()
        assert sorted((o.competitor, o.listed, o.price_min) for o in obs) == [
            ("Housejoy", True, 1299), ("Sparkle Cleaners", False, 1800), ("Urban Company", True, 1499),
        ]  # the made-up ₹99 is gone
        assert db.scalar(select(AreaReport).where(AreaReport.area == "Madhapur")).summary.startswith("- **House Cleaning**: ExtraHand")

    recs = {r["area"]: r for r in client.get("/api/pricing/recommendations").json()}
    mad, gach = recs["Madhapur"], recs["Gachibowli"]
    # median 1,499; -5% position, +5% high demand, -5% for highly rated (4.6) competitors
    assert (mad["price"], mad["basis"], mad["demand_level"], mad["sentiment_level"], mad["confidence"]) == (1399, "area", "high", "strong", "medium")
    # no prices of its own: the city's, with low demand
    assert (gach["price"], gach["basis"], gach["demand_level"]) == (1249, "city", "low")
    assert "city-wide prices were used" in gach["reasoning"]

    detail = client.get(f"/api/pricing/recommendations/{gach['id']}").json()
    assert len(detail["evidence"]) == 3 and detail["ratings"][0]["rating"] == 4.6


def test_public_price_api(client, seeded, settings):
    r = client.get("/api/pricing/v1/price", params={"service": "house-cleaning", "city": "hyderabad", "area": "madhapur"})
    assert r.status_code == 200 and r.json()["price"] == 1399 and r.json()["basis"] == "area"
    # an area not on the list: the median of the city's area prices
    other = client.get("/api/pricing/v1/price", params={"service": "House Cleaning", "city": "Hyderabad", "area": "Kondapur"}).json()
    assert (other["price"], other["basis"], other["confidence"], other["area"]) == (1299, "city", "low", "Kondapur")
    assert client.get("/api/pricing/v1/price", params={"service": "plumbing", "city": "Hyderabad"}).status_code == 404
    assert len(client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}).json()) == 2

    settings(pricing_api_key="app-team-key")
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}).status_code == 401
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}, headers={"X-API-Key": "app-team-key"}).status_code == 200


def test_a_later_run_replaces_the_current_prices(client, seeded):
    with pricing_session() as s:
        run = Run()
        s.add(run)
        s.flush()
        second = run.id
    asyncio.run(agent.run_pricing(second, search=fake_search, reader_factory=FakeReader, maps=no_maps))
    with pricing_session() as db:
        current = db.scalars(select(Recommendation).where(Recommendation.is_current)).all()
    assert {r.run_id for r in current} == {second} and len(current) == 2


def test_a_run_without_an_llm_key_fails_with_a_reason(client, pdb, settings):
    settings(openrouter_api_key="")
    with pricing_session() as s:
        run = Run()
        s.add(run)
        s.flush()
        run_id = run.id
    asyncio.run(agent.run_pricing(run_id, search=fake_search, reader_factory=FakeReader, maps=no_maps))
    run = client.get(f"/api/pricing/runs/{run_id}").json()
    assert run["status"] == "failed" and "OPENROUTER_API_KEY" in run["error"]


# ---- production: login gate, API key, and what the page reader may fetch ----------------------------

def test_app_price_lookups_skip_the_dashboard_login_but_the_rest_of_pricing_needs_it(client, seeded, settings):
    users = [{"email": "ops@extrahand.in", "name": "Ops", "role": "Dispatcher", "password_hash": auth.hash_password("pw")}]
    settings(dashboard_users=json.dumps(users), session_secret="s" * 40, pricing_api_key="app-team-key")
    for path in ("/api/pricing/areas", "/api/pricing/recommendations", "/api/pricing/status", "/api/pricing/strategy"):
        assert client.get(path).status_code == 401, path
    assert client.post("/api/pricing/runs").status_code == 401
    assert client.delete("/api/pricing/areas/1").status_code == 401

    price = {"service": "house-cleaning", "city": "Hyderabad", "area": "Madhapur"}
    assert client.get("/api/pricing/v1/price", params=price).status_code == 401  # the key, not a login, is asked for
    assert "X-API-Key" in client.get("/api/pricing/v1/price", params=price).json()["detail"]
    ok = client.get("/api/pricing/v1/price", params=price, headers={"X-API-Key": "app-team-key"})
    assert ok.status_code == 200 and ok.json()["price"] == 1399


@pytest.mark.parametrize("key", ["", "CHANGE_ME"])
def test_production_serves_no_prices_until_an_api_key_is_set(client, seeded, settings, key):
    settings(app_env="production", pricing_api_key=key)
    r = client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"})
    assert r.status_code == 503 and "PRICING_API_KEY" in r.json()["detail"]
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}, headers={"X-API-Key": key}).status_code == 503
    settings(pricing_api_key="app-team-key")
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}, headers={"X-API-Key": "app-team-key"}).status_code == 200
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}, headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}, headers={"X-API-Key": "ключ".encode()}).status_code == 401  # raw non-ASCII bytes


@pytest.mark.parametrize("url,expected", [
    ("https://93.184.216.34/prices", True),
    ("http://127.0.0.1:1433/", False),
    ("http://localhost:8888/search", False),
    ("http://10.0.0.5/", False),
    ("http://192.168.1.1/", False),
    ("http://169.254.169.254/latest/meta-data/", False),  # cloud metadata
    ("http://[::1]/", False),
    ("file:///etc/passwd", False),
    ("ftp://93.184.216.34/", False),
    ("not a url", False),
])
def test_the_page_reader_only_fetches_public_addresses(url, expected):
    assert public_http_url(url) is expected


def test_a_redirect_into_the_servers_own_network_is_not_followed():
    fetched = []

    def handler(request):
        fetched.append(str(request.url))
        if request.url.host == "93.184.216.34":
            return httpx.Response(302, headers={"Location": "http://127.0.0.1:8888/secret"})
        return httpx.Response(200, html="<p>internal ₹1</p>")

    async def read(url):
        async with PageReader(mode="http", transport=httpx.MockTransport(handler)) as r:
            return await r.read(url)

    assert asyncio.run(read("https://93.184.216.34/start")) == ("", "")
    assert fetched == ["https://93.184.216.34/start"]


def test_a_public_redirect_is_followed_and_a_huge_page_is_cut_short():
    def handler(request):
        if request.url.path == "/old":
            return httpx.Response(301, headers={"Location": "https://93.184.216.34/new"})
        page = "<title>T</title><p>Deep clean ₹1,499</p>".encode()
        return httpx.Response(200, headers={"content-type": "text/html"}, content=page + b"x" * 5_000_000)

    async def read(url):
        async with PageReader(mode="http", transport=httpx.MockTransport(handler)) as r:
            return await r.read(url)

    title, text = asyncio.run(read("https://93.184.216.34/old"))
    assert title == "T" and "₹1,499" in text and len(text) < 2_100_000


def test_every_time_the_api_returns_is_marked_utc(client, seeded):
    # a browser reads an ISO time without a zone as local time, which showed the run as hours old
    run = client.get(f"/api/pricing/runs/{seeded}").json()
    rec = client.get("/api/pricing/recommendations").json()[0]
    report = client.get("/api/pricing/reports").json()[0]
    public = client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}).json()[0]
    status = client.get("/api/pricing/status").json()
    for value in (run["started_at"], run["finished_at"], rec["updated_at"], report["updated_at"], public["updated_at"],
                  status["next_run_due"], status["last_run"]["finished_at"]):
        assert value.endswith("Z"), value


# ---- search engines refusing us ----------------------------------------------------------------

ROWS = [{"title": "Deep Cleaning in Hyderabad", "href": "https://example.com/clean", "body": "2BHK deep clean from ₹2,999"}]


def fake_ddgs(monkeypatch, script):
    """A stand-in `ddgs`: script maps an engine to its replies, one per attempt (rows, or an exception to raise)."""
    calls = []

    class FakeDDGS:
        def __init__(self, timeout=None):
            pass

        def text(self, query, region=None, max_results=None, backend=None):
            calls.append(backend)
            replies = script.get(backend, [])
            reply = replies.pop(0) if replies else []
            if isinstance(reply, Exception):
                raise reply
            if not reply:
                raise RuntimeError("No results found.")
            return reply

    monkeypatch.setitem(sys.modules, "ddgs", SimpleNamespace(DDGS=FakeDDGS))
    return calls


def test_ddgs_retries_an_engine_that_fails_at_random(monkeypatch):
    calls = fake_ddgs(monkeypatch, {"yahoo": [RuntimeError("timeout"), [], ROWS]})
    found = ddgs_text("deep cleaning", 5, ["yahoo", "brave"], 3, pause=0)
    assert [(r.url, r.title, r.snippet) for r in found] == [("https://example.com/clean", "Deep Cleaning in Hyderabad", "2BHK deep clean from ₹2,999")]
    assert calls == ["yahoo", "yahoo", "yahoo"]


def test_ddgs_falls_back_to_the_next_engine_and_gives_up_when_all_fail(monkeypatch):
    calls = fake_ddgs(monkeypatch, {"brave": [ROWS]})
    assert len(ddgs_text("q", 5, ["yahoo", "brave"], 2, pause=0)) == 1
    assert calls == ["yahoo", "yahoo", "brave"]
    calls = fake_ddgs(monkeypatch, {})
    assert ddgs_text("q", 5, ["yahoo", "brave"], 2, pause=0) == []
    assert calls == ["yahoo", "yahoo", "brave", "brave"]
    fake_ddgs(monkeypatch, {"yahoo": [[{"title": "x", "href": "javascript:void(0)", "body": ""}]]})
    assert ddgs_text("q", 5, ["yahoo"], 1, pause=0) == []  # rows that are not web addresses are dropped


def test_web_search_uses_the_configured_engines_and_says_when_ddgs_is_missing(monkeypatch, settings):
    settings(pricing_search_engines="brave, startpage", pricing_search_attempts=1, searxng_url="")
    calls = fake_ddgs(monkeypatch, {"startpage": [ROWS]})
    assert len(asyncio.run(web_search("q"))) == 1 and calls == ["brave", "startpage"]
    monkeypatch.setitem(sys.modules, "ddgs", None)  # what `import ddgs` does when the package is not installed
    with pytest.raises(SearchUnavailable, match="pip install"):
        asyncio.run(web_search("q"))


def test_searxng_results_are_mapped_and_a_refusal_is_reported():
    body = {"results": [{"url": "https://a.example/x", "title": "A", "content": "from ₹1,499"}, {"title": "no address"}]}
    ok = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    found = asyncio.run(searxng_search("http://127.0.0.1:8888", "q", 5, transport=ok))
    assert [(r.url, r.snippet) for r in found] == [("https://a.example/x", "from ₹1,499")]
    refused = httpx.MockTransport(lambda request: httpx.Response(403))
    with pytest.raises(SearchUnavailable, match="search.formats"):
        asyncio.run(searxng_search("http://127.0.0.1:8888", "q", 5, transport=refused))


def _another_run() -> int:
    with pricing_session() as s:
        run = Run()
        s.add(run)
        s.flush()
        return run.id


def test_a_run_whose_searches_find_nothing_fails_with_a_reason_and_the_old_prices_stay(client, seeded):
    asked = []

    async def nothing(query):
        asked.append(query)
        return []

    second = _another_run()
    asyncio.run(agent.run_pricing(second, search=nothing, reader_factory=FakeReader, maps=no_maps))
    run = client.get(f"/api/pricing/runs/{second}").json()
    assert run["status"] == "failed" and "returned nothing" in run["error"] and "SEARXNG_URL" in run["error"]
    assert len(asked) == GIVE_UP_AFTER_EMPTY_QUERIES  # it stops once that many in a row found nothing
    assert {r["run_id"] for r in client.get("/api/pricing/recommendations").json()} == {seeded}  # still the first run's prices


def test_a_search_that_cannot_work_stops_the_run_with_its_message(client, seeded):
    async def blocked(query):
        raise SearchUnavailable("SearXNG answered 403.")

    second = _another_run()
    asyncio.run(agent.run_pricing(second, search=blocked, reader_factory=FakeReader, maps=no_maps))
    run = client.get(f"/api/pricing/runs/{second}").json()
    assert run["status"] == "failed" and "SearXNG answered 403" in run["error"]
    assert {r["run_id"] for r in client.get("/api/pricing/recommendations").json()} == {seeded}


def test_a_price_a_page_states_twice_counts_once():
    src = [Source(url="https://qwikyo.example/guide", title="Guide", text="Typically ₹3,500–₹5,500. A 2BHK deep clean ₹3,500–₹5,500 as well.")]
    rows = [{"source": 0, "competitor": "Qwikyo", "price_min": 3500, "price_max": 5500, "matches_service": True, "quote": q}
            for q in ("Typically ₹3,500–₹5,500", "2BHK deep clean ₹3,500–₹5,500")]
    assert len(validate_prices({"prices": rows}, src, [])) == 1


def test_ratings_are_read_only_from_text_that_names_the_competitor():
    other = "Anshitha Cleaning: 4.8 rated on Google · 500+ verified reviews. " * 3
    about = "x" * 800 + " Urban Company is rated 4.1 out of 5 by 2,300 customers. " + "y" * 800
    assert mention_excerpts("Urban Company", [other]) == []
    excerpts = mention_excerpts("urban  company", [other, about])
    assert len(excerpts) == 1 and "4.1 out of 5" in excerpts[0] and "4.8" not in excerpts[0] and len(excerpts[0]) < 1200
    assert mention_excerpts("  ", [about]) == []


def test_a_rating_on_a_page_about_another_business_is_not_credited_to_the_competitor(client, listed):
    async def other_business(query):
        if "reviews" in query:
            return [SearchResult(url="https://other.example/", title="Anshitha", snippet="Anshitha Cleaning: Rated 4.6 out of 5 by 1,200 customers")]
        return await fake_search(query)

    run_id = _another_run()
    asyncio.run(agent.run_pricing(run_id, search=other_business, reader_factory=FakeReader, maps=no_maps))
    assert client.get(f"/api/pricing/runs/{run_id}").json()["status"] == "done"
    with pricing_session() as db:
        assert db.scalars(select(Rating)).all() == []


# ---- the model refusing us ---------------------------------------------------------------------

def test_openrouter_replies_are_capped_and_a_refusal_is_reported(settings):
    settings(openrouter_api_key="k", pricing_llm_models="m1")
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        if len(seen) == 1:
            return httpx.Response(200, json={"choices": [{"message": {"content": '```json\n{"a": 1}\n```'}}]})
        if len(seen) == 2:
            return httpx.Response(402, json={"error": {"message": "This request requires more credits, or fewer max_tokens."}})
        return httpx.Response(503)

    t = httpx.MockTransport(handler)
    assert asyncio.run(llm.chat("p", system="s", json_mode=True, transport=t)) == {"a": 1}
    assert seen[0]["max_tokens"] == llm.MAX_TOKENS_JSON  # uncapped, OpenRouter reserves 65,535 tokens of credit
    with pytest.raises(llm.LLMUnavailable, match=r"\(402\).*more credits"):
        asyncio.run(llm.chat("p", system="s", json_mode=False, transport=t))
    assert seen[1]["max_tokens"] == llm.MAX_TOKENS_TEXT
    assert asyncio.run(llm.chat("p", system="s", json_mode=False, transport=t)) is None  # a server error is just a miss


def test_a_run_fails_with_the_reason_when_openrouter_refuses(client, listed, monkeypatch):
    async def refused(prompt, **kw):
        raise llm.LLMUnavailable("OpenRouter refused the request (402): out of credit")

    monkeypatch.setattr(llm, "chat", refused)
    run_id = _another_run()
    asyncio.run(agent.run_pricing(run_id, search=fake_search, reader_factory=FakeReader, maps=no_maps))
    run = client.get(f"/api/pricing/runs/{run_id}").json()
    assert run["status"] == "failed" and "out of credit" in run["error"]


def test_prices_are_kept_when_only_the_written_analysis_is_refused(client, listed, monkeypatch):
    async def credit_runs_out_at_the_end(prompt, *, system, json_mode, temperature=0.1, timeout=60.0):
        if system in (PRICE_SYSTEM, RATING_SYSTEM):
            return await fake_chat(prompt, system=system, json_mode=json_mode)
        raise llm.LLMUnavailable("out of credit")

    monkeypatch.setattr(llm, "chat", credit_runs_out_at_the_end)
    run_id = _another_run()
    asyncio.run(agent.run_pricing(run_id, search=fake_search, reader_factory=FakeReader, maps=no_maps))
    assert client.get(f"/api/pricing/runs/{run_id}").json()["status"] == "done"
    assert [r["price"] for r in client.get("/api/pricing/recommendations").json()] == [1249, 1399]  # Gachibowli, Madhapur
    assert client.get("/api/pricing/reports").json()[0]["summary"].startswith("- **House Cleaning**: ExtraHand")


def test_a_competitor_counts_once_however_many_prices_it_lists():
    rows = [("NoBroker", 100.0), ("nobroker", 200.0), ("No Broker", 300.0), ("Urban Company", 150.0)]
    assert sorted(one_value_per_competitor(rows)) == [150.0, 200.0]
    # and confidence follows the number of competitors: 14 rows from one site are still one competitor
    values = one_value_per_competitor([("NoBroker", float(90 + i)) for i in range(14)])
    assert compute_price(values, basis="area", strategy=StrategyValues(0, 0, 0), demand="unknown", sentiment="unknown").confidence == "low"


def test_a_rating_from_employee_reviews_is_not_a_customer_rating():
    texts = ["Urban Company: 3.4 out of 5 based on 1,100 employee reviews on AmbitionBox"]
    reply = {"rating": 3.4, "review_count": 1100, "rating_quote": "3.4 out of 5 based on 1,100 employee reviews",
             "sentiment": 0.2, "summary": "Employees rate Urban Company 3.4."}
    out = validate_rating(reply, texts)
    assert out == {"rating": None, "review_count": None, "sentiment": None, "summary": None}


# ---- addresses that become links ---------------------------------------------------------------

@pytest.mark.parametrize("website", ["javascript:alert(1)", "javascript://example.com/%0aalert(1)", "ftp://files.example.com",
                                     "data:text/html,<script>alert(1)</script>", "https://javascript:alert(1)", "localhost", "https://"])
def test_a_competitor_website_must_be_a_real_web_address(client, pdb, website):
    assert client.post("/api/pricing/competitors", json={"name": "Bad", "website": website}).status_code == 422
    assert client.get("/api/pricing/competitors").json() == []


def test_a_competitor_website_is_tidied_up(client, pdb):
    made = client.post("/api/pricing/competitors", json={"name": "A", "website": "  www.urbancompany.com/hyderabad "}).json()
    assert made["website"] == "https://www.urbancompany.com/hyderabad"
    assert client.post("/api/pricing/competitors", json={"name": "B", "website": "  "}).json()["website"] is None
    other = client.post("/api/pricing/competitors", json={"name": "C"}).json()
    assert client.put(f"/api/pricing/competitors/{other['id']}", json={"name": "C", "website": "javascript:alert(1)"}).status_code == 422


def test_search_results_that_are_not_web_addresses_are_dropped(monkeypatch):
    body = {"results": [{"url": "javascript:alert(1)", "title": "x", "content": ""}, {"url": "file:///etc/passwd", "title": "y", "content": ""},
                        {"url": "httpx://nope.example", "title": "z", "content": ""}, {"url": "https://ok.example/p", "title": "ok", "content": "₹1"}]}
    found = asyncio.run(searxng_search("http://127.0.0.1:8888", "q", 5, transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))))
    assert [r.url for r in found] == ["https://ok.example/p"]
    fake_ddgs(monkeypatch, {"yahoo": [[{"title": "x", "href": "javascript:alert(1)", "body": ""}, {"title": "y", "href": "http://a.example", "body": ""}]]})
    assert [r.url for r in ddgs_text("q", 5, ["yahoo"], 1, pause=0)] == ["http://a.example"]


# ---- free models, tried in turn ----------------------------------------------------------------

def _answers(by_model, seen):
    """A fake OpenRouter: by_model maps a model to (status, body) or a list of them used in turn."""
    def handler(request):
        model = json.loads(request.content)["model"]
        seen.append(model)
        reply = by_model[model]
        status, body = reply.pop(0) if isinstance(reply, list) else reply
        return httpx.Response(status, json=body)
    return httpx.MockTransport(handler)


def _said(text):
    return (200, {"choices": [{"message": {"content": text}}]})


def test_the_free_models_are_the_default_and_are_tried_in_order(settings):
    s = settings(openrouter_api_key="k")
    assert llm.models_to_try() == s.pricing_llm_models.split(",") and len(llm.models_to_try()) >= 3
    assert all(m.endswith(":free") for m in llm.models_to_try())  # nothing here costs money
    assert settings(pricing_llm_models="").openrouter_model in llm.models_to_try()  # empty: the one model of the marketing agent


def test_a_model_that_is_busy_gone_or_unclear_is_skipped(settings):
    settings(openrouter_api_key="k", pricing_llm_models="busy,gone,mumbles,slow,good")
    seen = []
    t = _answers({"busy": (429, {"error": {"message": "Provider returned error"}}),
                  "gone": (404, {"error": {"message": "No endpoints found for gone"}}),
                  "mumbles": _said("I could not find any prices."),  # not JSON
                  "slow": (503, {}), "good": _said('{"ok": true}')}, seen)
    assert asyncio.run(llm.chat("p", system="s", json_mode=True, transport=t)) == {"ok": True}
    assert seen == ["busy", "gone", "mumbles", "slow", "good"]


def test_every_model_busy_waits_once_then_gives_the_reason(settings, monkeypatch):
    settings(openrouter_api_key="k", pricing_llm_models="a,b")
    monkeypatch.setattr(llm, "RETRY_PAUSE", 0)
    seen = []
    busy = (429, {"error": {"message": "Provider returned error"}})
    t = _answers({"a": [busy, busy], "b": [busy, busy]}, seen)
    with pytest.raises(llm.LLMUnavailable, match=r"\(429\)"):
        asyncio.run(llm.chat("p", system="s", json_mode=True, transport=t))
    assert seen == ["a", "b", "a", "b"]  # a second pass, then stop
    # ... and a model that is only busy for a moment is used on the second pass
    seen.clear()
    t = _answers({"a": [busy, _said('{"n": 2}')], "b": [busy]}, seen)
    assert asyncio.run(llm.chat("p", system="s", json_mode=True, transport=t)) == {"n": 2}


def test_the_daily_free_allowance_running_out_stops_at_once(settings, monkeypatch):
    settings(openrouter_api_key="k", pricing_llm_models="a,b")
    monkeypatch.setattr(llm, "RETRY_PAUSE", 0)
    seen = []
    t = _answers({"a": (429, {"error": {"message": "Rate limit exceeded: free-models-per-day"}}), "b": _said("{}")}, seen)
    with pytest.raises(llm.LLMUnavailable, match="daily allowance"):
        asyncio.run(llm.chat("p", system="s", json_mode=True, transport=t))
    assert seen == ["a"]  # the other models share the same allowance


def test_models_that_are_all_retired_or_blocked_by_privacy_settings_are_reported(settings):
    settings(openrouter_api_key="k", pricing_llm_models="a,b")
    gone = (404, {"error": {"message": "No endpoints found matching your data policy (Free model publication)."}})
    with pytest.raises(llm.LLMUnavailable, match="data policy"):
        asyncio.run(llm.chat("p", system="s", json_mode=True, transport=_answers({"a": gone, "b": gone}, [])))
    # mumbling from every model is an ordinary miss, not a reason to stop the run
    assert asyncio.run(llm.chat("p", system="s", json_mode=True, transport=_answers({"a": _said("hm"), "b": _said("")}, []))) is None
