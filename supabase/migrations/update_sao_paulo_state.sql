-- Atualizar o campo State para 'SP' para todos os itens com city igual a 'São Paulo'
-- Tabela: core.attractions

UPDATE core.attractions 
SET state = 'SP' 
WHERE city IN ('São Paulo', 'Atibaia', 'Barueri', 'Cotia');

-- Verificar quantos registros foram atualizados
-- SELECT COUNT(*) FROM core.attractions WHERE city = 'São Paulo' AND state = 'SP';