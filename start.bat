@echo off
title Intelligence Platform Runner
cd /d "%~dp0"

rem Ports can be overridden with environment variables before running this script.
if not defined BACKEND_PORT set BACKEND_PORT=8050
if not defined FRONTEND_PORT set FRONTEND_PORT=5180

echo ========================================================================
echo   Starting Intelligence Platform...
echo ========================================================================
echo.

echo [1/2] Launching Backend Server on http://localhost:%BACKEND_PORT% ...
start "Backend (Port %BACKEND_PORT%)" cmd /k "cd /d "%~dp0backend" && set "PORT=%BACKEND_PORT%" && .venv\Scripts\activate.bat && python run.py"

echo [2/2] Launching Frontend UI on http://localhost:%FRONTEND_PORT% ...
start "Frontend (Port %FRONTEND_PORT%)" cmd /k "cd /d "%~dp0frontend" && set "VITE_DEV_PORT=%FRONTEND_PORT%" && set "VITE_API_BASE_URL=http://127.0.0.1:%BACKEND_PORT%" && npm run dev"

echo.
echo ========================================================================
echo   Both services are launching in separate windows!
echo   - Backend API : http://localhost:%BACKEND_PORT%
echo   - Web UI      : http://localhost:%FRONTEND_PORT%
echo ========================================================================
echo.
timeout /t 5 >nul
start http://localhost:%FRONTEND_PORT%
exit /b 0
