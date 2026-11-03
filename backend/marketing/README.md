# Service 3: Marketing & Festival Demand Radar Service

## Overview
The Marketing Service drives hyper-local customer demand around Indian festivals, holidays, and regional temple events. It crawls municipal and state portals to detect local holidays, generates tailored WhatsApp and SMS promotional campaigns, and tracks conversion back into bookings.

## Key Endpoints
- `/api/marketing/cities` (or `/api/advestiment/cities`) - List tracked cities and their holiday events count
- `/api/marketing/cities/add` - Dynamically onboard a new city and its news/gov URLs
- `/api/marketing/events/{city}` - Dynamic holiday calendar for a specific city
- `/api/marketing/all-india` - Official Government of India National Calendar (gazetted holidays & demand surges)
- `/api/marketing/scan` - Trigger AI agent to scrape city websites and detect events
- `/api/marketing/generate-template` - AI copy generation for festival discounts
- `/api/marketing/broadcast` - Broadcast festive promos to customers via WhatsApp

## Architecture
- **Web Scraper**: BeautifulSoup4 + HTTPX resilient web reader
- **AI Engine**: OpenRouter LLM (DeepSeek / Gemini / Claude) for event extraction & ad copy
- **Database**: SQLite WAL / PostgreSQL (`marketing_cities`, `marketing_events`)

