# 📋 Plano de Implementação - Refatoração do Sistema de Salvamento de Trigger Points

## 🎯 Objetivos

1. **Mudar estratégia de salvamento**: Deletar todos os TPs do POI antes de salvar novos (em vez de validar duplicatas)
2. **Remover filtro de confidence**: Confiar no sistema de geração (já filtra por 0.2)
3. **Unificar serviço de salvamento**: Mesmo código para massa e individual
4. **Garantir mapeamento completo**: Todos os campos da tabela mapeados

---

## 📦 FASE 1: Preparação - Expandir Interface e Preparação de Dados

**Objetivo**: Criar base sólida para todas as operações

### Tarefas:

1. **Expandir `TriggerPointSaveData` interface**
   - Adicionar TODOS os campos da tabela:
     - `custom_description_id?: uuid`
     - `created_at?: string` (opcional, será gerado se não fornecido)
     - `updated_at?: string` (opcional, será gerado se não fornecido)
     - Garantir que todos os campos opcionais estejam presentes

2. **Melhorar `prepareTriggerPointForDB()`**
   - Mapear TODOS os campos do schema
   - Garantir valores padrão corretos
   - Validar constraints do banco (ranges, enums, etc)
   - Usar `SRID=4326;POINT(lng lat)` para location (formato correto)

3. **Criar método auxiliar `prepareTriggerPointForUpdate()`**
   - Similar ao `prepareTriggerPointForDB()` mas para UPDATE
   - Não incluir `created_at`, `created_by` (não devem ser atualizados)
   - Incluir `updated_at` e `updated_by`

**Arquivos a modificar:**
- `lib/services/trigger-point-saving.ts`

**Critérios de sucesso:**
- ✅ Interface `TriggerPointSaveData` contém todos os campos da tabela
- ✅ `prepareTriggerPointForDB()` mapeia todos os campos corretamente
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
   - `append`: Apenas INSERT (individual criar)
   - `replace_single`: DELETE por ID + INSERT novo (individual atualizar)

3. **Refatorar `saveTriggerPointsBatch()` para usar novo método**
   - Chamar `saveTriggerPoints()` com `mode: 'replace_all'`
   - Manter lock de processamento
   - Remover validação de duplicatas (RPC)
   - Remover filtro de confidence (>= 0.3)

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

**Arquivos a modificar:**
- `lib/services/trigger-point-saving.ts`

**Critérios de sucesso:**
- ✅ Método `deleteTriggerPoints()` funciona para todos e específicos
- ✅ Método `saveTriggerPoints()` suporta todos os modos
- ✅ `saveTriggerPointsBatch()` usa novo método e remove validação duplicatas
- ✅ Métodos `saveSingle()` e `updateSingle()` criados
- ✅ Lock de processamento mantido

---

## 📦 FASE 3: Atualizar Sistema em Massa (Processing Service)

**Objetivo**: Atualizar fluxo de geração em massa para usar novo salvamento

### Tarefas:

1. **Atualizar `lib/core/processing-service.ts`**
   - Remover lógica de contagem de duplicatas
   - Ajustar `skipped` (não haverá duplicatas, apenas validação de schema)
   - Garantir que todos os campos sejam passados para `TriggerPointSavingService`
   - Manter resto do fluxo (conversão, validação de schema, atualização de attraction)

**Arquivos a modificar:**
- `lib/core/processing-service.ts`

**Critérios de sucesso:**
- ✅ `processing-service.ts` usa novo `saveTriggerPointsBatch()`
- ✅ Contagem de `skipped` ajustada (sem duplicatas)
- ✅ Todos os campos são passados corretamente

---

## 📦 FASE 4: Atualizar API Routes Individuais (Create, Update, Delete)

**Objetivo**: Unificar API routes para usar serviço centralizado

### Tarefas:

1. **Atualizar `app/api/trigger-points/create/route.ts`**
   - Remover preparação manual de dados
   - Usar `TriggerPointSavingService.saveSingle()` com `mode: 'append'`
   - Mapear dados do request para `TriggerPointSaveData`
   - Manter mapeamento de user ID

2. **Atualizar `app/api/trigger-points/update/route.ts`**
   - Remover preparação manual de dados
   - Usar `TriggerPointSavingService.updateSingle()`
   - Mapear dados do request para `Partial<TriggerPointSaveData>`
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
   - Remover validação de duplicatas (RPC `validate_trigger_points_batch`)
   - Remover preparação manual de dados
   - Usar `TriggerPointSavingService.saveTriggerPoints()` com `mode: 'replace_all'`
   - Adicionar DELETE antes de INSERT
   - Ajustar contagem de duplicatas (remover)
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

3. **Limpeza:**
   - ✅ Remover código não utilizado
   - ✅ Remover comentários obsoletos
   - ✅ Verificar que não há imports não utilizados

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
   - Expandir interface
   - Criar métodos unificados
   - Remover validação duplicatas
   - Remover filtro confidence

2. **`lib/core/processing-service.ts`** (FASE 3)
   - Ajustar contagem skipped
   - Garantir campos completos

3. **`app/api/trigger-points/create/route.ts`** (FASE 4)
   - Usar serviço unificado

4. **`app/api/trigger-points/update/route.ts`** (FASE 4)
   - Usar serviço unificado

5. **`app/api/trigger-points/delete/route.ts`** (FASE 4)
   - Usar serviço unificado

6. **`app/api/trigger-points/generate-batch/route.ts`** (FASE 5)
   - Remover validação duplicatas
   - Usar serviço unificado

### Arquivos NÃO Modificados:

- `lib/services/trigger-points-google/utils/conversion.ts` (já está correto)
- `lib/services/trigger-points-google/utils/validation.ts` (validação de schema, não duplicatas)
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

## 🚨 Pontos de Atenção

1. **Lock de processamento**: Manter em `saveTriggerPointsBatch()` para evitar race conditions
2. **Mapeamento de user ID**: Manter em todas as API routes
3. **Formato de location**: Usar `SRID=4326;POINT(lng lat)` (não `POINT(lng lat)`)
4. **Valores padrão**: Garantir que todos os campos opcionais tenham defaults corretos
5. **Transações**: DELETE e INSERT são sequenciais (lock protege contra race conditions)

---

## 📝 Notas

- Não precisamos criar RPC no banco (fazer no front/API)
- Não precisamos manter filtro de confidence (sistema de geração já filtra)
- Todos os campos da tabela devem ser mapeados
- Código unificado facilita manutenção futura

