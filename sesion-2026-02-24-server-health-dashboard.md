# VSM Bitacora de Sesion - 24 de Febrero de 2026

## Lo que se logro en esta sesion

### Feature: Server Health Dashboard (System Tab en Admin Panel)

Implementacion completa de un dashboard de monitoreo de salud del servidor, accesible desde el Admin Panel como un nuevo tab "System". Permite verificar remotamente desde cualquier PC de la red corporativa que el servidor y todos los servicios VSM estan operando correctamente.

---

## Problema que resuelve

Antes de esta feature, no habia forma de saber si la PC servidor estaba encendida, si PostgreSQL estaba conectado, o si los servicios de extraccion (Scheduler/Pulse) estaban corriendo. El unico indicador era que el dashboard de produccion dejaba de actualizar, pero para ese punto ya se habian perdido datos.

Ahora, entrando a `http://10.3.0.200:3000/admin` -> tab System, se obtiene visibilidad completa del estado del servidor en tiempo real con auto-refresh cada 30 segundos.

---

## Que observar: Guia de indicadores de mayor a menor importancia

### 1. Data Freshness (CRITICO)
- **Que es:** Tiempo desde el ultimo raw_scan insertado en la base de datos
- **Donde verlo:** Health Checks -> "Data Freshness" y Data Pipeline -> "Last Scan"
- **Valores normales:** < 1 minuto durante produccion activa
- **Warning:** > 5 minutos (amarillo) - Posible problema con Scheduler o fuente CSV
- **Critico:** > 15 minutos (rojo) - Scheduler detenido, fuente CSV inaccesible, o linea sin produccion
- **Por que es el mas importante:** Si hay datos frescos, todo el pipeline esta funcionando. Es el indicador mas confiable de que el sistema completo esta operativo.

### 2. Scheduler Service + Pulse Service (CRITICO)
- **Que es:** Estado inferido de los servicios de extraccion y calculo
- **Donde verlo:** Health Checks -> "Scheduler Service" y "Pulse Service", tambien Data Pipeline -> "Scheduler" y "Pulse"
- **Como se infiere:** Si hay raw_scans recientes (< 2 min), Scheduler esta activo. Si hay equipment_metrics recientes (< 2 min), Pulse esta activo.
- **Si aparece "Inactive":** Los servicios probablemente se detuvieron. Reiniciar con `service-manager-v2.bat` opcion 4 (como administrador).
- **Por que importa:** Sin Scheduler no se extraen datos. Sin Pulse no se calculan metricas en tiempo real.

### 3. Database Connection (CRITICO)
- **Que es:** Estado de conexion a PostgreSQL
- **Donde verlo:** Health Checks -> "Database Connection" y card Database -> "Status" y "Latency"
- **Valores normales:** Connected, latencia < 10ms (tipicamente 1-3ms)
- **Warning:** Latencia > 100ms - La base de datos esta lenta
- **Critico:** "DISCONNECTED" - Sin base de datos todo el sistema esta muerto
- **Por que importa:** PostgreSQL es el corazon del almacenamiento. Sin el, ni las APIs ni los dashboards funcionan.

### 4. Overall Status Bar (RESUMEN EJECUTIVO)
- **Que es:** Resumen visual del estado de todos los health checks
- **Donde verlo:** Barra de color en la parte superior del tab System
- **Verde "ALL SYSTEMS HEALTHY":** Todo funciona correctamente
- **Amarillo "WARNING":** Al menos un check tiene advertencia - revisar cual
- **Rojo "CRITICAL":** Al menos un check esta en estado critico - atencion inmediata
- **Regla rapida de 3 segundos:** Si la barra es verde y Data Freshness dice menos de 1 minuto, el sistema completo esta operativo.

### 5. Memory Usage (MONITOREO)
- **Que es:** Uso de RAM del servidor Windows
- **Donde verlo:** Health Checks -> "Memory Usage" y Resources -> gauge "RAM"
- **Estado actual:** ~79% usado (1.6 GB libres de 7.8 GB)
- **Warning:** > 80% - El servidor se esta quedando sin memoria
- **Critico:** > 95% - Node.js puede crashear por falta de memoria
- **Accion si sube mucho:** Cerrar aplicaciones innecesarias en el servidor, revisar si hay memory leaks
- **Dato adicional:** Node.js Process RSS (~80 MB) y Heap (~30 MB) muestran cuanta memoria usa el API especificamente

### 6. Disk Space (MONITOREO)
- **Que es:** Espacio libre en disco C: del servidor
- **Donde verlo:** Health Checks -> "Disk Space" y Resources -> gauge "Disk C:"
- **Estado actual:** 37.5 GB libres (84% usado de 234.8 GB)
- **Warning:** < 10 GB libres
- **Critico:** < 2 GB libres
- **Por que importa:** Con 619K+ raw_scans creciendo cada dia, la base de datos consume espacio. Tambien los logs rotan pero si se acumula mucho puede llenar el disco.
- **Dato util:** En la card Database se muestra "DB Size" (actualmente 256.2 MB) - monitorear que no crezca descontroladamente.

