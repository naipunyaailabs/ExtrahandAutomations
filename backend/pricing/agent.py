"""One pricing run: research every area and service on the list, then set prices and write the analysis.

Research (search -> read pages -> LLM reads prices) is saved as it goes; prices and reports replace the
previous run's only once the whole run has finished, so the public API never serves a half-done run."""

import asyncio
import logging

from sqlalchemy import select, update

from app.config import get_settings
from app.models import utcnow

from . import llm
from .demand import task_counts
from .extract import (
    PRICE_SYSTEM, RATING_SYSTEM, Source, analysis_prompt, mention_excerpts, price_prompt, rating_prompt, validate_prices,
    validate_rating,
)
from .maps import best_match, maps_places
from .reader import PageReader, price_excerpt
from .rules import (
    StrategyValues, compute_price, demand_level, explain, observation_value, one_value_per_competitor, rupees,
    sentiment_level,
)
from .search import web_search
from .tables import (
    Area, AreaReport, Competitor, Observation, Rating, Recommendation, Run, Service, Strategy, pricing_session,
)

logger = logging.getLogger("pricing.agent")

_tasks: set[asyncio.Task] = set()


GIVE_UP_AFTER_EMPTY_QUERIES = 6


class RunBusy(Exception):
    pass


def nothing_found_message(queries: int) -> str:
    return (f"Web search returned nothing for any of {queries} queries, so no prices were read. The search engines may be "
            "blocking this server: run SearXNG (deploy/pricing-tools) and set SEARXNG_URL.")


def get_strategy(db) -> Strategy:
    s = db.get(Strategy, 1)
    if s is None:
        s = Strategy(id=1)
        db.add(s)
        db.flush()
    return s


def place_name(area: dict) -> str:
    return f"{area['area']}, {area['city']}" if area["area"] else area["city"]


def start_run(trigger: str = "manual", **deps) -> int:
    """Creates the run and starts it in the background. Raises RunBusy while another run is going."""
    with pricing_session() as db:
        if db.scalar(select(Run.id).where(Run.status == "running")):
            raise RunBusy("A pricing run is already in progress.")
        run = Run(trigger=trigger, message="Starting")
        db.add(run)
        db.flush()
        run_id = run.id
    task = asyncio.get_running_loop().create_task(run_pricing(run_id, **deps))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return run_id


def fail_interrupted_runs() -> None:
    """At startup: a run still 'running' was cut off by a restart."""
    with pricing_session() as db:
        db.execute(
            update(Run).where(Run.status == "running")
            .values(status="failed", error="Interrupted by a server restart.", finished_at=utcnow())
        )


def _progress(run_id: int, message: str, step: bool = True) -> None:
    with pricing_session() as db:
        run = db.get(Run, run_id)
        run.message = message[:500]
        if step:
            run.done_steps += 1


async def _search_sources(queries: list[str], reader, search, max_pages: int) -> list[Source]:
    """Pages (trimmed to their price mentions) for the queries; search snippets stand in for unread pages."""
    seen, results = set(), []
    for q in queries:
        for r in await search(q):
            if r.url not in seen:
                seen.add(r.url)
                results.append(r)
    sources = []
    for i, r in enumerate(results):
        text = ""
        if i < max_pages:
            title, page = await reader.read(r.url)
            text = price_excerpt(page)
            r.title = r.title or title
        if not text:
            text = price_excerpt(r.snippet)
        if text:
            sources.append(Source(url=r.url, title=r.title, text=text))
    return sources


async def research_prices(area: dict, service: dict, competitors: list[dict], reader, search, max_pages: int) -> list[dict]:
    place = place_name(area)
    queries = [f"{service['name']} price in {place}", f"{service['name']} charges {area['city']}"]
    for c in competitors:
        queries.append(f"{c['name']} {service['name']} price {area['city']}")
        if c.get("website"):
            domain = c["website"].split("//")[-1].split("/")[0]
            queries.append(f"site:{domain} {service['name']} {area['city']}")
    sources = await _search_sources(list(dict.fromkeys(queries)), reader, search, max_pages)
    if not sources:
        return []
    names = [c["name"] for c in competitors]
    reply = await llm.chat(
        price_prompt(service=service["name"], scope=service["scope"], unit=service["unit"], place=place,
                     competitors=names, sources=sources),
        system=PRICE_SYSTEM, json_mode=True,
    )
    return validate_prices(reply, sources, names)


