#!/bin/bash

# 🚀 Deploy RLS sem CLI
# Alternativa para quando o Supabase CLI tem problemas de sincronização
# 
# Este script cria um arquivo de setup que você pode copiar/colar no SQL Editor
# do Supabase Dashboard

echo "📋 Criando arquivo para deploy manual..."

# Arquivo que contém a migração
MIGRATION_FILE="/Users/despossivel/Documents/workspace/tuggi-cms/supabase/migrations/20260115000000_enable_row_level_security.sql"

# Arquivo de output
OUTPUT_FILE="/Users/despossivel/Documents/workspace/tuggi-cms/RLS_DEPLOY_MANUAL.sql"

echo "-- ============================================"                              > "$OUTPUT_FILE"
echo "-- 🔒 RLS Deployment Script"                                               >> "$OUTPUT_FILE"
echo "-- ============================================"                            >> "$OUTPUT_FILE"
echo "-- "                                                                       >> "$OUTPUT_FILE"
echo "-- INSTRUÇÕES:"                                                           >> "$OUTPUT_FILE"
echo "-- 1. Abra Supabase Dashboard"                                            >> "$OUTPUT_FILE"
echo "-- 2. Vá para SQL Editor"                                                 >> "$OUTPUT_FILE"
echo "-- 3. Clique em 'New Query'"                                              >> "$OUTPUT_FILE"
echo "-- 4. Cole TODO o conteúdo abaixo"                                        >> "$OUTPUT_FILE"
echo "-- 5. Clique em 'Run'"                                                    >> "$OUTPUT_FILE"
echo "-- "                                                                      >> "$OUTPUT_FILE"
echo "-- Tempo estimado: 2-3 minutos"                                           >> "$OUTPUT_FILE"
echo "-- "                                                                      >> "$OUTPUT_FILE"
echo "-- ============================================"                           >> "$OUTPUT_FILE"
echo ""                                                                          >> "$OUTPUT_FILE"

# Copiar conteúdo da migração
cat "$MIGRATION_FILE" >> "$OUTPUT_FILE"

echo ""                                                                          >> "$OUTPUT_FILE"
echo "-- ============================================"                           >> "$OUTPUT_FILE"
echo "-- ✅ Verificação"                                                        >> "$OUTPUT_FILE"
echo "-- ============================================"                           >> "$OUTPUT_FILE"
echo "-- Executar após o script acima para confirmar:"                          >> "$OUTPUT_FILE"
echo ""                                                                          >> "$OUTPUT_FILE"
echo "SELECT tablename, rowsecurity"                                            >> "$OUTPUT_FILE"
echo "FROM pg_tables"                                                           >> "$OUTPUT_FILE"
echo "WHERE schemaname = 'core'"                                                >> "$OUTPUT_FILE"
echo "ORDER BY tablename;"                                                      >> "$OUTPUT_FILE"

echo "✅ Arquivo criado: $OUTPUT_FILE"
echo ""
echo "📋 Conteúdo pronto para copiar/colar no Supabase Dashboard SQL Editor"
