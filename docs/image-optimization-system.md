# Sistema de Otimização de Imagens

## 📋 Visão Geral

Este sistema implementa otimização automática de imagens para reduzir o espaço de armazenamento no bucket Supabase, mantendo a qualidade visual adequada para o aplicativo.

## 🎯 Objetivos

- **Reduzir tamanho das imagens**: Máximo 1024x1024 pixels
- **Economizar espaço**: Redução estimada de 60-80% no tamanho dos arquivos
- **Melhorar performance**: Carregamento mais rápido das imagens
- **Criar thumbnails**: Versões otimizadas para listas (300x300)

## 🏗️ Arquitetura

### Componentes Principais

1. **`supabase/lib/imageResizer.ts`** - Utilitário de redimensionamento para Edge Functions
2. **`scripts/analyze-and-resize-images.ts`** - Script para analisar e redimensionar imagens existentes
3. **`scripts/test-image-resize.ts`** - Script de teste da funcionalidade
4. **`scripts/migrate-and-optimize-wikimedia.ts`** - Script integrado para migrar e otimizar imagens do Wikimedia
5. **`scripts/universal-image-optimizer.ts`** - Script universal para otimizar todas as imagens do projeto
6. **`scripts/cleanup-orphaned-images.ts`** - Script para limpeza de imagens órfãs no storage
7. **Edge Functions atualizadas** - Processamento automático no upload
8. **`core.attraction_image`** - Tabela otimizada para metadados de imagens

### Estrutura do Banco de Dados

#### Tabela `core.attraction_image` (Otimizada)

```sql
CREATE TABLE core.attraction_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  image_url text,                    -- URL da imagem principal otimizada
  thumbnail_url text,                -- URL do thumbnail (300x300)
  alt_text text,                     -- Texto alternativo
  storage_path text,                 -- Caminho no bucket Supabase
  photo_reference text,              -- Referência da foto original
  image_source text DEFAULT 'unknown', -- Fonte: google_places, wikimedia_commons, etc.
  
  -- Metadados de otimização
  image_optimization_data jsonb,     -- Dados completos de otimização
  image_processing_status text DEFAULT 'pending', -- Status do processamento
  image_processed_at timestamp with time zone,    -- Timestamp do processamento
  
  -- Dimensões e qualidade
  image_width integer,               -- Largura em pixels
  image_height integer,              -- Altura em pixels
  image_file_size_bytes bigint,      -- Tamanho do arquivo em bytes
  image_format text,                 -- Formato: jpeg, png, webp
  image_quality_score numeric(5,2),  -- Score de qualidade (0-100)
  
  created_at timestamp with time zone DEFAULT now()
);
```

#### Tabela `core.attractions` (Simplificada)

```sql
-- Campos relacionados a imagens na tabela attractions
image_url text,                      -- URL da imagem principal (referência)
thumbnail_url text,                  -- URL do thumbnail (300x300) - denormalizado para performance
image_source text DEFAULT 'unknown'  -- Fonte da imagem principal
```

### Fluxo de Processamento

```
Imagem Original → Análise → Redimensionamento → Thumbnail → Armazenamento
     ↓              ↓           ↓              ↓           ↓
  1600x1200    → Metadados → 1024x768    → 300x300  → Bucket
  2.5MB        → Dimensões → 800KB       → 50KB     → Otimizado
```

### Estratégia de Denormalização

#### **Performance vs Normalização**

Para otimizar performance em listagens, implementamos uma **denormalização controlada**:

```sql
-- attraction_image (Fonte da Verdade)
image_url text,           -- URL da imagem otimizada
thumbnail_url text,       -- URL do thumbnail
image_optimization_data jsonb, -- Metadados completos

-- attractions (Cache de Performance)
image_url text,           -- URL da imagem principal (denormalizado)
thumbnail_url text,       -- URL do thumbnail (denormalizado)
image_source text         -- Fonte da imagem
```

#### **Vantagens da Denormalização:**

1. **Performance**: Queries simples sem JOINs
2. **UX**: Carregamento mais rápido de listas
3. **Simplicidade**: Frontend mais simples
4. **Escalabilidade**: Melhor performance com muitos registros

#### **Sincronização:**

- **`attraction_image`** → Fonte da verdade (dados completos)
- **`attractions`** → Cache denormalizado (performance)
- **Scripts/Triggers** → Manter sincronização automática

## 🚀 Instalação e Configuração

### 1. Instalar Dependências

