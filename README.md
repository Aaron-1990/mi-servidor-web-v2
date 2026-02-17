# VSM Production Monitoring System

Sistema de monitoreo de Value Stream Map para lineas de produccion BorgWarner GPEC5.

## Requisitos

- Node.js 18+
- PostgreSQL 15+

## Instalacion
```bash
npm install
```

## Configuracion

1. Copiar `.env.example` a `.env`
2. Configurar variables de base de datos
3. Ejecutar migraciones

## Uso
```bash
# Desarrollo
npm run dev

# Produccion
npm start

# Solo extractor CSV
npm run extractor

# Solo calculador CT
npm run calculator
```

## Estructura
```
vsm-system/
├── config/          # Configuracion (DB, logger, env)
├── scripts/         # Scripts de procesamiento
├── database/        # Migraciones y seeds
├── src/             # Codigo fuente
│   ├── domain/      # Entidades y servicios
│   ├── infrastructure/  # Repositorios y externos
│   └── presentation/    # API y WebSocket
├── public/          # Frontend estatico
└── logs/            # Archivos de log
```

## Autor

Aaron Zapata - BorgWarner Industrial Engineering
