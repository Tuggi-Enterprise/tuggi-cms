# Solução para POIs com Múltiplas Localizações

## 🎯 Objetivo
Prevenir e corrigir POIs que possuem mais de uma entrada de localização na tabela `attraction_coordinate`.

## 📊 Situação Atual
- POIs podem ter múltiplas coordenadas na tabela `core.attraction_coordinate`
- Isso causa inconsistências na exibição e processamento dos POIs
- Scripts de detecção já existem e estão funcionais

## 🔧 Soluções Propostas

### 1. Prevenção (Curto Prazo)

#### A. Constraint de Banco de Dados
```sql
-- Adicionar constraint única para prevenir múltiplas coordenadas por POI
ALTER TABLE core.attraction_coordinate 
ADD CONSTRAINT unique_attraction_coordinate 
UNIQUE (attraction_id);
```

#### B. Validação na Aplicação
- Modificar `poi-import-service.ts` para verificar coordenadas existentes antes de inserir
- Adicionar validação nos endpoints de API que criam coordenadas

### 2. Correção (Médio Prazo)

#### A. Script de Limpeza Automática
```typescript
// Script para manter apenas a coordenada mais recente por POI
async function cleanupDuplicateCoordinates() {
  // 1. Identificar POIs com múltiplas coordenadas
  // 2. Manter apenas a mais recente (created_at)
  // 3. Remover as demais
}
```

#### B. Migração de Dados
- Executar limpeza em produção durante janela de manutenção
- Backup dos dados antes da limpeza
- Log detalhado das alterações

### 3. Monitoramento (Longo Prazo)

#### A. Alertas Automáticos
- Job diário para verificar novos POIs com múltiplas coordenadas
- Notificação para equipe de desenvolvimento

#### B. Dashboard de Monitoramento
- Métricas em tempo real sobre qualidade dos dados
- Gráficos de tendência de duplicatas

## 🚀 Plano de Implementação

### Fase 1: Prevenção Imediata
1. ✅ Executar scripts de detecção existentes
2. 🔄 Implementar constraint de banco (com cuidado)
3. 🔄 Adicionar validações na aplicação

### Fase 2: Correção dos Dados Existentes
1. 🔄 Criar script de limpeza
2. 🔄 Testar em ambiente de desenvolvimento
3. 🔄 Executar em produção

### Fase 3: Monitoramento Contínuo
1. 🔄 Implementar alertas
2. 🔄 Criar dashboard de qualidade de dados
3. 🔄 Documentar processos

## ⚠️ Considerações Importantes

### Riscos
- **Constraint única**: Pode quebrar imports existentes se não tratado adequadamente
- **Perda de dados**: Coordenadas antigas podem conter informações valiosas
- **Downtime**: Migração pode requerer parada do sistema

### Mitigações
- **Teste extensivo**: Validar todas as mudanças em ambiente de desenvolvimento
- **Backup completo**: Sempre fazer backup antes de alterações em produção
- **Rollback plan**: Ter plano de reversão para cada mudança
- **Gradual rollout**: Implementar mudanças de forma incremental

## 📝 Scripts Disponíveis

### Detecção
- `scripts/check-duplicate-coordinates-quick.ts` ✅
- `scripts/check-duplicate-coordinates-simple.ts`
- `scripts/check-duplicate-coordinates.ts`

### Funções SQL
- `core.get_duplicate_coordinates()` - Lista POIs com múltiplas coordenadas
- `core.get_duplicate_coordinates_stats()` - Estatísticas gerais
- `core.get_close_coordinates()` - Coordenadas muito próximas

## 🔗 Próximos Passos

1. **Validar resultados** dos scripts de detecção
2. **Analisar impacto** das coordenadas duplicadas
3. **Decidir estratégia** de limpeza (manter mais recente vs. mais precisa)
4. **Implementar prevenção** antes da correção
5. **Executar limpeza** em ambiente controlado

---

**Autor**: Sistema de Análise de POIs  
**Data**: 2024-12-20  
**Status**: Proposta Inicial