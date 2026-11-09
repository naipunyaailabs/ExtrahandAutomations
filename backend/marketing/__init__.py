"""Marketing & Festival Advertisement Service (Service 3).

Festivals are registered by hand for All-India and each city; the poster agent designs their posters.
"""

from .agent import AIPosterAgent, poster_agent
from .router import advestiment_router, marketing_router
from .service import get_advestiment_service, get_advestiment_service as get_marketing_service

__all__ = [
    "marketing_router",
    "advestiment_router",
    "get_marketing_service",
    "get_advestiment_service",
    "AIPosterAgent",
    "poster_agent",
]
