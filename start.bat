@echo off
title Intelligence Platform Runner
cd /d "%~dp0"

rem One port for everything: the backend serves the dashboard and every API.
rem The port can be overridden with an environment variable before running this script.
if not defined BACKEND_PORT set BACKEND_PORT=5074

echo ========================================================================
echo   Starting ExtraHand Intelligence Platform...
echo ========================================================================
echo.

echo [1/3] Building the dashboard ...
pushd "%~dp0frontend"
call npm run build
if errorlevel 1 (
  popd
  echo.
  echo   The dashboard build failed - see the errors above.
  pause
  exit /b 1
)
popd

echo [2/3] Launching the platform on http://localhost:%BACKEND_PORT% ...
start "ExtraHand Platform (Port %BACKEND_PORT%)" cmd /k "cd /d "%~dp0backend" && set "PORT=%BACKEND_PORT%" && .venv\Scripts\activate.bat && python run.py"

echo [3/3] Launching Telephony Cloudflare Tunnel (Port %BACKEND_PORT% to Public HTTPS) ...
start "Telephony Tunnel" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\activate.bat && python start_tunnel.py"

echo.
echo ========================================================================
echo   Dashboard + API : http://localhost:%BACKEND_PORT%
echo   Telephony       : Cloudflare Tunnel (auto-syncs PUBLIC_BASE_URL)
echo.
echo   Developing the UI with live reload? Run "npm run dev" in frontend
echo   (port 5180, it forwards /api to %BACKEND_PORT%).
echo ========================================================================
echo.
timeout /t 5 >nul
start http://localhost:%BACKEND_PORT%
exit /b 0
