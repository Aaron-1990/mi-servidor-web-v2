@echo off
title Gestor de Servicios VSM v2 - BorgWarner GPEC5
color 0A

:MENU
cls
echo ============================================================
echo        GESTOR DE SERVICIOS VSM v2 - BORGWARNER GPEC5
echo ============================================================
echo.
echo  [1] Ver estado de los 3 servicios
echo  [2] Iniciar todos los servicios
echo  [3] Detener todos los servicios
echo  [4] Reiniciar todos los servicios
echo  [5] Ver logs (ultimas 30 lineas)
echo  [6] Probar conectividad API
echo  [7] Abrir services.msc
echo  [8] Salir
echo.
set /p choice=Seleccione una opcion (1-8):

if "%choice%"=="1" goto STATUS
if "%choice%"=="2" goto START
if "%choice%"=="3" goto STOP
if "%choice%"=="4" goto RESTART
if "%choice%"=="5" goto LOGS
if "%choice%"=="6" goto TEST
if "%choice%"=="7" goto SERVICES
if "%choice%"=="8" goto EXIT
goto MENU

:STATUS
echo.
echo --- Estado de Servicios VSM ---
echo.
echo [VSM-API]
sc query VSM-API | findstr "STATE"
echo.
echo [VSM-Scheduler]
sc query VSM-Scheduler | findstr "STATE"
echo.
echo [VSM-Pulse]
sc query VSM-Pulse | findstr "STATE"
echo.
pause
goto MENU

:START
echo.
echo Iniciando servicios en orden...
echo [1/3] Iniciando VSM-API...
net start VSM-API
timeout /t 5 /nobreak > nul
echo [2/3] Iniciando VSM-Scheduler...
net start VSM-Scheduler
timeout /t 2 /nobreak > nul
echo [3/3] Iniciando VSM-Pulse...
net start VSM-Pulse
echo.
echo Todos los servicios iniciados.
pause
goto MENU

:STOP
echo.
echo Deteniendo servicios...
net stop VSM-Pulse
net stop VSM-Scheduler
net stop VSM-API
echo.
echo Todos los servicios detenidos.
pause
goto MENU

:RESTART
echo.
echo Reiniciando servicios...
net stop VSM-Pulse
net stop VSM-Scheduler
net stop VSM-API
timeout /t 3 /nobreak > nul
net start VSM-API
timeout /t 5 /nobreak > nul
net start VSM-Scheduler
timeout /t 2 /nobreak > nul
net start VSM-Pulse
echo.
echo Todos los servicios reiniciados.
pause
goto MENU

:LOGS
echo.
echo --- Ultimas 30 lineas de cada servicio ---
echo.
echo === VSM-API stdout ===
if exist "C:\Aplicaciones\mi-servidor-web-v2\logs\vsm-api-stdout.log" (
    powershell "Get-Content 'C:\Aplicaciones\mi-servidor-web-v2\logs\vsm-api-stdout.log' -Tail 30"
) else (
    echo No hay logs disponibles
)
echo.
echo === VSM-Scheduler stdout ===
if exist "C:\Aplicaciones\mi-servidor-web-v2\logs\vsm-scheduler-stdout.log" (
    powershell "Get-Content 'C:\Aplicaciones\mi-servidor-web-v2\logs\vsm-scheduler-stdout.log' -Tail 30"
) else (
    echo No hay logs disponibles
)
echo.
echo === VSM-Pulse stdout ===
if exist "C:\Aplicaciones\mi-servidor-web-v2\logs\vsm-pulse-stdout.log" (
    powershell "Get-Content 'C:\Aplicaciones\mi-servidor-web-v2\logs\vsm-pulse-stdout.log' -Tail 30"
) else (
    echo No hay logs disponibles
)
echo.
pause
goto MENU

:TEST
echo.
echo Probando conectividad...
echo.
echo [API Status]
curl -s http://localhost:3000/api/status 2>nul
if errorlevel 1 (
    echo ERROR: API no responde en puerto 3000
)
echo.
echo.
echo [Dashboard]
curl -s -o nul -w "HTTP Status: %%{http_code}" http://localhost:3000 2>nul
echo.
echo.
echo [WebSocket port check]
powershell "if (Test-NetConnection -ComputerName localhost -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded { 'Puerto 3000: ABIERTO' } else { 'Puerto 3000: CERRADO' }"
echo.
pause
goto MENU

:SERVICES
services.msc
goto MENU

:EXIT
exit
