# 📋 Plano de Implementação - Refatoração do Sistema de Salvamento de Trigger Points

## 🎯 Objetivos

1. **Mudar estratégia de salvamento**: Deletar todos os TPs do POI antes de salvar novos (em vez de validar duplicatas)
2. **Remover filtro de confidence**: Confiar no sistema de geração (já filtra por 0.2)
3. **Unificar serviço de salvamento**: Mesmo código para massa e individual
4. **Garantir mapeamento completo**: Todos os campos da tabela mapeados
5. **Remover campos desnecessários**: Remover `name`, `description`, `direction` (não são usados pelo novo motor)

---

## 📦 FASE 1: Preparação - Expandir Interface e Preparação de Dados

**Objetivo**: Criar base sólida para todas as operações

### Tarefas:

1. **Atualizar `TriggerPointSaveData` interface**
   - Adicionar campos necessários:
     - `custom_description_id?: uuid`
     - `created_at?: string` (opcional, será gerado se não fornecido)
     - `updated_at?: string` (opcional, será gerado se não fornecido)
   - **REMOVER campos desnecessários** (não são usados pelo novo motor):
     - ❌ `name?: string` - Remover
     - ❌ `description?: string` - Remover
     - ❌ `direction?: 'front' | 'right' | 'left' | 'back'` - Remover
   - **MANTER campos de status** (são usados pelo sistema):
     - ✅ `auto_status` - Mantido
     - ✅ `manual_status` - Mantido
     - ✅ `final_status` - Mantido

2. **Melhorar `prepareTriggerPointForDB()`**
   - Mapear campos necessários do schema
   - **REMOVER** campos desnecessários:
     - ❌ `name: tp.name || null` - Remover (linha 69)
     - ❌ `description: tp.description || null` - Remover (linha 70)
     - ❌ `direction: tp.direction || null` - Remover (linha 71)
   - Garantir valores padrão corretos
   - Validar constraints do banco (ranges, enums, etc)
   - **CORRIGIR**: Usar `SRID=4326;POINT(lng lat)` para location (atualmente usa `POINT(lng lat)`)
   - **MANTER** campos de status (são calculados pelo trigger do banco baseado em `confidence_score`)

3. **Remover campos desnecessários**
   - **REMOVER** de `TriggerPointSaveData` interface: `name`, `description`, `direction`
   - **REMOVER** de `prepareTriggerPointForDB()`: linhas que salvam esses campos
   - **REMOVER** de `lib/services/trigger-points-google/utils/conversion.ts`:
     - Interface `TriggerPointForDB`: campos `name`, `description`, `direction`
   - **REMOVER** de `lib/services/trigger-points-google/utils/validation.ts`:
     - Validação de `direction` (linhas 123-132)
   - **REMOVER** de `app/api/trigger-points/generate-batch/route.ts`:
     - Campos `name`, `description`, `direction` em `tpsForDB` (linhas 302-304)

4. **Criar método auxiliar `prepareTriggerPointForUpdate()`**
   - Similar ao `prepareTriggerPointForDB()` mas para UPDATE
   - Não incluir `created_at`, `created_by` (não devem ser atualizados)
   - Incluir `updated_at` e `updated_by`
   - **NÃO incluir** `name`, `description`, `direction` (já removidos)

**Arquivos a modificar:**
- `lib/services/trigger-point-saving.ts`
- `lib/services/trigger-points-google/utils/conversion.ts`
- `lib/services/trigger-points-google/utils/validation.ts`
- `app/api/trigger-points/generate-batch/route.ts`

**Critérios de sucesso:**
- ✅ Interface `TriggerPointSaveData` contém apenas campos necessários
- ✅ Campos `name`, `description`, `direction` removidos da interface
- ✅ `prepareTriggerPointForDB()` não inclui `name`, `description`, `direction`
- ✅ Interface `TriggerPointForDB` não inclui `name`, `description`, `direction`
- ✅ Validação de `direction` removida
- ✅ Campos removidos de `generate-batch/route.ts`
- ✅ Valores padrão estão corretos conforme schema
- ✅ Formato de location está correto (`SRID=4326;POINT(lng lat)`)

---

## 📦 FASE 2: Refatorar Serviço de Salvamento - Criar Métodos Unificados

**Objetivo**: Criar métodos unificados que serão usados por massa e individual

### Tarefas:

1. **Criar método `deleteTriggerPoints()`**
   ```typescript
   static async deleteTriggerPoints(
     attractionId: string,
     triggerPointIds?: string[]
   ): Promise<{ deleted: number; error?: string }>
   ```
   - Se `triggerPointIds` fornecido: deleta TPs específicos
   - Se não fornecido: deleta TODOS os TPs do POI
   - Retorna número de registros deletados

