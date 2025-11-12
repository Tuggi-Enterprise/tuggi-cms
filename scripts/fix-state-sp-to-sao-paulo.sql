-- Corrigir estados SP para São Paulo
UPDATE core.attractions SET state = 'São Paulo', updated_at = NOW()
WHERE UPPER(TRIM(state)) = 'SP' OR TRIM(state) IN ('sp', 'Sp', 'sP', 'SP', 'sp.', 'Sp.', 'SP.');