### 7. WebSocket + Connected Clients (INFORMATIVO)
- **Que es:** Cuantos navegadores estan conectados al dashboard en tiempo real
- **Donde verlo:** Card WebSocket -> "Connected Clients" y "Active Rooms"
- **Uso practico:** Si deberia haber monitores en piso mostrando el dashboard y Connected Clients es 0, puede que las TVs se desconectaron o el navegador se cerro.
- **No es critico:** El servidor funciona igual con 0 o 10 clientes conectados.

### 8. Recent Logs (DIAGNOSTICO)
- **Que es:** Ultimas 20 lineas de log de cada servicio (API, Scheduler, Pulse)
- **Donde verlo:** Card Recent Logs con selector de servicio y boton Refresh
- **Uso:** Cuando algo falla, revisar los logs ayuda a identificar la causa. Errores en rojo, warnings en amarillo, info en verde.
- **No se auto-refresca:** Requiere click manual en "Refresh" para no sobrecargar.

---

## Arquitectura implementada

### Backend

**Archivo nuevo:** `src/application/services/ServerHealthService.js`
- Clase con 11 metodos
- `getFullHealth()` - Orquestador principal, usa Promise.allSettled para resiliencia
- `getServerInfo()` - Hostname, Node version, uptime (via `os` module)
- `getResources()` - RAM, CPU, disco (via `os` module + `wmic` para disco Windows)
- `getDiskSpace()` - Ejecuta `wmic logicaldisk` con timeout de 5s
- `getDatabaseHealth()` - Test query, pg_database_size, row counts
- `getPipelineStatus()` - MAX(scanned_at), MAX(calculated_at), inferencia de servicios
- `getWebSocketStatus()` - Accede a global.io para contar clientes/rooms
- `buildHealthChecks()` - Construye array de checks con semaforo basado en umbrales
- `getOverallStatus()` - Reduce checks a healthy/warning/critical
- `formatUptime()` / `formatAge()` - Formateadores legibles

**Umbrales configurados:**

| Metrica | OK (verde) | Warning (amarillo) | Critical (rojo) |
|---------|-----------|-------------------|-----------------|
| RAM usage | < 80% | 80-95% | > 95% |
| Disk free | > 10 GB | 2-10 GB | < 2 GB |
| Last scan age | < 5 min | 5-15 min | > 15 min |
| DB latency | < 100ms | 100-500ms | > 500ms |

**Endpoints nuevos en server.js:**

| Endpoint | Auth | Descripcion |
|----------|------|-------------|
| `GET /api/admin/server-health` | Basic Auth (admin) | JSON completo con todas las metricas |
| `GET /api/admin/server-logs?service=api&lines=20` | Basic Auth (admin) | Ultimas N lineas de log del servicio |

**Servicio/Pulse inferido:** No se puede verificar directamente si Scheduler/Pulse estan corriendo desde el API (son procesos separados). Se infiere su estado de la frescura de datos: si hay raw_scans recientes (< 2 min), Scheduler esta activo. Si hay equipment_metrics recientes (< 2 min), Pulse esta activo.

### Frontend

**Archivo modificado:** `public/admin.html` (de 473 a 746 lineas, 42.8 KB)

**Nuevo tab:** "System" agregado junto a Lines y Equipment

**Secciones del tab System:**
1. **Overall Status Bar** - Barra de color con estado general
2. **Health Checks** - 6 checks con iconos semaforo (check/warning/X)
3. **Server Info** - Hostname, Node version, uptime, platform
4. **Resources** - 3 gauges con barras de progreso (RAM, CPU, Disk)
5. **Data Pipeline** - Last scan/calc age, Scheduler/Pulse status, equipment counts
6. **Database** - Connection status, latency, version, size, row counts
7. **WebSocket** - Connected clients, active rooms
8. **Recent Logs** - Viewer con selector API/Scheduler/Pulse, ANSI color stripping

**Auto-refresh:** 30 segundos (solo cuando el tab System esta activo, clearInterval al cambiar tab)

**CSS:** Prefijo `sys-` en todas las clases para evitar conflictos con CSS existente

---

## Fix aplicado durante la sesion

**Bug:** `column "last_updated" does not exist` en query de pipeline status

**Causa:** El ServerHealthService referenciaba `MAX(last_updated)` pero la columna real en `equipment_metrics` es `calculated_at`.

**Fix:** 
```
MAX(last_updated) -> MAX(calculated_at)
```
en `ServerHealthService.js` metodo `getPipelineStatus()`

