# =============================================================================
# FEATURE 6A: Servicios Windows 24/7 con NSSM
# VSM Real-Time Monitoring v2 - BorgWarner GPEC5
# Archivo: install-vsm-services.ps1
# Ejecutar como: PowerShell Administrador
# =============================================================================
#
# Arquitectura de servicios:
#   VSM-API       -> node src/presentation/api/server.js    (REST + WebSocket, puerto 3000)
#   VSM-Scheduler -> node scripts/scheduler.js              (Extraccion CSV 30s + Calculo 60s)
#   VSM-Pulse     -> node scripts/rt-pulse-monitor.js       (Deteccion RT 5s)
#
# Dependencias: Scheduler y Pulse dependen de API (arrancan despues)
# =============================================================================

# --- CONFIGURACION ---
$projectPath = "C:\Aplicaciones\mi-servidor-web-v2"
$nssmPath = "C:\Tools\nssm"
$nssmExe = "$nssmPath\nssm.exe"
$logsPath = "$projectPath\logs"
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source

# Definicion de los 3 servicios
$services = @(
    @{
        Name        = "VSM-API"
        DisplayName = "VSM API Server (BorgWarner GPEC5)"
        Description = "REST API + WebSocket server para dashboard VSM. Puerto 3000."
        Script      = "src\presentation\api\server.js"
        DependsOn   = "Tcpip"
    },
    @{
        Name        = "VSM-Scheduler"
        DisplayName = "VSM Scheduler (BorgWarner GPEC5)"
        Description = "Extraccion CSV cada 30s y calculo de metricas cada 60s."
        Script      = "scripts\scheduler.js"
        DependsOn   = "VSM-API"
    },
    @{
        Name        = "VSM-Pulse"
        DisplayName = "VSM RT Pulse Monitor (BorgWarner GPEC5)"
        Description = "Monitor de pulsos en tiempo real cada 5s. Detecta nuevos eventos BCMP."
        Script      = "scripts\rt-pulse-monitor.js"
        DependsOn   = "VSM-API"
    }
)

# =============================================================================
# PASO 0: VERIFICACIONES PREVIAS
# =============================================================================
Write-Host "============================================================" -ForegroundColor White
Write-Host "  FEATURE 6A: Instalacion de Servicios Windows VSM v2" -ForegroundColor Cyan
Write-Host "  BorgWarner GPEC5 - 3 servicios independientes con NSSM" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor White
Write-Host ""

# Verificar permisos de administrador
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "[ERROR] Este script requiere permisos de administrador." -ForegroundColor Red
    Write-Host "  Click derecho en PowerShell -> Ejecutar como administrador" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Permisos de administrador verificados" -ForegroundColor Green

# Verificar directorio del proyecto
if (-NOT (Test-Path $projectPath)) {
    Write-Host "[ERROR] Directorio del proyecto no encontrado: $projectPath" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Directorio del proyecto: $projectPath" -ForegroundColor Green

# Verificar Node.js
if (-NOT $nodeExe) {
    Write-Host "[ERROR] Node.js no encontrado en PATH" -ForegroundColor Red
    exit 1
}
$nodeVersion = & node --version
Write-Host "[OK] Node.js encontrado: $nodeExe ($nodeVersion)" -ForegroundColor Green

# Verificar que los 3 scripts existen
foreach ($svc in $services) {
    $scriptPath = Join-Path $projectPath $svc.Script
    if (-NOT (Test-Path $scriptPath)) {
        Write-Host "[ERROR] Script no encontrado: $scriptPath" -ForegroundColor Red
        exit 1
    }
}
Write-Host "[OK] Los 3 scripts de servicio existen" -ForegroundColor Green

# =============================================================================
# PASO 1: VERIFICAR/INSTALAR NSSM
# =============================================================================
Write-Host ""
Write-Host "--- PASO 1: Verificar NSSM ---" -ForegroundColor Cyan

if (Test-Path $nssmExe) {
    Write-Host "[OK] NSSM ya instalado: $nssmExe" -ForegroundColor Green
} else {
    Write-Host "[INFO] NSSM no encontrado. Instalando..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $nssmPath -Force | Out-Null

    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $nssmZip = "$env:TEMP\nssm.zip"

    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip
        Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm-temp" -Force
        Copy-Item "$env:TEMP\nssm-temp\nssm-2.24\win64\nssm.exe" $nssmExe -Force
        Remove-Item $nssmZip -Force -ErrorAction SilentlyContinue
        Remove-Item "$env:TEMP\nssm-temp" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] NSSM instalado exitosamente" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] No se pudo descargar NSSM: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Descargue manualmente desde: https://nssm.cc/download" -ForegroundColor Yellow
        Write-Host "  Copie nssm.exe (win64) a: $nssmExe" -ForegroundColor Yellow
        exit 1
    }
}

