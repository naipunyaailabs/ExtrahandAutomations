"""Turns competitor prices, local demand and competitor ratings into one price.

Plain arithmetic, so every number on the dashboard can be traced back; the LLM only reads pages."""

import math
import re
from dataclasses import dataclass, field
from statistics import mean, median


@dataclass
class StrategyValues:
    position_pct: float = -5.0
    demand_adjust_pct: float = 5.0
    sentiment_adjust_pct: float = 5.0


@dataclass
class PriceResult:
    status: str  # priced|no_data
    price: int | None = None
    market_median: float | None = None
    market_low: float | None = None
    market_high: float | None = None
    price_count: int = 0
    confidence: str = "low"
    adjustments: list[dict] = field(default_factory=list)


def observation_value(price_min: float, price_max: float | None) -> float:
    """A range counts as its midpoint; a single or 'starting at' price as itself."""
    if price_max and price_max > price_min:
        return (price_min + price_max) / 2
    return price_min


def one_value_per_competitor(rows: list[tuple[str, float]]) -> list[float]:
    """(competitor, price) rows -> the median price of each competitor. A site that lists twenty prices must not
    outweigh three that list one each, and confidence counts competitors, not rows."""
    by_competitor: dict[str, list[float]] = {}
    for name, value in rows:
        by_competitor.setdefault(re.sub(r"[^a-z0-9]", "", name.lower()) or name, []).append(value)
    return [median(v) for v in by_competitor.values()]


def drop_outliers(values: list[float]) -> list[float]:
    """Drops prices under a third or over three times the median: usually a different unit or a typo."""
    values = [v for v in values if v > 0]
    if len(values) < 3:
        return values
    m = median(values)
    return [v for v in values if m / 3 <= v <= m * 3]


def quantile(sorted_values: list[float], q: float) -> float:
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def demand_level(count: int, all_counts: list[int], min_total: int = 5) -> str:
    """This area's ExtraHand task count against the average over all listed areas, for one service."""
    total = sum(all_counts)
    if not all_counts or total < min_total:
        return "unknown"
    ratio = count / (total / len(all_counts))
    if ratio >= 1.5:
        return "high"
    if ratio <= 0.5:
        return "low"
    return "normal"


UNKNOWN_REVIEW_COUNT_WEIGHT = 50  # a page that states stars but not how many reviews is trusted a little
MAX_REVIEW_COUNT_WEIGHT = 500
MIN_REVIEWS_FOR_LEVEL = 100  # fewer reviews than this in total do not move a price, whatever the stars say


def sentiment_level(ratings: list[tuple]) -> tuple[str, float | None]:
    """(stars out of 5, sentiment -1..1, review count) per competitor -> how strong the competition is, and the
    average stars. Stars are weighted by review count, so 8 reviews do not outvote 3,000, and the level stays
    "unknown" until at least MIN_REVIEWS_FOR_LEVEL reviews stand behind the stars."""
    stars = [
        (r[0], min(r[2], MAX_REVIEW_COUNT_WEIGHT) if len(r) > 2 and r[2] else UNKNOWN_REVIEW_COUNT_WEIGHT)
        for r in ratings if r[0] is not None
    ]
    if stars:
        avg = round(sum(v * w for v, w in stars) / sum(w for _, w in stars), 2)
        if sum(r[2] or 0 for r in ratings if r[0] is not None and len(r) > 2) < MIN_REVIEWS_FOR_LEVEL:
            return "unknown", avg
        level = "strong" if avg >= 4.5 else "weak" if avg < 4.0 else "neutral"
        return level, avg
    moods = [r[1] for r in ratings if r[1] is not None]
    if moods:
        m = mean(moods)
        return ("strong" if m >= 0.4 else "weak" if m <= -0.2 else "neutral"), None
    return "unknown", None


def round_price(x: float) -> int:
    """Indian retail style: 1,763 -> 1,749; 1,780 -> 1,799; small amounts to the nearest 10."""
    if x < 100:
        return max(10, int(round(x / 10) * 10))
    return int(round(x / 50) * 50) - 1


def compute_price(
    values: list[float],
    *,
    basis: str,
    strategy: StrategyValues,
    demand: str,
    sentiment: str,
    min_price: float | None = None,
    max_price: float | None = None,
) -> PriceResult:
    kept = sorted(drop_outliers(values))
    if not kept:
        return PriceResult(status="no_data")

    med = median(kept)
    adjustments: list[dict] = []
    if strategy.position_pct:
        side = "below" if strategy.position_pct < 0 else "above"
        adjustments.append({"reason": f"Set {abs(strategy.position_pct):g}% {side} the competitor median", "pct": strategy.position_pct})
    if demand in ("high", "low") and strategy.demand_adjust_pct:
        sign = 1 if demand == "high" else -1
        adjustments.append({"reason": f"{demand.capitalize()} ExtraHand demand in this area", "pct": sign * strategy.demand_adjust_pct})
    if sentiment in ("weak", "strong") and strategy.sentiment_adjust_pct:
        sign = 1 if sentiment == "weak" else -1
        reason = "Competitors here are poorly rated" if sentiment == "weak" else "Competitors here are highly rated"
        adjustments.append({"reason": reason, "pct": sign * strategy.sentiment_adjust_pct})

    price = round_price(med * (1 + sum(a["pct"] for a in adjustments) / 100))
    if min_price and price < min_price:
        price = math.ceil(min_price)
        adjustments.append({"reason": "Raised to the service's minimum price", "pct": 0})
    if max_price and price > max_price:
        price = math.floor(max_price)
        adjustments.append({"reason": "Capped at the service's maximum price", "pct": 0})

    n = len(kept)
    confidence = "high" if n >= 4 else "medium" if n >= 2 else "low"
    if basis == "city" and confidence == "high":
        confidence = "medium"

    return PriceResult(
        status="priced",
        price=price,
        market_median=round(med, 2),
        market_low=round(quantile(kept, 0.25), 2),
        market_high=round(quantile(kept, 0.75), 2),
        price_count=n,
        confidence=confidence,
        adjustments=adjustments,
    )


def rupees(x: float | None) -> str:
    return "—" if x is None else f"₹{x:,.0f}"


def explain(result: PriceResult, *, service: str, unit: str, place: str, basis: str) -> str:
    """One paragraph a person can check against the evidence."""
    if result.status != "priced":
        return f"No competitor prices for {service} were found in {place} or elsewhere in the city, so no price is set."
    parts = [
        f"Prices from {result.price_count} competitor{'s' if result.price_count != 1 else ''} for {service} ({unit})"
        f"{' across the city' if basis == 'city' else f' in {place}'}: "
        f"{rupees(result.market_low)}–{rupees(result.market_high)}, median {rupees(result.market_median)}."
    ]
    if basis == "city":
        parts.append(f"None were found for {place} itself, so city-wide prices were used.")
    for a in result.adjustments:
        parts.append(f"{a['reason']} ({a['pct']:+g}%)." if a["pct"] else f"{a['reason']}.")
    parts.append(f"Recommended price: {rupees(result.price)}.")
    return " ".join(parts)