```bash
# Executar script de configuração
./scripts/setup-image-optimization.sh

# Ou manualmente:
npm install sharp
npm install --save-dev @types/sharp
```

### 2. Configurar Variáveis de Ambiente

Certifique-se de que as seguintes variáveis estão configuradas:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_key
```

## 📊 Análise de Imagens Existentes

### Executar Análise Completa

```bash
npx tsx scripts/analyze-and-resize-images.ts
```

**Funcionalidades:**
- Lista todas as imagens no bucket
- Analisa dimensões e tamanhos
- Identifica imagens que precisam redimensionar
- Redimensiona automaticamente
- Gera backup das originais
- Relatório detalhado de economia

## 🔄 Migração e Otimização do Wikimedia

### Executar Migração Integrada

```bash
npx tsx scripts/migrate-and-optimize-wikimedia.ts
```

**Funcionalidades:**
- Migra imagens do Wikimedia Commons para Supabase Storage
- Otimiza automaticamente durante a migração
- Cria thumbnails para cada imagem
- Relatório detalhado de economia de espaço
- Processamento em lote com rate limiting
- Validação de tamanho de arquivo

## 🌐 Otimizador Universal de Imagens

### Executar Otimização Universal

```bash
npx tsx scripts/universal-image-optimizer.ts
```

**Funcionalidades:**
- Processa **todas** as imagens do projeto (Supabase, Google, Wikimedia, externas)
- Otimiza imagens já no Supabase (se necessário)
- Migra imagens externas para o bucket com otimização
- **Exclui automaticamente** imagens antigas do Supabase
- Cria thumbnails para todas as imagens
- Relatório detalhado por fonte de imagem
- Detecção inteligente de necessidade de otimização

## 🧹 Limpeza de Imagens Órfãs

### Executar Limpeza

```bash
npx tsx scripts/cleanup-orphaned-images.ts
```

**Funcionalidades:**
- Identifica imagens no storage não referenciadas no banco
- Calcula espaço que pode ser liberado
- Remove imagens órfãs com segurança
- Relatório detalhado de limpeza
- Validação antes da exclusão

### Exemplo de Saída - Análise Geral

```
📊 RELATÓRIO DE OTIMIZAÇÃO DE IMAGENS
=====================================

📈 Estatísticas Gerais:
   Total de imagens: 1,250
   Imagens analisadas: 1,250
   Imagens que precisavam redimensionar: 890
   Imagens redimensionadas com sucesso: 885
   Erros: 5

💾 Economia de Espaço:
   Tamanho original total: 2.1 GB
   Tamanho novo total: 650 MB
   Espaço economizado: 1.45 GB
   Percentual de economia: 69.0%
```

### Exemplo de Saída - Migração Wikimedia

```
🚀 Starting Wikimedia images migration with optimization...
============================================================

📊 Initial status: 9537 Wikimedia URLs found
🔧 Optimization config:
   Max dimensions: 1024x1024
   Quality: 85%
   Thumbnail size: 300x300
   Max file size: 50 MB

[1/10] 🔄 Processing: Casa Museu Pedro Américo
   Original URL: https://upload.wikimedia.org/wikipedia/commons/7/7e/...
   ✅ Downloaded image (2.1 MB)
   🔧 Optimizing image...
   📊 Optimization results:
      Original: 2.1 MB
      Optimized: 0.8 MB
      Thumbnail: 50 KB
      Space saved: 1.3 MB (62.0%)
      Dimensions: 1024x768
   📤 Uploading optimized images...
   ✅ Uploaded to Supabase:
      Main: https://tysnkzmljlmmqpbotkxv.supabase.co/storage/v1/object/public/...
      Thumbnail: https://tysnkzmljlmmqpbotkxv.supabase.co/storage/v1/object/public/...
   ✅ Updated attraction table

📊 Migration and Optimization Summary:
============================================================
   ✅ Successful: 9
   ❌ Failed: 1
   📊 Total processed: 10
   🎯 Wikimedia URLs before: 9537
   🎯 Wikimedia URLs after: 9528
   📉 Wikimedia URLs reduced: 9

💾 Space Optimization Results:
   📏 Total original size: 15.2 MB
   📏 Total optimized size: 6.1 MB
   💰 Total space saved: 9.1 MB
   📈 Average reduction: 59.9%
