@echo off
setlocal

REM Start Shinetime server and Expo dev server
cd /d "%~dp0"

REM Kill any lingering ngrok processes
taskkill /F /IM ngrok.exe >nul 2>&1

REM Start API server in its own window (auto-updates API base URL)
start "Shinetime API" cmd /k "powershell -NoProfile -ExecutionPolicy Bypass -File %~dp0StartTunnel.ps1 & npm start"

REM Start Expo from project root in its own window
cd /d "%~dp0.."
start "Shinetime Expo" cmd /k "npm start -- --tunnel"
