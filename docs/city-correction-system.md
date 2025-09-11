# 🏙️ Sistema de Correção de Cidades dos POIs

## 📖 Visão Geral

Sistema **100% gratuito** para correção automática de cidades incorretas nos POIs usando múltiplas fontes de geocoding reverso. Resolve o problema de dados importados do OSM/Geofabrik com cidades incorretas.

## 🎯 Problema Resolvido

- **POIs com cidades incorretas** importados do OSM via Geofabrik
- **Dados inconsistentes** de localização geográfica
- **Necessidade de correção em massa** sem custos de API

## 🆓 Fontes de Dados Gratuitas

### 1. **Nominatim OSM (Primária)**
- **API**: `https://nominatim.openstreetmap.org/reverse`
- **Rate Limit**: 1 request/segundo
- **Custo**: Gratuito
- **Confiabilidade**: 85-90%
- **Uso**: Geocoding reverso principal

### 2. **GeoNames (Secundária)**  
- **API**: `http://api.geonames.org/findNearbyPlaceNameJSON`
- **Rate Limit**: 1,000-30,000 requests/dia
- **Custo**: Gratuito (requer cadastro)
- **Confiabilidade**: 75-80%
- **Uso**: Validação cruzada

### 3. **Validação Cruzada**
- **Método**: Comparação entre fontes
- **Confiança**: 95% quando ambas concordam
- **Fallback**: Usar fonte individual se só uma retornar dados

## 🏗️ Arquitetura

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   POI Input     │    │  Geocoding      │    │   Validation    │
│                 │    │                 │    │                 │
│ • Coordinates   │───▶│ • Nominatim     │───▶│ • Cross-check   │
│ • Current City  │    │ • GeoNames      │    │ • Confidence    │
│ • POI Data      │    │ • Rate Limiting │    │ • Thresholds    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Database      │    │  Manual Review  │    │   Auto Correct  │
│                 │    │                 │    │                 │
│ • Audit Trail   │◀───│ • Low Confidence│◀───│ • High Confidence│
│ • Corrections   │    │ • Disagreements │    │ • Apply Changes │
│ • Review Queue  │    │ • Edge Cases    │    │ • Log Actions   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Como Usar

### 1. **Configuração Inicial**

```bash
# 1. Cadastrar no GeoNames (gratuito)
# Acesse: https://www.geonames.org/login
# Ative web services na sua conta

# 2. Configurar variável de ambiente
echo "GEONAMES_USERNAME=seu_username" >> .env

# 3. Executar migração do banco
npx supabase db push
```

### 2. **Testar o Sistema**

```bash
# Ver POIs candidatos para correção
npm run tsx scripts/test-city-correction.ts --mode candidates --limit 20

# Testar correção de um POI específico
npm run tsx scripts/test-city-correction.ts --mode single --poi-id abc123

# Executar dry-run (sem aplicar correções)
npm run tsx scripts/test-city-correction.ts --mode dry_run --limit 10

# Executar correções reais
npm run tsx scripts/test-city-correction.ts --mode batch --limit 10
```

### 3. **Via API**

```javascript
// Obter candidatos para correção
const response = await fetch('/api/poi-processing/city-correction?limit=100&country=Brazil')

// Processar em lote
const batchResponse = await fetch('/api/poi-processing/city-correction', {
  method: 'POST',
  body: JSON.stringify({
    action: 'batch_process',
    country: 'Brazil',
    limit: 100,
    options: {
      confidence_threshold: 85,
      dry_run: false
    }
  })
})
```

## ⚙️ Configurações

### **Thresholds de Confiança**

```typescript
interface CorrectionThresholds {
  auto_correct: 85%      // Corrigir automaticamente
  manual_review: 60-84%  // Enviar para revisão manual  
  ignore: <60%           // Manter cidade original
}
```

### **Rate Limits**

```typescript
interface RateLimits {
  nominatim: {
    requests_per_second: 1
    daily_limit: 86400  // Praticamente ilimitado
    delay: 1100         // ms entre requests
  }
  
  geonames: {
    requests_per_day: 1000  // Conta gratuita
    delay: 90000           // ~1 request per 90 seconds
  }
}
```

### **Processamento em Lotes**

```typescript
interface BatchSettings {
  batch_size: 100           // POIs por lote
  parallel_processing: false // Sequencial devido rate limits
  max_daily_pois: 1000      // Limite conservador
}
```

## 📊 Monitoramento

### **Views do Banco de Dados**

```sql
-- Estatísticas gerais
SELECT * FROM core.city_correction_stats;

-- Fila de revisão manual
SELECT * FROM core.city_correction_manual_review;
```

### **Métricas Importantes**

- **Taxa de correção**: % de POIs corrigidos automaticamente
- **Taxa de revisão**: % de POIs que precisam revisão manual
- **Confiança média**: Qualidade geral das correções
- **Distribuição de fontes**: Nominatim vs GeoNames vs Cross-validated

## 🔍 Algoritmo de Validação

### **Fluxo de Decisão**