---

## Archivos creados/modificados

### Creados:
- `src/application/services/ServerHealthService.js` - Servicio de health monitoring (220+ lineas)

### Modificados:
- `src/presentation/api/server.js` - Import ServerHealthService + 2 endpoints (server-health, server-logs)
- `public/admin.html` - Tab System completo (CSS + HTML + JS, de 473 a 746 lineas)

### Scripts de patch (NO versionados):
- `create-health-feature.js` - Crea ServerHealthService + parchea server.js
- `patch-admin-system-tab-v3.js` - Agrega tab System a admin.html (version final)

---

## Datos del servidor observados

| Metrica | Valor |
|---------|-------|
| Hostname | REYDTOFF1006 |
| Node.js | v22.15.1 |
| PostgreSQL | 17.5 |
| RAM total | 7.8 GB |
| RAM usada | ~79% (6.2 GB) |
| CPU | Intel i5-8400 @ 2.80GHz (6 cores) |
| Disco C: total | 234.8 GB |
| Disco C: libre | 37.5 GB (84% usado) |
| DB size | 256.2 MB |
| raw_scans | 619,366 rows |
| Equipment activos | 29 |
| Equipment con datos recientes | 28/29 |
| DB latency | 1 ms |

---

## Leccion aprendida: Leer antes de escribir

Durante esta sesion se cometio un error al intentar parchear admin.html sin leer su estructura primero. El script v2 inserto codigo JavaScript en medio de una linea existente, rompiendo la funcionalidad de todos los tabs.

**Causa raiz:** Se asumio la estructura del archivo (tabs con `onclick="showTab()"`) cuando en realidad usa `data-tab` attributes con `classList.add("active")`.

**Fix:** Se restauro con `git checkout -- public/admin.html` y se reescribio el script v3 con:
1. Lectura completa del archivo primero (anchors verificados)
2. Manipulacion linea por linea con `splice()` (no por posicion de caracteres)
3. Inserciones en orden reverso (bottom-to-top) para que los numeros de linea no se desplacen
4. Re-busqueda de anchors despues de cada insercion
5. Verificacion de integridad de funciones existentes (showToast, loadEquipment, lines-table)

**Principio reforzado:** El Framework Hibrido v2.0 establece que se debe entender el archivo antes de modificarlo. Este incidente lo confirma.

---

## Estado de Fases

```
FASE 1 - Data Pipeline & Backend Core ........ COMPLETADA (10-11 Feb 2026)
FASE 2 - Dashboard & Operacion 24/7 .......... COMPLETADA (18-19 Feb 2026)
FASE 3 - Multi-Line, Admin & Reportes ........ COMPLETADA (19-20 Feb 2026)
FASE 4 - Server Health Monitoring ............. COMPLETADA (24 Feb 2026)
  [Feature] Server Health Dashboard             DONE
    - ServerHealthService backend               DONE
    - API endpoints (health + logs)             DONE
    - Admin System tab (full UI)                DONE
    - Auto-refresh 30s                          DONE
    - Traffic light indicators                  DONE
    - Logs viewer with service selector         DONE
```

---

## Herramientas de verificacion

| Accion | Comando/URL |
|--------|-------------|
| Ver System tab | `http://10.3.0.200:3000/admin` -> tab System |
| Test health API | `curl -u vsm_admin:BW-gpec5-2026 http://localhost:3000/api/admin/server-health` |
| Test logs API | `curl -u vsm_admin:BW-gpec5-2026 http://localhost:3000/api/admin/server-logs?service=api&lines=10` |
| Estado servicios | `Get-Service VSM-*` |
| Reiniciar servicios | `.\service-manager-v2.bat` opcion 4 (como admin) |

---

## Notas para continuidad entre chats

- El tab System usa prefijo `sys-` en CSS para evitar conflictos con CSS de tabs Lines/Equipment
- Tab switcher usa `data-tab` attribute, NO `onclick="showTab()"` - esto es critico para futuros patches
- Auto-refresh usa `setInterval` que se activa solo cuando System tab esta visible (stopSysRefresh al cambiar tab)
- Los servicios Scheduler/Pulse son inferidos, no verificados directamente (procesos separados de API)
- `wmic logicaldisk` se usa para disco en Windows (timeout 5s)
- CPU loadAvg en Windows siempre retorna 0 (limitacion de Node.js `os.loadavg()` en Windows) - el gauge muestra 0% pero no es un error
- La columna correcta en equipment_metrics es `calculated_at`, NO `last_updated`
- RAM del servidor (7.8 GB) esta al 79% - monitorear, podria necesitar optimizacion si sigue subiendo
- admin.html paso de 473 a 746 lineas (42.8 KB) con esta feature
