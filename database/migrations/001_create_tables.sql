-- ============================================================================
-- VSM PRODUCTION SYSTEM - DATABASE SCHEMA
-- Migration: 001_create_tables.sql
-- ============================================================================

-- TABLA: equipment_design
CREATE TABLE IF NOT EXISTS equipment_design (
    id SERIAL PRIMARY KEY,
    equipment_id VARCHAR(50) UNIQUE NOT NULL,
    equipment_name VARCHAR(100) NOT NULL,
    process_name VARCHAR(100) NOT NULL,
    csv_url TEXT,
    design_ct DECIMAL(10,2) NOT NULL,
    target_oee DECIMAL(5,2) DEFAULT 85.00,
    equipment_type VARCHAR(20) DEFAULT 'BREQ_BCMP',
    is_parallel BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_equipment_type CHECK (equipment_type IN ('BREQ_BCMP', 'BCMP_ONLY')),
    CONSTRAINT chk_design_ct_positive CHECK (design_ct > 0),
    CONSTRAINT chk_target_oee_range CHECK (target_oee >= 0 AND target_oee <= 100)
);

-- TABLA: raw_scans
CREATE TABLE IF NOT EXISTS raw_scans (
    id BIGSERIAL PRIMARY KEY,
    equipment_id VARCHAR(50) NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    scanned_at TIMESTAMP NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_equipment FOREIGN KEY (equipment_id) 
        REFERENCES equipment_design(equipment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_raw_scans_equipment_id ON raw_scans(equipment_id);
CREATE INDEX IF NOT EXISTS idx_raw_scans_scanned_at ON raw_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_scans_serial ON raw_scans(serial_number);
CREATE INDEX IF NOT EXISTS idx_raw_scans_status ON raw_scans(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_scans_unique 
    ON raw_scans(equipment_id, serial_number, scanned_at);

-- TABLA: equipment_metrics
CREATE TABLE IF NOT EXISTS equipment_metrics (
    id SERIAL PRIMARY KEY,
    equipment_id VARCHAR(50) NOT NULL,
    calculated_ct DECIMAL(10,2),
    ct_process DECIMAL(10,2),
    pieces_ok INTEGER DEFAULT 0,
    pieces_ng INTEGER DEFAULT 0,
    pieces_total INTEGER DEFAULT 0,
    oee_current DECIMAL(5,2),
    outlier_count INTEGER DEFAULT 0,
    outlier_percentage DECIMAL(5,2),
    std_deviation DECIMAL(10,4),
    min_ct DECIMAL(10,2),
    max_ct DECIMAL(10,2),
    sample_size INTEGER DEFAULT 0,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_equipment_metrics FOREIGN KEY (equipment_id) 
        REFERENCES equipment_design(equipment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_equipment_metrics_equipment ON equipment_metrics(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_metrics_calculated_at ON equipment_metrics(calculated_at DESC);

-- TABLA: production_lines
DROP TABLE IF EXISTS line_processes;
DROP TABLE IF EXISTS production_lines CASCADE;

CREATE TABLE production_lines (
    id SERIAL PRIMARY KEY,
    line_name VARCHAR(100) NOT NULL,
    line_code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    takt_time DECIMAL(10,2),
    target_output INTEGER,
    shift_hours DECIMAL(4,2) DEFAULT 8.00,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLA: line_processes
CREATE TABLE line_processes (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL,
    equipment_id VARCHAR(50) NOT NULL,
    process_order INTEGER NOT NULL,
    is_parallel BOOLEAN DEFAULT false,
    parallel_group INTEGER,
    is_bottleneck BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_line FOREIGN KEY (line_id) 
        REFERENCES production_lines(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_process FOREIGN KEY (equipment_id) 
        REFERENCES equipment_design(equipment_id) ON DELETE CASCADE,
    CONSTRAINT unique_line_equipment UNIQUE (line_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_line_processes_line ON line_processes(line_id);
CREATE INDEX IF NOT EXISTS idx_line_processes_order ON line_processes(line_id, process_order);

-- FUNCION: updated_at automatico
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_equipment_design_updated_at ON equipment_design;
CREATE TRIGGER update_equipment_design_updated_at
    BEFORE UPDATE ON equipment_design
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_production_lines_updated_at ON production_lines;
CREATE TRIGGER update_production_lines_updated_at
    BEFORE UPDATE ON production_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- PERMISOS
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vsm_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vsm_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vsm_admin;