2. **Criar método `saveTriggerPoints()` (método principal unificado)**
   ```typescript
   static async saveTriggerPoints(
     attractionId: string,
     triggerPoints: TriggerPointSaveData[],
     options: {
       mode: 'replace_all' | 'append' | 'replace_single',
       triggerPointId?: string, // Para replace_single
       boundarySource?: string
     }
   ): Promise<SaveResult>
   ```
   - `replace_all`: DELETE todos + INSERT novos (massa)
     - **PROTEÇÃO**: Validar TPs antes de DELETE (garantir que há TPs válidos)
     - **PROTEÇÃO**: Se INSERT falhar, retornar erro (TPs já deletados, mas aceitável)
     - **PROTEÇÃO**: Só marcar POI como processado se INSERT for bem-sucedido
   - `append`: Apenas INSERT (individual criar)
   - `replace_single`: DELETE por ID + INSERT novo (individual atualizar)

3. **Refatorar `saveTriggerPointsBatch()` para usar novo método**
   - Chamar `saveTriggerPoints()` com `mode: 'replace_all'`
   - Manter lock de processamento
   - **REMOVER validação de duplicatas (RPC)** - linhas 188-225
   - **REMOVER filtro de confidence (>= 0.3)** - linhas 153-169
   - **REMOVER variáveis obsoletas**: `validatedTPs`, `validationError`, `retries`, `duplicatesSkipped`
   - **REMOVER lógica de retry** para validação (não será mais necessária)
   - **REMOVER preparação de `tpsForValidation`** (linhas 173-186)

4. **Criar `saveSingle()` wrapper**
   ```typescript
   static async saveSingle(
     triggerPointData: TriggerPointSaveData,
     options?: { mode?: 'append' | 'replace_single', triggerPointId?: string }
   ): Promise<{ success: boolean; data?: any; error?: string }>
   ```

5. **Criar `updateSingle()` wrapper**
   ```typescript
   static async updateSingle(
     triggerPointId: string,
     triggerPointData: Partial<TriggerPointSaveData>
   ): Promise<{ success: boolean; data?: any; error?: string }>
   ```
   - Usa `prepareTriggerPointForUpdate()`
   - Faz UPDATE direto no banco

6. **Verificar e remover método antigo `saveSingleTriggerPoint()`**
   - Verificar se está sendo usado em algum lugar
   - Se não estiver, **REMOVER** (será substituído por `saveSingle()`)

**Arquivos a modificar:**
- `lib/services/trigger-point-saving.ts`

**Critérios de sucesso:**
- ✅ Método `deleteTriggerPoints()` funciona para todos e específicos
- ✅ Método `saveTriggerPoints()` suporta todos os modos
- ✅ **PROTEÇÃO**: Validação de TPs antes de DELETE (garantir TPs válidos)
- ✅ **PROTEÇÃO**: Se INSERT falhar, retornar erro e não marcar POI como processado
- ✅ `saveTriggerPointsBatch()` usa novo método e remove validação duplicatas
- ✅ Métodos `saveSingle()` e `updateSingle()` criados
- ✅ Lock de processamento mantido
- ✅ Formato de location padronizado (`SRID=4326;POINT(lng lat)`)

---

## 📦 FASE 3: Atualizar Sistema em Massa (Processing Service)

**Objetivo**: Atualizar fluxo de geração em massa para usar novo salvamento

### Tarefas:

1. **Atualizar `lib/core/processing-service.ts`**
   - Remover lógica de contagem de duplicatas
   - Ajustar `skipped` (não haverá duplicatas, apenas validação de schema)
   - Garantir que todos os campos sejam passados para `TriggerPointSavingService`
   - **PROTEÇÃO**: Só atualizar attraction metadata se `saved > 0` (linha 198)
   - Manter resto do fluxo (conversão, validação de schema)

**Arquivos a modificar:**
- `lib/core/processing-service.ts`

**Critérios de sucesso:**
- ✅ `processing-service.ts` usa novo `saveTriggerPointsBatch()`
- ✅ Contagem de `skipped` ajustada (sem duplicatas)
- ✅ Todos os campos são passados corretamente
- ✅ **PROTEÇÃO**: Só atualizar attraction metadata se `saved > 0`

---

## 📦 FASE 4: Atualizar API Routes Individuais (Create, Update, Delete)

**Objetivo**: Unificar API routes para usar serviço centralizado

### Tarefas:

