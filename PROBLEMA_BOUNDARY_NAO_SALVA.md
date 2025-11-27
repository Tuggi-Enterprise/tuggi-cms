# Problema: Boundary Não Está Sendo Salvo

## Análise do Problema

### Fluxo Esperado:
1. ✅ Usuário cria POI → POI é salvo no banco (com coordenadas básicas)
2. ❌ Usuário desenha boundary no mapa → **NÃO ESTÁ FUNCIONANDO**
3. ❌ Botão "Salvar Boundary" aparece → **NÃO APARECE** (porque `boundaryPolygon` está `null`)
4. ❌ Usuário clica em "Salvar Boundary" → **NÃO PODE CLICAR** (botão não existe)
5. ❌ Endpoint `/api/pois/update-boundary` é chamado → **NUNCA É CHAMADO**
6. ❌ Boundary é salvo no banco → **NÃO É SALVO**

### Causa Raiz:
O `GoogleMapComponent` com `onPolygonComplete={handleBoundaryPolygonComplete}` **NÃO ESTÁ SENDO RENDERIZADO**.

Pelos logs:
- `handleBoundaryPolygonComplete` está sendo criado corretamente ✅
- Mas o `GoogleMapComponent` está sendo renderizado **SEM** o prop `onPolygonComplete` ❌
- Log: `hasOnPolygonComplete: false, type: 'undefined'` ❌

### Por Que Não Está Sendo Renderizado?

A seção de boundary está na linha 2874, dentro de:
- `activeTab === 'details'` (linha 2431)
- `!isLoading` (linha 2439)

O componente correto está na linha 2947, mas **NÃO ESTÁ SENDO RENDERIZADO**.

Possíveis causas:
1. A seção não está sendo renderizada (condição não atendida)
2. O componente está sendo renderizado mas sem o prop
3. Há múltiplos componentes e o errado está sendo usado

## Solução

### Passo 1: Verificar se a seção está sendo renderizada
Adicionar logs para verificar:
- Se `activeTab === 'details'` é `true`
- Se `isLoading` é `false`
- Se `getPoi()` retorna um POI válido
- Se `getPoi().coordinates` existe

### Passo 2: Garantir que o componente é renderizado com o prop correto
Verificar se o `GoogleMapComponent` na linha 2947 está recebendo:
- `componentId="boundary-drawing"` ✅
- `onPolygonComplete={handleBoundaryPolygonComplete}` ❌ (não está sendo passado)
- `enableDrawing={true}` ✅

### Passo 3: Verificar se há múltiplos componentes
Há 3 instâncias de `GoogleMapComponent`:
1. Linha 2346 - Aba "create" (sem `onPolygonComplete`)
2. Linha 2947 - Aba "details" boundary (COM `onPolygonComplete`) ← **ESTE É O CORRETO**
3. Linha 4737 - Aba "group-pois" (sem `componentId`)

O problema é que o componente da linha 2947 não está sendo renderizado.

## Próximos Passos

1. Verificar logs do console quando a aba "details" é aberta
2. Verificar se a seção de boundary está sendo renderizada
3. Verificar se o `GoogleMapComponent` está recebendo o prop `onPolygonComplete`
4. Se não estiver, identificar por que não está sendo passado
5. Corrigir para garantir que o prop seja passado corretamente

