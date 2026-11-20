# ExtraHand Intelligence Platform: Production Deployment Guide

## Architecture Overview

- **Frontend Container**: React + Vite SPA on port `3074` ➔ `https://intelligence.extrahand.in`
- **Backend Container**: FastAPI + Uvicorn on port `5074` ➔ `https://backend.intelligence.extrahand.in`
- **Database**: Production PostgreSQL Server (`200.141.7.100:5437/Extrahand`)
- **Media Storage**: Azure Blob Storage (`extrahandautomations`)
- **Nginx**: Host reverse proxy handling SSL certificates and forwarding traffic to ports `3074` & `5074`.

```
Clients / Browsers  ──https──> Nginx (443) ──> 127.0.0.1:3074 (Frontend Container)
Vobiz / Meta / API  ──https──> Nginx (443) ──> 127.0.0.1:5074 (Backend Container)
                                                        │
                      ┌─────────────────────────────────┴─────────────────────────────────┐
                      ▼                                                                   ▼
       Remote PostgreSQL Server                                                  Azure Blob Storage
     (200.141.7.100:5437/Extrahand)                                           (extrahandautomations)
```

---

## 1. Prerequisites on Linux VPS (Ubuntu / Debian)

Ensure Docker, Docker Compose, Nginx, and Certbot are installed:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker nginx
```

Ensure DNS records point to your VPS IP:
- `A` record: `intelligence.extrahand.in` ➔ `<VPS_IP>`
- `A` record: `backend.intelligence.extrahand.in` ➔ `<VPS_IP>`

---

## 2. Deploy Containers via Docker Compose

1. Clone or copy this repository to `/opt/extrahand`:
   ```bash
   cd /opt/extrahand
   ```

2. Configure environment:
   Ensure `backend/.env` is configured with all required keys (Database URL, Meta API credentials, Azure connection string, etc.).

3. Build and launch containers:
   ```bash
   docker compose build
   docker compose up -d
   ```

4. Verify running containers:
   ```bash
   docker compose ps
   # Check logs
   docker compose logs -f backend
   docker compose logs -f frontend
   ```

---

## 3. Configure Nginx & SSL

1. Copy the production Nginx configuration:
   ```bash
   sudo cp deploy/nginx/extrahand-intelligence.conf /etc/nginx/sites-available/intelligence.conf
   sudo ln -sf /etc/nginx/sites-available/intelligence.conf /etc/nginx/sites-enabled/
   ```

2. Obtain Let's Encrypt SSL certificates:
   ```bash
   sudo certbot --nginx -d intelligence.extrahand.in -d backend.intelligence.extrahand.in
   ```

3. Test and reload Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 4. Maintenance & Operations

- **Restarting**: `docker compose restart`
- **Rebuilding after code changes**: `git pull && docker compose build && docker compose up -d`
- **Checking backend health**: `curl http://127.0.0.1:5074/api/health`
- **Checking frontend**: `curl -I http://127.0.0.1:3074`
