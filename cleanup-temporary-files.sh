#!/bin/bash

# Script para remover arquivos temporários, de teste e desnecessários
# Mantém apenas arquivos essenciais para o funcionamento do projeto

echo "🧹 Iniciando limpeza de arquivos temporários e desnecessários..."

# Contador de arquivos removidos
REMOVED_COUNT=0

echo ""
echo "🗑️  REMOVENDO RELATÓRIOS DE ANÁLISE (JSON)..."

# Remover relatórios de análise JSON (dados temporários)
REPORT_FILES=(
    "scripts/auto-cleanup-report.json"
    "scripts/data-integrity-report.json"
    "scripts/duplicate-coordinates-report.json"
    "scripts/quick-duplicate-analysis.json"
    "scripts/safe-cleanup-report.json"
    "scripts/simple-cleanup-report.json"
    "scripts/fixed-pois-without-coordinates-report.json"
    "scripts/pois-without-coordinates-report.json"
)

for file in "${REPORT_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo relatório: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO ARQUIVOS DE BACKUP E REFATORAÇÃO..."

# Remover arquivos de backup e refatoração
BACKUP_FILES=(
    "app/poi-importer/page-refactored.tsx"
    "app/pois/page-backup.tsx"
)

for file in "${BACKUP_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo backup: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO ARQUIVOS DE CACHE E BUILD..."

# Remover arquivos de cache e build (já no .gitignore, mas podem existir localmente)
CACHE_FILES=(
    ".next/cache"
    "tsconfig.tsbuildinfo"
    "supabase/.temp"
)

for file in "${CACHE_FILES[@]}"; do
    if [ -d "$file" ] || [ -f "$file" ]; then
        echo "❌ Removendo cache: $file"
        rm -rf "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO ARQUIVOS DE LOG..."

# Remover arquivos de log
LOG_FILES=(
    "node_modules/@supabase/auth-helpers-nextjs/.turbo/turbo-build.log"
    "node_modules/@supabase/auth-helpers-react/.turbo/turbo-build.log"
)

for file in "${LOG_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo log: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO ARQUIVOS .OLD..."

# Remover arquivos .old
OLD_FILES=(
    ".next/cache/webpack/client-production/index.pack.old"
    ".next/cache/webpack/client-development/index.pack.gz.old"
    ".next/cache/webpack/edge-server-production/index.pack.old"
    ".next/cache/webpack/edge-server-development/index.pack.old"
    ".next/cache/webpack/server-development/index.pack.gz.old"
    ".next/cache/webpack/client-development-fallback/index.pack.gz.old"
    ".next/cache/webpack/server-production/index.pack.old"
)

for file in "${OLD_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo arquivo .old: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO SCRIPTS DE MIGRAÇÃO TEMPORÁRIOS..."

# Remover scripts de migração temporários (já executados)
MIGRATION_SCRIPTS=(
    "scripts/fix-import-paths.ts"
    "scripts/fix-remaining-createclient.ts"
    "scripts/migrate-supabase-clients.ts"
    "scripts/migrate-api-calls.ts"
    "scripts/fix-api-migration-errors.ts"
    "scripts/fix-final-createclient.ts"
)

for file in "${MIGRATION_SCRIPTS[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo script de migração: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO SCRIPTS DE TESTE E DEBUG..."

# Remover scripts de teste e debug (já executados)
TEST_SCRIPTS=(
    "scripts/test-env.ts"
    "scripts/test-rpc-function.ts"
    "scripts/test-rpc-large-limit.ts"
    "scripts/test-sql-condition.ts"
    "scripts/test-unique-constraint.ts"
    "scripts/test-batch-loading.ts"
    "scripts/quick-city-test.ts"
    "scripts/run-small-production-test.ts"
    "scripts/debug-coordinate-check.ts"
    "scripts/debug-rpc-count.ts"
    "scripts/debug-rpc-query.ts"
)

for file in "${TEST_SCRIPTS[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo script de teste: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO SCRIPTS DE ANÁLISE JÁ EXECUTADOS..."

# Remover scripts de análise já executados
ANALYSIS_SCRIPTS=(
    "scripts/analyze-data-integrity.ts"
    "scripts/analyze-duplicate-coordinates.ts"
    "scripts/analyze-duplicate-coordinates-simple.ts"
    "scripts/analyze-pois-for-batch.ts"
    "scripts/check-all-pois.ts"
    "scripts/check-pois-count.ts"
    "scripts/check-pois-with-photos.ts"
    "scripts/check-pois-without-coordinates.ts"
    "scripts/check-errors.ts"
    "scripts/check-migration-status.ts"
    "scripts/check-rls-policies.ts"
    "scripts/check-wikimedia-attractions.ts"
    "scripts/check-wikimedia-google-ids.ts"
    "scripts/check-wikipedia-sources.ts"
    "scripts/check-google-images.ts"
    "scripts/check-image-sources.ts"
    "scripts/check-other-urls.ts"
    "scripts/check-and-update-image-urls.ts"
    "scripts/investigate-attraction-data.ts"
    "scripts/investigate-poi-count.ts"
    "scripts/investigate-wikidata-images.ts"
    "scripts/quick-duplicate-analysis.ts"
    "scripts/security-audit.ts"
)

for file in "${ANALYSIS_SCRIPTS[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo script de análise: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO SCRIPTS DE LIMPEZA JÁ EXECUTADOS..."

# Remover scripts de limpeza já executados
CLEANUP_SCRIPTS=(
    "scripts/cleanup-duplicate-coordinates.ts"
    "scripts/cleanup-duplicate-coordinates.sql"
    "scripts/cleanup-attraction-images.ts"
    "scripts/cleanup-orphaned-images.ts"
    "scripts/execute-final-cleanup.ts"
    "scripts/safe-cleanup-duplicates.ts"
    "scripts/simple-cleanup-duplicates.ts"
    "scripts/duplicate-pois-checker.ts"
    "scripts/auto-cleanup-report.json"
    "scripts/backup-duplicate-coordinates.sql"
    "scripts/basic-cleanup-duplicates.sql"
    "scripts/rollback-duplicate-cleanup.sql"
    "scripts/run-duplicate-check.sh"
)

for file in "${CLEANUP_SCRIPTS[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo script de limpeza: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "🗑️  REMOVENDO SCRIPTS DE MONITORAMENTO JÁ EXECUTADOS..."

# Remover scripts de monitoramento já executados
MONITORING_SCRIPTS=(
    "scripts/monitor-all-image-sources.ts"
    "scripts/monitor-unified-processing.ts"
    "scripts/monitor-website-processing.ts"
    "scripts/monitor-wikimedia-migration.ts"
    "scripts/monitor-wikipedia-replacement-progress.ts"
)

for file in "${MONITORING_SCRIPTS[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ Removendo script de monitoramento: $file"
        rm "$file"
        ((REMOVED_COUNT++))
    fi
done

echo ""
echo "✅ Limpeza concluída!"
echo "📊 Arquivos removidos: $REMOVED_COUNT"
echo ""
echo "🎯 ARQUIVOS MANTIDOS (essenciais):"
echo "   - Scripts de processamento ativo"
echo "   - Scripts de utilitários"
echo "   - Scripts de configuração"
echo "   - Scripts de produção"
echo ""
echo "💾 ECONOMIA DE ESPAÇO:"
echo "   - Relatórios JSON removidos"
echo "   - Scripts de migração temporários removidos"
echo "   - Scripts de teste e debug removidos"
echo "   - Scripts de análise já executados removidos"
echo "   - Arquivos de cache e build removidos"
echo ""
echo "🎉 Projeto agora está limpo e otimizado!"