1. **Atualizar `app/api/trigger-points/create/route.ts`**
   - **REMOVER preparação manual de dados** (`insertData`) - linhas 84-101
   - **REMOVER lógica de mapeamento manual** de campos
   - Usar `TriggerPointSavingService.saveSingle()` com `mode: 'append'`
   - Mapear dados do request para `TriggerPointSaveData` (usar serviço)
   - Manter mapeamento de user ID

2. **Atualizar `app/api/trigger-points/update/route.ts`**
   - **REMOVER preparação manual de dados** (`updateData`) - linhas 83-97
   - **REMOVER lógica de mapeamento manual** de campos
   - Usar `TriggerPointSavingService.updateSingle()`
   - Mapear dados do request para `Partial<TriggerPointSaveData>` (usar serviço)
   - Manter mapeamento de user ID
   - Manter lógica de desabilitar learning trigger (se necessário)

3. **Atualizar `app/api/trigger-points/delete/route.ts`**
   - Usar `TriggerPointSavingService.deleteTriggerPoints()` com `triggerPointIds`
   - Simplificar código

**Arquivos a modificar:**
- `app/api/trigger-points/create/route.ts`
- `app/api/trigger-points/update/route.ts`
- `app/api/trigger-points/delete/route.ts`

**Critérios de sucesso:**
- ✅ Todas as API routes usam `TriggerPointSavingService`
- ✅ Código duplicado removido
- ✅ Mapeamento de user ID mantido
- ✅ Comportamento mantido (mesmos resultados)

---

## 📦 FASE 5: Atualizar API Route Antiga (generate-batch)

**Objetivo**: Atualizar rota antiga para usar novo sistema

### Tarefas:

1. **Atualizar `app/api/trigger-points/generate-batch/route.ts`**
   - **REMOVER validação de duplicatas** (RPC `validate_trigger_points_batch`) - linhas 238-244
   - **REMOVER preparação manual de dados** (`tpsForValidation`, `tpsForDB`) - linhas 224-236, 285-305
   - **REMOVER variáveis obsoletas**: `validatedTPs`, `validatedTPsArray`, `duplicatesSkipped`
   - **REMOVER lógica de contagem de duplicatas** - linha 252
   - Usar `TriggerPointSavingService.saveTriggerPoints()` com `mode: 'replace_all'`
   - DELETE será feito automaticamente pelo serviço
   - Ajustar contagem de `skipped` (remover referências a duplicatas)
   - Manter resto da lógica (filtros, estatísticas, etc)

**Arquivos a modificar:**
- `app/api/trigger-points/generate-batch/route.ts`

**Critérios de sucesso:**
- ✅ Rota antiga usa novo serviço
- ✅ Validação de duplicatas removida
- ✅ DELETE + INSERT implementado
- ✅ Comportamento mantido para frontend

---

## 📦 FASE 6: Validação e Testes

**Objetivo**: Garantir que tudo funciona corretamente

### Tarefas:

1. **Testes manuais:**
   - ✅ Testar geração em massa (via `/trigger-points-generation`)
   - ✅ Testar criação individual (via POI Management)
   - ✅ Testar atualização individual (via POI Management)
   - ✅ Testar deleção individual (via POI Management)
   - ✅ Verificar que TPs antigos são deletados antes de salvar novos
   - ✅ Verificar que todos os campos são salvos corretamente

2. **Validações:**
   - ✅ Verificar logs (não deve haver erros)
   - ✅ Verificar banco de dados (dados corretos)
   - ✅ Verificar que não há duplicatas
   - ✅ Verificar que campos opcionais têm valores padrão corretos

3. **Limpeza e Remoção de Código Obsoleto:**
   - ✅ Remover código não utilizado
   - ✅ Remover comentários obsoletos
   - ✅ Verificar que não há imports não utilizados
   - ✅ **Remover validação de duplicatas via RPC** (linhas 188-225 em `trigger-point-saving.ts`)
   - ✅ **Remover filtro de confidence >= 0.3** (linhas 153-169 em `trigger-point-saving.ts`)
   - ✅ **Remover preparação manual de dados** nas API routes (substituir por serviço)
   - ✅ **Remover variáveis relacionadas a duplicatas** (`duplicatesSkipped`, `validatedTPs`, etc)
   - ✅ **Remover lógica de retry para validação** (não será mais necessária)
   - ✅ **Verificar se `saveSingleTriggerPoint()` antigo é usado** (se não, remover)

**Arquivos a verificar:**
- Todos os arquivos modificados
- Logs do sistema
- Banco de dados

