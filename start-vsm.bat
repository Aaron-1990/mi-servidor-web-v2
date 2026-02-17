@echo off
title VSM Launcher
echo Starting VSM System...

cd /d C:\Aplicaciones\mi-servidor-web-v2

start "VSM API Server" cmd /k "cd /d C:\Aplicaciones\mi-servidor-web-v2 && node src/presentation/api/server.js"
timeout /t 2 /nobreak >nul

start "VSM Scheduler" cmd /k "cd /d C:\Aplicaciones\mi-servidor-web-v2 && node scripts/scheduler.js"
timeout /t 1 /nobreak >nul

start "VSM RT Pulse" cmd /k "cd /d C:\Aplicaciones\mi-servidor-web-v2 && node scripts/rt-pulse-monitor.js"

echo.
echo 3 ventanas abiertas:
echo   - VSM API Server (puerto 3000)
echo   - VSM Scheduler (extraccion 30s + calculo 60s)
echo   - VSM RT Pulse Monitor (pulso 5s)
echo.
echo Dashboard: http://localhost:3000
echo.
pause
