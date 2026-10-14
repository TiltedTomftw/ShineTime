@echo off
REM ============================================================
REM  Shinetime - start the Expo dev server with a TUNNEL.
REM  Double-click this file, or run it from a terminal.
REM  You'll get the QR code + live logs right here in this window.
REM
REM  - Scan the QR with Expo Go (Android) or the Camera app (iOS).
REM  - Press Ctrl+C to stop the server.
REM  - Pass  -c  to clear the Metro cache (needed after adding a
REM    dependency or changing .env):   start-tunnel.bat -c
REM ============================================================

cd /d "%~dp0"

echo.
echo   Starting Shinetime with tunnel...
echo   (first run of a session can take ~20-40s to connect the tunnel)
echo.

call npx expo start --tunnel %*

echo.
echo   Expo exited. Press any key to close this window...
pause >nul
