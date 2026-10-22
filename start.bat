@echo off
title ExtraHand Intelligence Platform Runner
echo ========================================================================
echo   Starting ExtraHand Intelligence Platform...
echo ========================================================================
echo.

cd /d "%~dp0"

echo [1/2] Launching Backend Server on http://localhost:8000 ...
start "ExtraHand Backend (Port 8000)" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\activate.bat && python run.py"

echo [2/2] Launching Frontend UI on http://localhost:5173 ...
start "ExtraHand Frontend (Port 5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ========================================================================
echo   Both services are launching in separate windows!
echo   - Backend API : http://localhost:8000
echo   - Web UI      : http://localhost:5173
echo ========================================================================
echo.
timeout /t 5 >nul
start http://localhost:5173
exit /b 0