# =============================================================================
# PASO 2: CREAR DIRECTORIO DE LOGS
# =============================================================================
Write-Host ""
Write-Host "--- PASO 2: Directorio de logs ---" -ForegroundColor Cyan

if (-NOT (Test-Path $logsPath)) {
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
    Write-Host "[OK] Directorio de logs creado: $logsPath" -ForegroundColor Green
} else {
    Write-Host "[OK] Directorio de logs ya existe" -ForegroundColor Green
}

# =============================================================================
# PASO 3: DETENER PROCESOS EXISTENTES
# =============================================================================
Write-Host ""
Write-Host "--- PASO 3: Detener procesos existentes ---" -ForegroundColor Cyan

# Detener servicios NSSM si existen
foreach ($svc in $services) {
    $existing = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[INFO] Deteniendo servicio existente: $($svc.Name)..." -ForegroundColor Yellow
        & $nssmExe stop $svc.Name 2>$null
        Start-Sleep -Seconds 2
        & $nssmExe remove $svc.Name confirm 2>$null
        Write-Host "[OK] Servicio anterior removido: $($svc.Name)" -ForegroundColor Green
    }
}

# Advertencia sobre procesos CMD manuales
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host ""
    Write-Host "[ADVERTENCIA] Se detectaron $($nodeProcesses.Count) proceso(s) Node.js activos." -ForegroundColor Yellow
    Write-Host "  Si son las ventanas CMD de start-vsm.bat, cierrelas antes de continuar." -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "  Desea continuar de todos modos? (S/N)"
    if ($response -ne "S" -and $response -ne "s") {
        Write-Host "  Instalacion cancelada. Cierre las ventanas CMD y ejecute de nuevo." -ForegroundColor Yellow
        exit 0
    }
}

# =============================================================================
# PASO 4: REGISTRAR LOS 3 SERVICIOS CON NSSM
# =============================================================================
Write-Host ""
Write-Host "--- PASO 4: Registrar servicios con NSSM ---" -ForegroundColor Cyan

foreach ($svc in $services) {
    Write-Host ""
    Write-Host "  Instalando: $($svc.Name) ($($svc.DisplayName))..." -ForegroundColor White

    # Instalar servicio - NSSM ejecuta node.exe directamente (no .bat wrapper)
    & $nssmExe install $svc.Name $nodeExe $svc.Script

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] Fallo al instalar $($svc.Name)" -ForegroundColor Red
        exit 1
    }

    # Configurar parametros
    & $nssmExe set $svc.Name DisplayName $svc.DisplayName
    & $nssmExe set $svc.Name Description $svc.Description
    & $nssmExe set $svc.Name AppDirectory $projectPath
    & $nssmExe set $svc.Name Start SERVICE_AUTO_START

    # Variables de entorno
    & $nssmExe set $svc.Name AppEnvironmentExtra "NODE_ENV=production"

    # Dependencias
    & $nssmExe set $svc.Name DependOnService $svc.DependsOn

    # Auto-restart en caso de fallo
    & $nssmExe set $svc.Name AppExit Default Restart
    & $nssmExe set $svc.Name AppRestartDelay 10000
    & $nssmExe set $svc.Name AppThrottle 5000

    # Logs separados por servicio
    $svcLogPrefix = $svc.Name.ToLower()
    & $nssmExe set $svc.Name AppStdout "$logsPath\$svcLogPrefix-stdout.log"
    & $nssmExe set $svc.Name AppStderr "$logsPath\$svcLogPrefix-stderr.log"
    & $nssmExe set $svc.Name AppStdoutCreationDisposition 4
    & $nssmExe set $svc.Name AppStderrCreationDisposition 4
    & $nssmExe set $svc.Name AppRotateFiles 1
    & $nssmExe set $svc.Name AppRotateOnline 1
    & $nssmExe set $svc.Name AppRotateBytes 5242880

    Write-Host "  [OK] $($svc.Name) registrado y configurado" -ForegroundColor Green
}

# =============================================================================
# PASO 5: TAREA PROGRAMADA - LOG ROTATION DIARIA
# =============================================================================
Write-Host ""
Write-Host "--- PASO 5: Tarea programada de log rotation ---" -ForegroundColor Cyan

$taskName = "VSM-LogRotation-v2"

# Remover tarea anterior si existe
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Script de rotacion: elimina logs mayores a 7 dias
$rotationScript = @"
Get-ChildItem -Path '$logsPath' -Filter '*.log' | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
"@

$rotationScriptPath = "$projectPath\scripts\rotate-logs.ps1"
$rotationScript | Out-File -FilePath $rotationScriptPath -Encoding UTF8

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$rotationScriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At "3:00AM"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Elimina logs VSM mayores a 7 dias" | Out-Null

Write-Host "[OK] Tarea programada creada: $taskName (diaria 3:00 AM)" -ForegroundColor Green

# =============================================================================
# PASO 6: SERVICE MANAGER (GESTOR VISUAL)
# =============================================================================
Write-Host ""
Write-Host "--- PASO 6: Crear gestor de servicios ---" -ForegroundColor Cyan