```

## 🧪 Teste da Funcionalidade

### Executar Testes

```bash
npx tsx scripts/test-image-resize.ts
```

**O que é testado:**
- Download de imagens do Google Places
- Redimensionamento para 1024x1024
- Criação de thumbnails 300x300
- Comparação de tamanhos
- Validação de qualidade

## 🔧 Configurações

### Parâmetros de Redimensionamento

```typescript
const RESIZE_CONFIG = {
  maxWidth: 1024,        // Largura máxima
  maxHeight: 1024,       // Altura máxima
  quality: 85,           // Qualidade JPEG (1-100)
  thumbnailSize: 300,    // Tamanho do thumbnail
  thumbnailQuality: 80   // Qualidade do thumbnail
};
```

### Formatos Suportados

- **JPEG**: Formato principal (qualidade 85%)
- **PNG**: Convertido para JPEG quando possível
- **WebP**: Suportado, mantido quando necessário

## 📈 Monitoramento

### Métricas Importantes

1. **Economia de Espaço**: Percentual de redução no tamanho
2. **Qualidade Visual**: Manutenção da qualidade adequada
3. **Performance**: Tempo de carregamento das imagens
4. **Erros**: Taxa de falha no processamento

### Logs e Relatórios

- **Logs detalhados** em todas as operações
- **Relatórios de economia** de espaço
- **Métricas de performance** por imagem
- **Alertas de erro** para problemas

## 🔄 Processo de Upload Atualizado

### Edge Function `store-poi-images`

A função foi atualizada para incluir:

1. **Download otimizado**: Google Places com maxwidth=1024
2. **Processamento automático**: Redimensionamento e thumbnail
3. **Armazenamento duplo**: Imagem principal + thumbnail
4. **Logs detalhados**: Métricas de otimização

### Exemplo de Log

```
[request-id] Processing and optimizing image...
📊 Processing image data: 2.1 MB
📏 Image dimensions: 1600x1200, format: jpeg
🔄 Resizing image from 1600x1200 to max 1024x1024
✅ Image resized: 2.1 MB → 800 KB
🖼️ Creating thumbnail (300x300)
✅ Thumbnail created: 50 KB
[request-id] Image optimization complete: {
  originalSize: "2.1 MB",
  optimizedSize: "800 KB", 
  thumbnailSize: "50 KB",
  spaceSaved: "1.3 MB"
}
```

## 🛡️ Segurança e Backup

### Backup Automático

- **Imagens originais** são salvas com sufixo `.backup`
- **Rollback disponível** em caso de problemas
- **Validação** antes de substituir originais

### Validação de Qualidade

- **Verificação de dimensões** após redimensionamento
- **Teste de integridade** dos arquivos
- **Fallback** para imagem original em caso de erro

## 📋 Checklist de Implementação

### ✅ Fase 1: Preparação
- [ ] Instalar dependências (Sharp)
- [ ] Configurar variáveis de ambiente
- [ ] Testar funcionalidade básica

### ✅ Fase 2: Análise
- [ ] Executar análise de imagens existentes
- [ ] Identificar imagens problemáticas
- [ ] Gerar relatório de economia

### ✅ Fase 3: Otimização
- [ ] Redimensionar imagens grandes
- [ ] Criar thumbnails
- [ ] Validar qualidade

### ✅ Fase 4: Deploy
- [ ] Atualizar Edge Functions
- [ ] Testar upload de novas imagens
- [ ] Monitorar performance

### ✅ Fase 5: Monitoramento
- [ ] Configurar alertas
- [ ] Acompanhar métricas
- [ ] Otimizar parâmetros

## 🚨 Troubleshooting

### Problemas Comuns

1. **Erro de memória**: Reduzir batch size no processamento
2. **Timeout**: Aumentar timeout das Edge Functions
3. **Qualidade baixa**: Ajustar parâmetros de qualidade
4. **Falha no Sharp**: Verificar dependências

### Comandos de Diagnóstico

```bash
# Verificar dependências
npm list sharp

# Testar redimensionamento
npx tsx scripts/test-image-resize.ts

# Analisar bucket
npx tsx scripts/analyze-and-resize-images.ts --dry-run
```

## 📚 Referências

- [Sharp Documentation](https://sharp.pixelplumbing.com/)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Google Places API](https://developers.google.com/maps/documentation/places/web-service/photos)
- [Image Optimization Best Practices](https://web.dev/fast/#optimize-your-images)

## 🤝 Contribuição

Para contribuir com melhorias:

1. Teste as funcionalidades existentes
2. Identifique oportunidades de otimização
3. Implemente melhorias com testes
4. Documente mudanças
5. Submeta pull request

---

**Última atualização**: Janeiro 2025  
**Versão**: 1.0.0  
**Status**: ✅ Implementado e Testado
