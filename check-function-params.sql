-- Verificar os parâmetros EXATOS da função que existe no banco
SELECT 
  p.parameter_name,
  p.data_type,
  p.parameter_mode,
  p.ordinal_position,
  p.parameter_default
FROM information_schema.parameters p
JOIN information_schema.routines r 
  ON p.specific_name = r.specific_name 
  AND p.specific_schema = r.routine_schema
WHERE r.routine_schema = 'core' 
  AND r.routine_name = 'update_boundary_geometry'
ORDER BY p.ordinal_position;

