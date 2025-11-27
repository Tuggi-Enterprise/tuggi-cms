# Correções TypeScript Necessárias

O arquivo `POIDetailsModal.tsx` tem muitos erros porque `poi` pode ser `null` em modo de criação.

## Estratégia de Correção

1. Adicionar verificações de null em funções que requerem POI
2. Usar `getPoi()` helper onde apropriado
3. Adicionar early returns onde POI é necessário
4. Usar optional chaining onde apropriado

## Padrão de Correção

### Antes:
```typescript
.eq('id', poi.id)
```

### Depois:
```typescript
const currentPoi = getPoi()
if (!currentPoi) return
.eq('id', currentPoi.id)
```

OU usar optional chaining onde faz sentido:
```typescript
.eq('id', getPoi()?.id)
```

## Funções que Precisam de Correção

1. `fetchAdditionalData` - linha 400
2. `fetchGroupInfo` - linha 537
3. `fetchVerificationData` - linha 568
4. `handleSave` - linha 828
5. `handleApprove` - linha 896
6. `handleDelete` - linha 986
7. Todos os lugares onde `poi` é usado diretamente no JSX

## Nota

Devido ao grande número de erros (180+), seria melhor fazer uma refatoração mais sistemática usando um script ou fazer as correções em lotes.

