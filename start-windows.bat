@echo off
title Yun Traffic
cd /d "%~dp0"

echo Getting the latest version...
git pull

echo Installing anything new...
call npm install --no-audit --no-fund

echo Starting Yun Traffic. Your browser will open in a few seconds.
echo Keep this window open while you use the site. Close it to stop.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:5173"
call npm run dev
pause
