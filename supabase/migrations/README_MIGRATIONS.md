# Migrations - Guia de Referência

Este documento descreve as migrations relacionadas a POIs e Coordinates no schema `homolog`.

## ⚠️ Migrations Removidas (Perigosas ou Obsoletas)

As seguintes migrations foram **removidas** por segurança:

1. **`20250128_drop_pois_and_coordinates.sql`** - ❌ REMOVIDA
   - **Motivo**: Contém `DROP TABLE` que apaga todos os dados
   - **Risco**: Alto - perda total de dados

2. **`20250128_fix_create_poi_with_uuid_duplicates.sql`** - ❌ REMOVIDA
   - **Motivo**: Duplicada - funções já estão em `20250128_fix_boundary_geometry_type.sql`
   - **Risco**: Baixo - apenas redundância

## ✅ Migrations Finais (Mantidas)

### Migrations Essenciais (em ordem cronológica):

1. **`20241220000001_create_pois_table_homolog.sql`**
   - Cria tabela inicial `homolog.pois`
   - **Status**: Mantida (histórico)

2. **`20241220000002_create_coordinates_table_homolog.sql`**
   - Cria tabela inicial `homolog.coordinates`
   - **Status**: Mantida (histórico)

3. **`20250128_recreate_pois_and_coordinates.sql`**
   - Recria tabelas com schema completo e UUID
   - **⚠️ CUIDADO**: Tem DROP TABLE comentado (NUNCA descomentar)
   - **Status**: Mantida (criação de schema)

4. **`20250128_change_coordinates_to_uuid_and_geography.sql`**
   - Converte `coordinates.id` de SERIAL para UUID
   - Converte `boundary_geometry` de TEXT para GEOGRAPHY
   - **Status**: Mantida (conversão de tipos)

5. **`20250128_fix_boundary_geometry_type.sql`** ⭐ **FINAL**
   - **MIGRATION MAIS IMPORTANTE** - Contém todas as funções finais:
     - `generate_poi_uuid_simple`
     - `create_poi_with_uuid`
     - `get_coordinates_paginated`
     - `upsert_coordinate`
   - Converte `boundary_geometry` de TEXT para GEOGRAPHY (se necessário)
   - **Status**: Mantida (funções finais e correções)

6. **`20250128_fix_get_pois_paginated_primary_category.sql`**
   - Corrige função `get_pois_paginated` para retornar `primary_category`
   - **Status**: Mantida (correção específica)

7. **`20250128_fix_existing_duplicates.sql`**
   - Corrige duplicatas existentes no banco
   - **Status**: Mantida (limpeza de dados)

## 📋 Ordem de Aplicação Recomendada

Se precisar aplicar migrations manualmente:

1. Criar schema e tabelas base (migrations antigas)
2. `20250128_recreate_pois_and_coordinates.sql` (se tabelas não existirem)
3. `20250128_change_coordinates_to_uuid_and_geography.sql` (conversão de tipos)
4. `20250128_fix_boundary_geometry_type.sql` ⭐ (funções finais - ESSENCIAL)
5. `20250128_fix_get_pois_paginated_primary_category.sql` (correção específica)
6. `20250128_fix_existing_duplicates.sql` (limpeza, se necessário)

## 🔒 Segurança

- **NUNCA** descomentar linhas com `DROP TABLE` em migrations
- **SEMPRE** verificar conteúdo de migrations antes de aplicar
- **SEMPRE** fazer backup antes de aplicar migrations que alteram tipos de dados
- A migration `20250128_fix_boundary_geometry_type.sql` é a **migration final** e contém todas as funções corretas

## 📝 Notas

- Todas as funções importantes estão em `20250128_fix_boundary_geometry_type.sql`
- Migrations antigas são mantidas apenas para histórico
- A migration `20250128_recreate_pois_and_coordinates.sql` tem DROP TABLE comentado - NUNCA descomentar




