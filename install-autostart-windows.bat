@echo off
title Yun Traffic - install auto-start
cd /d "%~dp0"
node scripts\autorun.mjs install
echo.
pause
