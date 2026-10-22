@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM  ExtraHand Intelligence - Database Table Auto-Creator
REM  Double-click or run from command prompt to initialize PostgreSQL tables.
REM ============================================================================

cd /d "%~dp0"

echo.
echo ============================================================================
echo   Running ExtraHand Database Auto Table Initializer...
echo ============================================================================
echo.

REM 1. Look for project virtual environment Python
if exist "..\.venv\Scripts\python.exe" (
    set "PY_CMD=..\.venv\Scripts\python.exe"
    goto :RUN
)

if exist "..\venv\Scripts\python.exe" (
    set "PY_CMD=..\venv\Scripts\python.exe"
    goto :RUN
)

REM 2. Look for global Python
where python >nul 2>nul
if %errorlevel% equ 0 (
    set "PY_CMD=python"
    goto :RUN
)

echo [ERROR] Python not found in virtual environment or PATH!
echo Please make sure Python is installed or run with virtual environment python.
echo.
pause
exit /b 1

:RUN
"%PY_CMD%" init_db.py %*
set "EXIT_CODE=%errorlevel%"

echo.
if %EXIT_CODE% equ 0 (
    echo [SUCCESS] Tables created and verified successfully.
) else (
    echo [ERROR] Script encountered an error (exit code: %EXIT_CODE%).
)

echo.
echo Press any key to close this window...
pause >nul
exit /b %EXIT_CODE%
