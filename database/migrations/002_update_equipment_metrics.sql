-- Actualizar tabla equipment_metrics con nuevas columnas
ALTER TABLE equipment_metrics 
    DROP COLUMN IF EXISTS calculated_ct,
    DROP COLUMN IF EXISTS ct_process,
    DROP COLUMN IF EXISTS pieces_ok,
    DROP COLUMN IF EXISTS pieces_ng,
    DROP COLUMN IF EXISTS pieces_total,
    DROP COLUMN IF EXISTS sample_size,
    DROP COLUMN IF EXISTS outliers_removed,
    DROP COLUMN IF EXISTS oee_current;

ALTER TABLE equipment_metrics
    ADD COLUMN IF NOT EXISTS ct_equipo_realtime DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS ct_proceso_realtime DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS last_serial VARCHAR(50),
    ADD COLUMN IF NOT EXISTS last_scan_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ct_equipo_hour DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS ct_proceso_hour DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS pieces_ok_hour INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pieces_ng_hour INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS samples_hour INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stddev_hour DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS ct_equipo_shift DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS ct_proceso_shift DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS pieces_ok_shift INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pieces_ng_shift INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS samples_shift INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stddev_shift DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS shift_name VARCHAR(20),
    ADD COLUMN IF NOT EXISTS shift_start TIMESTAMP;