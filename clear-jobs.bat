@echo off
REM ============================================================
REM  Clear all jobs on the test dealership (Ford Motors).
REM  Double-click, or run from a terminal.
REM  To clear a different dealership:  clear-jobs.bat <UUID>
REM ============================================================
cd /d "%~dp0"

node scripts\clear-test-jobs.js %*

echo.
echo   (If jobs still show on a phone, close/log out of the app so
echo    its offline cache doesn't re-sync them back.)
echo.
echo   Press any key to close...
pause >nul