$managerContent = @"
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
if exist "$logsPath\vsm-api-stdout.log" (
    powershell "Get-Content '$logsPath\vsm-api-stdout.log' -Tail 30"
) else (
    echo No hay logs disponibles
)
echo.
echo === VSM-Scheduler stdout ===
if exist "$logsPath\vsm-scheduler-stdout.log" (
    powershell "Get-Content '$logsPath\vsm-scheduler-stdout.log' -Tail 30"
) else (
    echo No hay logs disponibles
)
echo.
echo === VSM-Pulse stdout ===
if exist "$logsPath\vsm-pulse-stdout.log" (
    powershell "Get-Content '$logsPath\vsm-pulse-stdout.log' -Tail 30"
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
"@

$managerPath = "$projectPath\service-manager-v2.bat"
$managerContent | Out-File -FilePath $managerPath -Encoding ASCII
Write-Host "[OK] Gestor creado: $managerPath" -ForegroundColor Green

# =============================================================================
# PASO 7: INICIAR SERVICIOS
# =============================================================================
Write-Host ""
Write-Host "--- PASO 7: Iniciar servicios ---" -ForegroundColor Cyan

# Iniciar en orden respetando dependencias
Write-Host "  [1/3] Iniciando VSM-API..." -ForegroundColor White
& $nssmExe start "VSM-API"
Start-Sleep -Seconds 5

Write-Host "  [2/3] Iniciando VSM-Scheduler..." -ForegroundColor White
& $nssmExe start "VSM-Scheduler"
Start-Sleep -Seconds 2

Write-Host "  [3/3] Iniciando VSM-Pulse..." -ForegroundColor White
& $nssmExe start "VSM-Pulse"
Start-Sleep -Seconds 3

# =============================================================================
# PASO 8: VERIFICACION POST-INSTALACION
# =============================================================================
Write-Host ""
Write-Host "--- PASO 8: Verificacion ---" -ForegroundColor Cyan

$allGood = $true

foreach ($svc in $services) {
    $status = (Get-Service -Name $svc.Name -ErrorAction SilentlyContinue).Status
    if ($status -eq "Running") {
        Write-Host "  [OK] $($svc.Name): Running" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $($svc.Name): $status" -ForegroundColor Red
        $allGood = $false
    }
}

# Verificar que API responde
Write-Host ""
Write-Host "  Verificando API en puerto 3000..." -ForegroundColor White
Start-Sleep -Seconds 3
try {
    $apiTest = Invoke-WebRequest -Uri "http://localhost:3000/api/status" -UseBasicParsing -TimeoutSec 10
    if ($apiTest.StatusCode -eq 200) {
        Write-Host "  [OK] API respondiendo en http://localhost:3000" -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] API aun no responde. Puede tardar unos segundos mas." -ForegroundColor Yellow
    $allGood = $false
}

# Verificar tarea programada
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "  [OK] Log rotation programada: diaria 3:00 AM" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Tarea de log rotation no encontrada" -ForegroundColor Yellow
}

# =============================================================================
# RESUMEN FINAL
# =============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor White

if ($allGood) {
    Write-Host "  INSTALACION EXITOSA - 3 servicios operativos" -ForegroundColor Green
} else {
    Write-Host "  INSTALACION CON ADVERTENCIAS - revisar elementos marcados" -ForegroundColor Yellow
}

Write-Host "============================================================" -ForegroundColor White
Write-Host ""
Write-Host "  Servicios registrados:" -ForegroundColor White
Write-Host "    VSM-API        -> node src/presentation/api/server.js" -ForegroundColor Gray
Write-Host "    VSM-Scheduler  -> node scripts/scheduler.js" -ForegroundColor Gray
Write-Host "    VSM-Pulse      -> node scripts/rt-pulse-monitor.js" -ForegroundColor Gray
Write-Host ""
Write-Host "  Logs:" -ForegroundColor White
Write-Host "    $logsPath\vsm-api-stdout.log" -ForegroundColor Gray
Write-Host "    $logsPath\vsm-scheduler-stdout.log" -ForegroundColor Gray
Write-Host "    $logsPath\vsm-pulse-stdout.log" -ForegroundColor Gray
Write-Host ""
Write-Host "  Herramientas:" -ForegroundColor White
Write-Host "    Gestor visual:   .\service-manager-v2.bat" -ForegroundColor Gray
Write-Host "    Services Windows: services.msc" -ForegroundColor Gray
Write-Host "    PowerShell:       Get-Service VSM-*" -ForegroundColor Gray
Write-Host ""
Write-Host "  Dashboard:" -ForegroundColor White
Write-Host "    Local: http://localhost:3000" -ForegroundColor Gray
Write-Host ""
Write-Host "  SIGUIENTE: Feature 6B (acceso por red corporativa)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor White
