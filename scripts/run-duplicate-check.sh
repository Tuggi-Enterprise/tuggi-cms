#!/bin/bash

# Script para executar verificação de POIs duplicados
# Estados: SP, RJ, MG

echo "🔍 Verificação de POIs Duplicados"
echo "=================================="
echo "Estados: SP, RJ, MG"
echo "Critério: Mesmo nome, mesma cidade, distância < 100m"
echo ""

# Verificar se as variáveis de ambiente estão configuradas
if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Erro: Variáveis de ambiente do Supabase não configuradas"
    echo "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Verificar se tsx está instalado
if ! command -v tsx &> /dev/null; then
    echo "📦 Instalando tsx..."
    npm install -g tsx
fi

# Criar diretório de relatórios se não existir
mkdir -p reports

echo "🚀 Iniciando verificação..."
echo ""

# Executar verificação
npx tsx scripts/duplicate-pois-checker.ts

echo ""
echo "✅ Verificação concluída!"
echo "📁 Relatórios salvos em: ./reports/"
echo ""
echo "🌐 Para visualizar na interface web:"
echo "   http://localhost:3000/duplicate-pois"
echo ""
echo "🧪 Para executar testes:"
echo "   npx tsx scripts/test-duplicate-check.ts"