**Critérios de sucesso:**
- ✅ Todos os testes passam
- ✅ Não há erros nos logs
- ✅ Dados no banco estão corretos
- ✅ Código limpo e sem duplicações

---

## 📊 Resumo das Mudanças

### Arquivos a Modificar:

1. **`lib/services/trigger-point-saving.ts`** (FASE 1, 2)
   - Atualizar interface (remover `name`, `description`, `direction`)
   - Criar métodos unificados
   - **REMOVER campos desnecessários** (`name`, `description`, `direction`)
   - **REMOVER validação duplicatas** (RPC, retry, variáveis)
   - **REMOVER filtro confidence** (>= 0.3)
   - **REMOVER método antigo** `saveSingleTriggerPoint()` (se não usado)

2. **`lib/core/processing-service.ts`** (FASE 3)
   - Ajustar contagem skipped (remover referências a duplicatas)
   - Garantir campos completos

3. **`app/api/trigger-points/create/route.ts`** (FASE 4)
   - **REMOVER preparação manual de dados**
   - Usar serviço unificado

4. **`app/api/trigger-points/update/route.ts`** (FASE 4)
   - **REMOVER preparação manual de dados**
   - Usar serviço unificado

5. **`app/api/trigger-points/delete/route.ts`** (FASE 4)
   - Usar serviço unificado (simplificar)

6. **`app/api/trigger-points/generate-batch/route.ts`** (FASE 5)
   - **REMOVER validação duplicatas** (RPC, variáveis, lógica)
   - **REMOVER preparação manual de dados**
   - Usar serviço unificado

### Código a Ser Removido (Dead Code):

#### `lib/services/trigger-point-saving.ts`:
- ❌ Linhas 35-37: Campos `name`, `description`, `direction` da interface `TriggerPointSaveData`
- ❌ Linhas 69-71: Campos `name`, `description`, `direction` em `prepareTriggerPointForDB()`
- ❌ Linhas 153-169: Filtro de confidence (>= 0.3)
- ❌ Linhas 171-186: Preparação de `tpsForValidation`
- ❌ Linhas 188-225: Validação de duplicatas via RPC (com retry)
- ❌ Linhas 227-228: Variável `duplicatesSkipped`
- ❌ Linhas 230-238: Lógica de "all duplicates skipped"
- ❌ Linha 240: Log sobre duplicatas
- ❌ Linha 272: Contagem de duplicatas no resultado
- ❌ Método `saveSingleTriggerPoint()` (linhas 286-312) - se não usado

#### `app/api/trigger-points/generate-batch/route.ts`:
- ❌ Linhas 221-244: Validação de duplicatas via RPC
- ❌ Linhas 224-236: Preparação de `tpsForValidation`
- ❌ Linhas 250-252: Processamento de `validatedTPsArray` e `duplicatesSkipped`
- ❌ Linhas 254-282: Lógica de "all duplicates skipped"
- ❌ Linhas 285-305: Preparação manual de `tpsForDB`
- ❌ Linhas 302-304: Campos `name`, `description`, `direction` em `tpsForDB`
- ❌ Linha 323: Log sobre duplicatas

#### `app/api/trigger-points/create/route.ts`:
- ❌ Linhas 84-101: Preparação manual de `insertData`

#### `app/api/trigger-points/update/route.ts`:
- ❌ Linhas 83-97: Preparação manual de `updateData`

### Arquivos NÃO Modificados (mas serão afetados):

- `app/api/poi-boundaries/detect/route.ts`:
  - **ATENÇÃO**: Usa `saveTriggerPointsBatch()` em 6 lugares
  - Será afetado automaticamente (DELETE + INSERT)
  - Cada chamada deleta TODOS os TPs antes de inserir novos
  - Comportamento esperado: última estratégia vence

### Arquivos a Modificar (Remoção de Campos):

- `lib/services/trigger-points-google/utils/conversion.ts`:
  - **REMOVER** campos `name`, `description`, `direction` da interface `TriggerPointForDB` (linhas 23-25)

- `lib/services/trigger-points-google/utils/validation.ts`:
  - **REMOVER** validação de `direction` (linhas 123-132)

### Arquivos NÃO Modificados:

- `lib/services/trigger-points-google/utils/attraction-update.ts` (não afetado)

---

## 🔄 Fluxo Final

### Sistema em Massa:
```
1. Gerar TPs (novo motor)
2. Converter para formato DB
3. Validar schema (constraints)
4. DELETE todos TPs do POI
5. INSERT novos TPs
6. Atualizar attraction metadata
```

### Sistema Individual (Criar):
```
1. Preparar dados (TriggerPointSaveData)
2. INSERT TP
```

