# =============================================================================
# DESINSTALAR: Servicios Windows VSM v2
# Ejecutar como: PowerShell Administrador
# Revierte Feature 6A - regresa a inicio manual con start-vsm.bat
# =============================================================================

$nssmExe = "C:\Tools\nssm\nssm.exe"
$services = @("VSM-Pulse", "VSM-Scheduler", "VSM-API")

Write-Host "Desinstalando servicios VSM v2..." -ForegroundColor Cyan

foreach ($svc in $services) {
    $existing = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Deteniendo $svc..." -ForegroundColor Yellow
        & $nssmExe stop $svc 2>$null
        Start-Sleep -Seconds 2
        & $nssmExe remove $svc confirm 2>$null
        Write-Host "  [OK] $svc removido" -ForegroundColor Green
    } else {
        Write-Host "  [SKIP] $svc no existe" -ForegroundColor Gray
    }
}

# Remover tarea programada
Unregister-ScheduledTask -TaskName "VSM-LogRotation-v2" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "  [OK] Tarea de log rotation removida" -ForegroundColor Green

Write-Host ""
Write-Host "Desinstalacion completa. Puede usar start-vsm.bat para inicio manual." -ForegroundColor Green