async def research_ratings(area: dict, competitors: list[dict], reader, search, maps) -> list[dict]:
    place = place_name(area)
    places = await maps([f"{c['name']} {place}" for c in competitors]) if competitors else None
    out = []
    for c in competitors:
        hit = best_match(places or [], c["name"])
        if hit and hit.rating is not None:
            row = {"rating": hit.rating, "review_count": hit.review_count, "sentiment": None, "summary": None,
                   "source": "google_maps", "source_url": hit.url}
            if hit.reviews:
                reply = await llm.chat(rating_prompt(competitor=c["name"], place=place, texts=hit.reviews, with_stars=False),
                                       system=RATING_SYSTEM, json_mode=True)
                checked = validate_rating(reply, hit.reviews)
                row["sentiment"], row["summary"] = checked["sentiment"], checked["summary"]
        else:
            results = await search(f"{c['name']} reviews {area['city']}")
            texts = mention_excerpts(c["name"], [f"{r.title}: {r.snippet}" for r in results if r.snippet])
            for r in results[:3]:
                _, page = await reader.read(r.url)
                texts += mention_excerpts(c["name"], [page])
            if not texts:
                continue
            reply = await llm.chat(rating_prompt(competitor=c["name"], place=place, texts=texts, with_stars=True),
                                   system=RATING_SYSTEM, json_mode=True)
            row = validate_rating(reply, texts) | {"source": "web", "source_url": results[0].url if results else None}
            if row["rating"] is None and row["sentiment"] is None:
                continue
        out.append(row | {"competitor": c["name"]})
    return out


def _snapshot(db):
    areas = [dict(id=a.id, city=a.city, area=a.area or "", pincode=a.pincode)
             for a in db.scalars(select(Area).where(Area.active).order_by(Area.city, Area.area))]
    services = [dict(id=s.id, name=s.name, slug=s.slug, scope=s.scope, unit=s.unit, keywords=s.keywords or [],
                     min_price=s.min_price, max_price=s.max_price)
                for s in db.scalars(select(Service).where(Service.active).order_by(Service.name))]
    competitors = [dict(id=c.id, name=c.name, website=c.website)
                   for c in db.scalars(select(Competitor).where(Competitor.active).order_by(Competitor.name))]
    st = get_strategy(db)
    strategy = StrategyValues(st.position_pct, st.demand_adjust_pct, st.sentiment_adjust_pct)
    return areas, services, competitors, strategy, st.demand_window_days


async def run_pricing(run_id: int, *, search=web_search, reader_factory=PageReader, maps=maps_places) -> None:
    try:
        if not llm.llm_configured():
            raise RuntimeError("OPENROUTER_API_KEY is not set, so the agent cannot read competitor pages.")
        with pricing_session() as db:
            areas, services, competitors, strategy, window = _snapshot(db)
            if not areas or not services:
                raise RuntimeError("Add at least one area and one service on the Setup page first.")
            db.get(Run, run_id).total_steps = len(areas) * (len(services) + 1) + 1
        max_pages = get_settings().pricing_max_pages_per_service

        found = {"queries": 0, "results": 0}

        async def counted_search(query):
            results = await search(query)
            found["queries"] += 1
            found["results"] += len(results)
            if found["queries"] >= GIVE_UP_AFTER_EMPTY_QUERIES and not found["results"]:
                raise RuntimeError(nothing_found_message(found["queries"]))  # don't spend the whole run confirming it
            return results

        async with reader_factory() as reader:
            for area in areas:
                place = place_name(area)
                _progress(run_id, f"Checking competitor ratings in {place}", step=False)
                ratings = await research_ratings(area, competitors, reader, counted_search, maps)
                with pricing_session() as db:
                    db.add_all(Rating(run_id=run_id, area_id=area["id"], **r) for r in ratings)
                _progress(run_id, f"Ratings done for {place}")
                for service in services:
                    _progress(run_id, f"Researching {service['name']} prices in {place}", step=False)
                    prices = await research_prices(area, service, competitors, reader, counted_search, max_pages)
                    with pricing_session() as db:
                        db.add_all(Observation(run_id=run_id, area_id=area["id"], service_id=service["id"], **o) for o in prices)
                    _progress(run_id, f"{len(prices)} prices for {service['name']} in {place}")


        if found["queries"] and not found["results"]:
            raise RuntimeError(nothing_found_message(found["queries"]))

        _progress(run_id, "Setting prices and writing the analysis", step=False)
        priced = await asyncio.to_thread(_set_prices, run_id, areas, services, strategy, window)
        await _write_reports(run_id, areas, services)
        with pricing_session() as db:
            db.execute(update(Recommendation).where(Recommendation.is_current, Recommendation.run_id != run_id).values(is_current=False))
            db.execute(update(Recommendation).where(Recommendation.run_id == run_id).values(is_current=True))
            db.execute(update(AreaReport).where(AreaReport.is_current, AreaReport.run_id != run_id).values(is_current=False))
            db.execute(update(AreaReport).where(AreaReport.run_id == run_id).values(is_current=True))
            run = db.get(Run, run_id)
            run.status, run.finished_at, run.done_steps = "done", utcnow(), run.total_steps
            run.message = f"Priced {priced} of {len(areas) * len(services)} service–area pairs"
    except Exception as exc:
        logger.exception("[Pricing] run %s failed", run_id)
        with pricing_session() as db:
            run = db.get(Run, run_id)
            run.status, run.finished_at, run.error = "failed", utcnow(), str(exc)[:2000]