### Sistema Individual (Atualizar):
```
1. Preparar dados (Partial<TriggerPointSaveData>)
2. UPDATE TP
```

### Sistema Individual (Deletar):
```
1. DELETE TP por ID
```

---

## ✅ Checklist Final

- [ ] FASE 1: Interface e preparação expandidas
- [ ] FASE 2: Serviço unificado criado
- [ ] FASE 3: Processing service atualizado
- [ ] FASE 4: API routes individuais atualizadas
- [ ] FASE 5: API route antiga atualizada
- [ ] FASE 6: Testes e validação completos

---

## 🚨 Pontos de Atenção e Riscos

### Riscos Críticos:

1. **🔴 RISCO CRÍTICO: Perda de Dados - DELETE + INSERT**
   - **Problema**: Se DELETE suceder mas INSERT falhar, TPs antigos serão perdidos
   - **Mitigação**: 
     - Validar TPs antes de DELETE (garantir que há TPs válidos)
     - Se INSERT falhar, retornar erro e NÃO marcar POI como processado
     - Próximo processamento gerará novos TPs (aceitável)
   - **Aceitável**: Sim, pois estamos regenerando TPs de qualquer forma

2. **🟡 RISCO MÉDIO: Formato de Location Inconsistente**
   - **Problema**: Código atual usa `POINT(lng lat)`, mas deveria ser `SRID=4326;POINT(lng lat)`
   - **Solução**: Padronizar para `SRID=4326;POINT(lng lat)` em todos os lugares

3. **🟡 RISCO MÉDIO: markPOIAsProcessed Chamado Incorretamente**
   - **Problema**: Pode marcar POI como processado mesmo sem TPs salvos
   - **Solução**: Só marcar se `results.saved > 0`

4. **🟡 RISCO MÉDIO: Triggers do Banco Sobrescrevem Valores**
   - **Problema**: Trigger `trigger_update_status` calcula `auto_status` e `final_status` automaticamente
   - **Solução**: Garantir que valores salvos sejam consistentes com o que o trigger espera

### Pontos de Atenção:

1. **Lock de processamento**: Manter em `saveTriggerPointsBatch()` para evitar race conditions ✅
2. **Mapeamento de user ID**: Manter em todas as API routes ✅
3. **Formato de location**: **CORRIGIR** para `SRID=4326;POINT(lng lat)` sempre ⚠️
4. **Valores padrão**: Garantir que todos os campos opcionais tenham defaults corretos ✅
5. **DELETE + INSERT**: Sequenciais (lock protege contra race conditions) ✅
6. **Tratamento de erro**: Se INSERT falhar após DELETE, não marcar POI como processado ⚠️

---

## 📝 Notas

- Não precisamos criar RPC no banco (fazer no front/API)
- Não precisamos manter filtro de confidence (sistema de geração já filtra)
- Campos desnecessários (`name`, `description`, `direction`) serão removidos (não são usados pelo novo motor)
- Campos de status (`auto_status`, `manual_status`, `final_status`) serão mantidos (são usados pelo sistema)
- Código unificado facilita manutenção futura
- **Código obsoleto será completamente removido** (não apenas comentado)
- **RPC `validate_trigger_points_batch` não será mais chamado** (pode ser removido do banco depois, se não for usado em outro lugar)

## ⚠️ RISCOS E MITIGAÇÕES

### Risco Principal: DELETE + INSERT Sem Transação

**Cenário de Falha**:
- DELETE sucede ✅
- INSERT falha ❌ (constraint violation, network error, etc)
- Resultado: POI sem TPs, dados antigos perdidos

**Mitigação Implementada**:
1. Validar TPs antes de DELETE (garantir que há TPs válidos)
2. Se INSERT falhar, retornar erro e NÃO marcar POI como processado
3. Próximo processamento gerará novos TPs (aceitável, pois estamos regenerando)

**Aceitável?**: ✅ Sim, pois:
- Lock previne processamento concorrente
- Sistema regenera TPs automaticamente
- É um risco controlado e aceitável

### Outros Riscos Identificados:

1. **Formato de location**: Corrigido no plano (padronizar para `SRID=4326;POINT(lng lat)`)
2. **markPOIAsProcessed**: Corrigido no plano (só marcar se houver TPs salvos)
3. **Triggers do banco**: Documentado (valores devem ser consistentes)

---

## 📄 DOCUMENTAÇÃO TÉCNICA ADICIONAL

Ver arquivo `ANALISE_REVISAO_PLANO.md` para análise técnica completa como Dev Senior.

