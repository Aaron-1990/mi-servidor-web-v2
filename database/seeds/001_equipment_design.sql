-- ============================================================================
-- VSM PRODUCTION SYSTEM - SEED DATA
-- Seed: 001_equipment_design.sql
-- ============================================================================

-- EQUIPOS GPEC5 - Datos de diseno
INSERT INTO equipment_design (equipment_id, equipment_name, process_name, csv_url, design_ct, target_oee, equipment_type, is_parallel) VALUES

-- Wave Solder (1 equipo - secuencial)
('WAVESOLDER_01', 'Wave Solder', 'Wave Solder', 
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_WAVESOLDER.csv',
 45.00, 85.00, 'BCMP_ONLY', false),

-- Continuity Test (3 equipos - paralelos)
('CONTINUITY_01', 'Continuity Test 1', 'Continuity Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_CONTINUITY_GPEC5_CONT01.csv',
 30.00, 85.00, 'BREQ_BCMP', true),

('CONTINUITY_02', 'Continuity Test 2', 'Continuity Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_CONTINUITY_GPEC5_CONT02.csv',
 30.00, 85.00, 'BREQ_BCMP', true),

('CONTINUITY_03', 'Continuity Test 3', 'Continuity Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_CONTINUITY_GPEC5_CONT03.csv',
 30.00, 85.00, 'BREQ_BCMP', true),

-- Plasma (2 equipos - paralelos)
('PLASMA_R1', 'Plasma R1', 'Plasma Treatment',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_PLASMA_GPEC5STA3.csv',
 25.00, 85.00, 'BREQ_BCMP', true),

('PLASMA_R2', 'Plasma R2', 'Plasma Treatment',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_PLASMA_GPEC5STA3_B.csv',
 25.00, 85.00, 'BREQ_BCMP', true),

-- PCB Press (2 equipos - paralelos)
('PCBPRESS_R1', 'PCB Press R1', 'PCB Press',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_PCBPRESS_GPEC5STA4.csv',
 35.00, 85.00, 'BREQ_BCMP', true),

('PCBPRESS_R2', 'PCB Press R2', 'PCB Press',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_PCBPRESS_GPEC5STA4_B.csv',
 35.00, 85.00, 'BREQ_BCMP', true),

-- Cover Dispense (2 equipos - paralelos)
('COVERDISP_R1', 'Cover Dispense R1', 'Cover Dispense',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_COVERDISP_GPEC5STA5.csv',
 20.00, 85.00, 'BREQ_BCMP', true),

('COVERDISP_R2', 'Cover Dispense R2', 'Cover Dispense',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_COVERDISP_GPEC5STA5_B.csv',
 20.00, 85.00, 'BREQ_BCMP', true),

-- Cover Press (2 equipos - paralelos)
('COVERPRESS_R1', 'Cover Press R1', 'Cover Press',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_COVERPRESS_GPEC5STA6.csv',
 40.00, 85.00, 'BREQ_BCMP', true),

('COVERPRESS_R2', 'Cover Press R2', 'Cover Press',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_COVERPRESS_GPEC5STA6_B.csv',
 40.00, 85.00, 'BREQ_BCMP', true),

-- Hot Test HTFT (10 equipos - paralelos)
('HTFT_01', 'Hot Test 1', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_01.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_02', 'Hot Test 2', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_02.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_03', 'Hot Test 3', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_03.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_04', 'Hot Test 4', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_04.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_06', 'Hot Test 6', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_06.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_07', 'Hot Test 7', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_07.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_08', 'Hot Test 8', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_08.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_09', 'Hot Test 9', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_09.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_10', 'Hot Test 10', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_10.csv',
 60.00, 85.00, 'BREQ_BCMP', true),

('HTFT_11', 'Hot Test 11', 'Hot Test',
 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_HTFT_HTFT_11.csv',
 60.00, 85.00, 'BREQ_BCMP', true);

-- LINEA DE PRODUCCION GPEC5
INSERT INTO production_lines (line_name, line_code, description, takt_time, target_output, shift_hours) VALUES
('GPEC5 Main Line', 'GPEC5_L1', 'Linea principal de produccion GPEC5', 45.00, 640, 8.00);