def _set_prices(run_id: int, areas: list[dict], services: list[dict], strategy: StrategyValues, window: int) -> int:
    counts = task_counts(areas, services, window)
    with pricing_session() as db:
        obs = db.scalars(select(Observation).where(Observation.run_id == run_id)).all()
        ratings = db.scalars(select(Rating).where(Rating.run_id == run_id)).all()
        city_of = {a["id"]: a["city"].lower() for a in areas}
        priced = 0
        for s in services:
            all_counts = [counts.get((a["id"], s["id"]), 0) for a in areas]
            for a in areas:
                rows = [(o.competitor, observation_value(o.price_min, o.price_max)) for o in obs
                        if o.area_id == a["id"] and o.service_id == s["id"]]
                basis = "area"
                if not rows:
                    basis = "city"
                    rows = [(o.competitor, observation_value(o.price_min, o.price_max)) for o in obs
                            if o.service_id == s["id"] and city_of.get(o.area_id) == a["city"].lower()]
                values = one_value_per_competitor(rows)
                n_tasks = counts.get((a["id"], s["id"]), 0)
                demand = demand_level(n_tasks, all_counts)
                sentiment, avg_rating = sentiment_level([(r.rating, r.sentiment, r.review_count) for r in ratings if r.area_id == a["id"]])
                result = compute_price(values, basis=basis, strategy=strategy, demand=demand, sentiment=sentiment,
                                       min_price=s["min_price"], max_price=s["max_price"])
                priced += result.status == "priced"
                db.add(Recommendation(
                    run_id=run_id, area_id=a["id"], service_id=s["id"], city=a["city"], area=a["area"],
                    service_slug=s["slug"], service_name=s["name"], unit=s["unit"],
                    status=result.status, price=result.price, market_median=result.market_median,
                    market_low=result.market_low, market_high=result.market_high, price_count=result.price_count,
                    basis=basis if result.status == "priced" else "area", demand_level=demand, demand_tasks=n_tasks,
                    sentiment_level=sentiment, competitor_rating=avg_rating, confidence=result.confidence,
                    adjustments=result.adjustments,
                    reasoning=explain(result, service=s["name"], unit=s["unit"], place=place_name(a), basis=basis),
                ))
    return priced


def _template_report(place: str, recs: list[Recommendation], ratings: list[Rating]) -> str:
    lines = []
    for r in recs:
        if r.status == "priced":
            lines.append(f"- **{r.service_name}**: ExtraHand {rupees(r.price)} vs market {rupees(r.market_low)}–{rupees(r.market_high)} "
                         f"(median {rupees(r.market_median)}, from {r.price_count} competitor{'s' if r.price_count != 1 else ''}, {r.confidence} confidence).")
        else:
            lines.append(f"- **{r.service_name}**: no competitor prices found.")
    rated = [r for r in ratings if r.rating is not None]
    if rated:
        lines += ["", "Competitor ratings: " + ", ".join(f"{r.competitor} {r.rating:g}★" for r in rated) + "."]
    return "\n".join(lines)


def _whole(value):
    return None if value is None else round(value)


async def _write_reports(run_id: int, areas: list[dict], services: list[dict]) -> None:
    for a in areas:
        place = place_name(a)
        with pricing_session() as db:
            recs = db.scalars(select(Recommendation).where(Recommendation.run_id == run_id, Recommendation.area_id == a["id"])).all()
            ratings = db.scalars(select(Rating).where(Rating.run_id == run_id, Rating.area_id == a["id"])).all()
            obs = db.scalars(select(Observation).where(Observation.run_id == run_id, Observation.area_id == a["id"])).all()
        names = {s["id"]: s["name"] for s in services}
        data = {
            "services": [
                {"service": r.service_name, "unit": r.unit, "recommended_price_for_extrahand": r.price,
                 "market_low": _whole(r.market_low), "market_median": _whole(r.market_median), "market_high": _whole(r.market_high), "competitors_priced": r.price_count,
                 "confidence": r.confidence, "demand": r.demand_level, "based_on": r.basis}
                for r in recs
            ],
            "competitor_prices": [
                {"competitor": o.competitor, "service": names.get(o.service_id), "price_min": o.price_min, "price_max": o.price_max}
                for o in obs
            ],
            "competitor_ratings": [
                {"competitor": r.competitor, "rating": r.rating, "reviews": r.review_count, "sentiment": r.sentiment, "summary": r.summary}
                for r in ratings
            ],
        }
        try:
            summary = await llm.chat(analysis_prompt(place, data), system="You write concise, factual pricing analysis.",
                                     json_mode=False, temperature=0.3)
        except llm.LLMUnavailable:
            summary = None  # the prices are already set by rules; a plain summary stands in for the written one
        with pricing_session() as db:
            db.add(AreaReport(run_id=run_id, area_id=a["id"], city=a["city"], area=a["area"],
                              summary=summary or _template_report(place, recs, ratings)))
        _progress(run_id, f"Analysis written for {place}", step=False)
    _progress(run_id, "Analysis done")

