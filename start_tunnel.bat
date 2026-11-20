@echo off
title Telephony Cloudflare Tunnel
cd /d "%~dp0backend"
echo ========================================================================
echo   Starting Telephony Cloudflare Tunnel...
echo ========================================================================
echo.
call .venv\Scripts\activate.bat
python start_tunnel.py
pause
