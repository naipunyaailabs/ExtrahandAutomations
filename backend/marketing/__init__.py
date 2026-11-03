"""Marketing & Festival Advertisement Service (Service 3)

Exports the unified marketing router and service helpers.
"""

from .router import marketing_router, advestiment_router
from .service import get_advestiment_service as get_marketing_service, get_advestiment_service
from .agent import get_advestiment_agent as get_marketing_agent, get_advestiment_agent

__all__ = [
    "marketing_router",
    "advestiment_router",
    "get_marketing_service",
    "get_advestiment_service",
    "get_marketing_agent",
    "get_advestiment_agent",
]
