@echo off
title Yun Traffic setup
cd /d "%~dp0"
node scripts\yun.mjs setup
echo.
pause
