@echo off
title Stockwise AI Launcher
echo ========================================================
echo Starting Stockwise AI (Backend + Frontend)
echo ========================================================
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" run.py
) else (
    python run.py
)
pause
