-- Teste direto para United States
SELECT 
  a.id,
  a.name,
  a.city,
  a.state,
  a.country,
  a.approved
FROM core.attractions a
WHERE a.country = 'United States'
LIMIT 10;
