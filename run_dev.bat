@echo off
title Sisaket Hospital IoT - Dev Server

echo ====================================================
echo Starting IoT Backend Development Server...
echo ====================================================
echo.
echo Press Ctrl+C to stop the server when you are done.
echo.

python -c "import fastapi, uvicorn, paho.mqtt.client" >nul 2>&1
if errorlevel 1 (
	echo Missing Python dependencies for the backend.
	echo Run: pip install -r server\requirements.txt
	pause
	exit /b 1
)

:: Open the default web browser to the local backend URL
start http://localhost:8000/

:: Start FastAPI backend on port 8000
python -m uvicorn server.app.main:app --reload

pause
