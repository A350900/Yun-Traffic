@echo off
title Yun Traffic - remove auto-start
cd /d "%~dp0"
node scripts\autorun.mjs uninstall
echo.
pause
