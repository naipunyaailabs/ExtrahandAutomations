# WhatsApp Automation Service (Folder B)
# Integration with OpenWA (Open Source WhatsApp API Gateway)

from .openwa_client import OpenWAClient, get_openwa_client
from .service import WhatsAppDispatchService, get_whatsapp_service
from .router import router as whatsapp_router
from .agent import WhatsAppTaskDispatchAgent, get_whatsapp_dispatch_agent

__all__ = [
    "OpenWAClient",
    "get_openwa_client",
    "WhatsAppDispatchService",
    "get_whatsapp_service",
    "whatsapp_router",
    "WhatsAppTaskDispatchAgent",
    "get_whatsapp_dispatch_agent",
]
