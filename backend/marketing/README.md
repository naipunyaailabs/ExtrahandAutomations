# Service 3: Marketing & Festival Demand Radar Service

## Overview
Festival marketing for the monitored regions in `data/regions.json` (Advertisement > States & Cities):

- **Cities**: festivals are registered by hand from each calendar (name, description, coupon code).
- **All-India**: registered by hand too, plus the **Find Festivals** button (`festival_finder.py`), which starts
  an agent (GPT-OSS-20B) for the current month and the next two. With its `open_website` tool the agent
  visits Drik Panchang (month festival list + year Indian calendar), reads the festival names and dates itself and
  picks the major ones; a festival is kept only if its name is written next to that date on the page. An optional
  IMD Rashtriya Panchang page (`FESTIVAL_VERIFY_URL`) is opened to mark them verified, and each one waits as
  "Pending Review" until an admin approves it. Only approved festivals are published and get a poster.
  Recommended: run it every three months. Needs `OPENROUTER_API_KEY`.

The poster agent creates a poster for every approved festival in the background; posters are stored under `backend/database/posters/`.
The **Create Posters** button (`POST /posters/scan`) makes the agent look at this month and the next two and create a
poster for every approved festival there that has none: the design model reads the festival and its description, works
out its religion / tradition and the scene to show (and what other religions' symbols to avoid), and
Seedream 5.0 Flash (`POSTER_IMAGE_MODEL=bytedance-seed/seedream-5-0-flash`, via OpenRouter) draws the artwork.

## Key Endpoints (`/api/advestiment/...`, also under `/api/marketing/...`)
- `GET /cities` - All-India and the cities, with their published (approved) festivals
- `POST /cities/add` - add a city under a state
- `GET /events/{city}?year=&month=` - calendar events for a region
- `POST /events/register`, `PUT /events/register/{id}` - register / edit a festival (any region)
- `DELETE /events/detail/{id}` - delete an event and its poster files
- `GET /events/detail/{id}/poster-status`, `POST /events/detail/{id}/poster-agent` - poster agent progress / restart
- `POST /festival-finder/start`, `GET /festival-finder/status` - All-India festival finder
- `POST /events/detail/{id}/approve`, `POST /events/detail/{id}/reject` - admin decision on a suggested festival

## Architecture
- **Festival finder agent**: GPT-OSS-20B (`FESTIVAL_MODEL`, through OpenRouter) with an `open_website` tool limited to Drik Panchang and the IMD page
- **Poster agent**: OpenRouter models for poster design and artwork
- **Database**: the main `DATABASE_URL` database (`ad_cities`, `ad_events`, `ad_posters`, `ad_festival_runs`)
