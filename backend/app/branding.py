"""Brand links and message text built from settings, so nothing brand-specific is written in code."""
from __future__ import annotations

from typing import Iterable, Optional
from urllib.parse import urlencode

from .config import get_settings


def company() -> str:
    return get_settings().company_name


def website_host() -> str:
    """Website domain without scheme or www, e.g. "extrahand.in"."""
    host = get_settings().website_url.split("//")[-1].split("/")[0]
    return host[4:] if host.startswith("www.") else host


def booking_link(city: Optional[str] = None, promo: Optional[str] = None) -> str:
    params = {}
    if city and city not in ("All-India", "India"):
        params["city"] = city.lower()
    if promo:
        params["promo"] = promo
    base = get_settings().booking_url
    return f"{base}?{urlencode(params)}" if params else base


def task_link(task_id: str, **params: str) -> str:
    url = get_settings().task_url_template.format(task_id=task_id)
    return f"{url}?{urlencode(params)}" if params else url


def promo_message(title: str, city: str, discount: int, services: Iterable[str], code: str) -> str:
    """Standard WhatsApp promo text for a discovered or merged event."""
    place = "India" if city == "All-India" else city
    return (
        f"🎉 *{company()} {title} Special Offer for {place}!* 🎉\n\n"
        f"Celebrate *{title}* with verified home service professionals.\n\n"
        f"🎁 *Festival Offer:* Flat *{discount}% OFF* on {', '.join(list(services)[:3])}\n"
        f"🏷 *Coupon Code:* *{code}*\n"
        f"👉 *Book Online:* {booking_link(city, code)}\n\n"
        f"🛡 Background-verified technicians · On-time guarantee."
    )