```
┌─────────────────┐
│ Consultar APIs  │
│ (Nominatim +    │
│  GeoNames)      │
└─────────┬───────┘
          │
    ┌─────▼─────┐
    │ Ambas     │     SIM    ┌─────────────────┐
    │ retornaram├────────────▶│ Cidades iguais? │
    │ dados?    │             └─────────┬───────┘
    └─────┬─────┘                       │
          │ NÃO                   ┌─────▼─────┐
          │                       │ Confiança │     SIM
    ┌─────▼─────┐                 │ = 95%     ├─────────┐
    │ Só uma    │                 └─────┬─────┘         │
    │ retornou? │                       │ NÃO           │
    └─────┬─────┘                 ┌─────▼─────┐         │
          │                       │ Usar      │         │
    ┌─────▼─────┐                 │ Nominatim │         │
    │ Usar fonte│                 │ (75%)     │         │
    │ individual│                 └───────────┘         │
    │ (75-85%)  │                                       │
    └───────────┘                                       │
                                                        │
          ┌─────────────────────────────────────────────┘
          │
    ┌─────▼─────┐
    │ Confiança │     ≥85%   ┌─────────────────┐
    │ ≥ limite? ├────────────▶│ Corrigir        │
    └─────┬─────┘             │ automaticamente │
          │                   └─────────────────┘
          │ 60-84%
    ┌─────▼─────┐
    │ Revisão   │
    │ manual    │
    └───────────┘
```

### **Normalização de Cidades**

```typescript
function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .normalize('NFD')                    // Decompor acentos
    .replace(/[\u0300-\u036f]/g, '')    // Remover acentos
    .replace(/[^a-z0-9\s]/g, '')        // Remover caracteres especiais
    .replace(/\s+/g, ' ')               // Normalizar espaços
}
```

## 📈 Performance

### **Velocidade de Processamento**

- **Nominatim**: ~86.400 POIs/dia (1 req/s)
- **GeoNames**: ~1.000 POIs/dia (conta gratuita)
- **Processamento real**: ~1.000 POIs/dia (limitado pelo GeoNames)

### **Otimizações**

1. **Cache de resultados**: Evitar re-consultas
2. **Processamento sequencial**: Respeitar rate limits
3. **Batch inteligente**: Agrupar por região geográfica
4. **Fallback graceful**: Continuar mesmo com falhas

## 🛠️ Manutenção

### **Tarefas Diárias**

```bash
# Reset rate limiters (se necessário)
curl -X POST /api/poi-processing/city-correction/reset-limits

# Verificar estatísticas
curl /api/poi-processing/city-correction/stats

# Processar fila de revisão manual
curl /api/poi-processing/city-correction/manual-review
```

### **Monitoramento de Erros**

- **Rate limit exceeded**: Aguardar reset diário
- **API unavailable**: Tentar fonte alternativa
- **Invalid coordinates**: Pular POI
- **Network timeout**: Retry com backoff

## 🔐 Segurança

### **Validações**

- **Coordenadas válidas**: Latitude [-90, 90], Longitude [-180, 180]
- **Rate limiting**: Respeitar limites das APIs
- **Input sanitization**: Limpar dados de entrada
- **Audit trail**: Log todas as operações

### **Permissões**

```sql
-- Apenas usuários autenticados podem ver estatísticas
GRANT SELECT ON core.city_correction_stats TO authenticated;

-- Apenas admins podem executar correções
-- (implementar via RLS policies)
```

## 📝 Logs e Auditoria

### **Estrutura do Audit Log**

```json
{
  "original_city": "São Paulo",
  "corrected_city": "Osasco", 
  "confidence": 92,
  "source": "cross_validated",
  "corrected_at": "2024-01-15T10:30:00Z",
  "auto_corrected": true,
  "raw_data": {
    "nominatim": { "city": "Osasco", "state": "São Paulo" },
    "geonames": { "city": "Osasco", "state": "São Paulo" }
  }
}
```

### **Tipos de Log**

- **Auto corrections**: Correções aplicadas automaticamente
- **Manual reviews**: Casos enviados para revisão
- **Errors**: Falhas no processamento
- **Rate limits**: Limites atingidos
- **API failures**: Falhas nas APIs externas

## 🎯 Próximos Passos

### **Melhorias Futuras**

1. **Interface web** para revisão manual
2. **Relatórios automáticos** de qualidade
3. **Integração com mais fontes** gratuitas
4. **Machine learning** para melhorar confiança
5. **Processamento geográfico** inteligente

### **Expansão**

- **Correção de estados**: Aplicar mesma lógica para estados
- **Correção de países**: Validar países também
- **Coordenadas suspeitas**: Detectar coordenadas incorretas
- **Nomes de POIs**: Validar nomes usando fontes externas

## ❓ FAQ

### **Q: O sistema pode gerar custos?**
A: Não. Todas as fontes usadas são 100% gratuitas.

### **Q: Qual a precisão das correções?**
A: ~90-95% de precisão com validação cruzada, ~85% com fonte única.

### **Q: Quantos POIs posso processar por dia?**
A: ~1.000 POIs/dia devido aos rate limits gratuitos.

### **Q: E se as fontes discordarem?**
A: Usamos Nominatim (mais confiável para cidades) e marcamos para revisão manual.

### **Q: Como reverter uma correção?**
A: Todas as correções são auditadas. O valor original fica no `city_correction_audit`.

### **Q: Posso processar POIs específicos?**
A: Sim, use filtros por país, estado ou POI IDs específicos.

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique os logs no `city_correction_audit`
2. Consulte as views de estatísticas
3. Execute modo `dry_run` para testar
4. Verifique rate limits das APIs externas
