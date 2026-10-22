# ==============================================================================
# ExtraHand Intelligence - PowerShell Database Initializer
# Usage:
#   .\init_db.ps1
#   .\init_db.ps1 -Sync
#   .\init_db.ps1 -Reset
# ==============================================================================

param(
    [switch]$Reset,
    [switch]$Sync,
    [string]$HostName,
    [int]$Port = 0,
    [string]$User,
    [string]$Password,
    [string]$DbName
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Detect Python executable
$VenvPython = Join-Path (Split-Path -Parent $ScriptDir) ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $PythonExe = $VenvPython
} else {
    $PythonExe = "python"
}

$Arguments = @("init_db.py")

if ($Reset) { $Arguments += "--reset" }
if ($Sync) { $Arguments += "--sync" }
if ($HostName) { $Arguments += "--host", $HostName }
if ($Port -gt 0) { $Arguments += "--port", $Port }
if ($User) { $Arguments += "--user", $User }
if ($Password) { $Arguments += "--password", $Password }
if ($DbName) { $Arguments += "--dbname", $DbName }

Write-Host "Running database initialization via $PythonExe..." -ForegroundColor Cyan
& $PythonExe $Arguments
