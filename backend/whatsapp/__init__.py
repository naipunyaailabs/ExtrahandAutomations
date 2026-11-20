# WhatsApp Automation Service (Folder B)
# Sends through the official Meta WhatsApp Business Cloud API (meta_client.py)

from .meta_client import MetaWhatsAppClient, get_meta_whatsapp_client
from .service import WhatsAppDispatchService, get_whatsapp_service
from .router import router as whatsapp_router
from .agent import WhatsAppTaskDispatchAgent, get_whatsapp_dispatch_agent

__all__ = [
    "MetaWhatsAppClient",
    "get_meta_whatsapp_client",
    "WhatsAppDispatchService",
    "get_whatsapp_service",
    "whatsapp_router",
    "WhatsAppTaskDispatchAgent",
    "get_whatsapp_dispatch_agent",
]
