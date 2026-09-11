# Stockwise AI PowerShell Launcher
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Starting Stockwise AI (Backend + Frontend)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$VenvPython = ".\.venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    & $VenvPython run.py
} else {
    python run.py
}
