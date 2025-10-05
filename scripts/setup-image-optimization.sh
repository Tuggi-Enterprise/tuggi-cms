#!/bin/bash

# Script para configurar otimização de imagens
# Instala dependências necessárias e configura o ambiente

echo "🖼️  Configurando Otimização de Imagens"
echo "====================================="

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Execute este script no diretório raiz do projeto"
    exit 1
fi

echo "📦 Instalando dependências..."

# Instalar Sharp para processamento de imagens
echo "   🔧 Instalando Sharp..."
npm install sharp

# Instalar tipos do Sharp
echo "   🔧 Instalando tipos do Sharp..."
npm install --save-dev @types/sharp

echo ""
echo "✅ Dependências instaladas com sucesso!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Execute: npx tsx scripts/test-image-resize.ts"
echo "   2. Execute: npx tsx scripts/analyze-and-resize-images.ts"
echo "   3. Teste a Edge Function atualizada"
echo ""
echo "🎯 Funcionalidades implementadas:"
echo "   • Redimensionamento automático para 1024x1024"
echo "   • Criação de thumbnails 300x300"
echo "   • Compressão com qualidade 85%"
echo "   • Análise de imagens existentes"
echo "   • Relatórios de economia de espaço"
echo ""
echo "🚀 Sistema pronto para otimização de imagens!"
