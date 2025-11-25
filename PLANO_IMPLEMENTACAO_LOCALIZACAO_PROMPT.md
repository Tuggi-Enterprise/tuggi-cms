# Plano de Implementação - Restrições de Localização no Prompt

## 📍 Localizações Exatas no Código

### Arquivo: `lib/services/poi-processing/description.service.ts`

---

## 🔧 Modificação 1: Adicionar Constraint de Localização

### Localização no Código
**Linha:** Após linha 1933 (fim de `<constraint id="format">`)

### Código Atual:
```typescript
<constraint id="format">
- Prefer short sentences for text-to-speech
- No lists or bullet points
- Maximum ${maxWords} words
- Target: 30-85 words for ${audioTime} audio
</constraint>
</constraints>
```

### Código Modificado:
```typescript
<constraint id="format">
- Prefer short sentences for text-to-speech
- No lists or bullet points
- Maximum ${maxWords} words
- Target: 30-85 words for ${audioTime} audio
</constraint>

<constraint id="location" req="true" block="true">
- CRITICAL: The POI location is specified in the "loc" field of the data section below
- You MUST use ONLY the city and state from "loc" data - NEVER mention a different city or state
- If sources or historical knowledge mention a different city, IGNORE that information completely
- BLOCKING: Auto-reject if description mentions any city other than the one in "loc" data
- Example: If "loc" shows "c":"Rio de Janeiro", description MUST say "Rio de Janeiro" (never "Curitiba" or any other city)
</constraint>
</constraints>
```

**Justificativa:**
- ✅ Segue padrão de outras constraints críticas (`req="true" block="true"`)
- ✅ Não duplica com outras seções
- ✅ Local lógico dentro de `<constraints>`
- ✅ Instrução explícita e clara

---

## 🔧 Modificação 2: Modificar knowledge_policy

### Localização no Código
**Linhas:** 1969-1975

### Código Atual:
```typescript
<knowledge_policy>
- You may use established historical knowledge about Brazilian cities, regions, and landmarks
- Sources below are trusted references - draw reasonable conclusions based on source types and contexts
- Do NOT name or cite institutions/sources in the output text
- Use source context (official websites, government sources, cultural institutions) to inform description
- Distinguish: general historical context (allowed) vs. specific current claims (require source verification)
</knowledge_policy>
```

### Código Modificado:
```typescript
<knowledge_policy>
- You may use established historical knowledge about Brazilian cities, regions, and landmarks
- HOWEVER: If location data ("loc" field) is provided, you MUST use ONLY the city/state from that data
- NEVER use historical knowledge to infer or mention a different city than the one in location data
- If sources mention a different city, IGNORE that reference - use ONLY the city from "loc" data
- Sources below are trusted references - draw reasonable conclusions based on source types and contexts
- Do NOT name or cite institutions/sources in the output text
- Use source context (official websites, government sources, cultural institutions) to inform description
- Distinguish: general historical context (allowed) vs. specific current claims (require source verification)
</knowledge_policy>
```

**Justificativa:**
- ✅ Corrige o problema na origem (onde conhecimento histórico é permitido)
- ✅ Adiciona restrição explícita sem remover funcionalidade
- ✅ Não duplica com constraint (foca em **quando** usar conhecimento, não **como** validar)
- ✅ Mantém todas as outras regras intactas

---

## 🔧 Modificação 3 (OPCIONAL): Comentário no Context

### Localização no Código
**Linha:** Após linha 1986 (fim de `</data>`)

### Código Atual:
```typescript
}
</data>

${scrapedContentSection ? `<scraped_content>
```

### Código Modificado (OPCIONAL):
```typescript
}
</data>

⚠️ LOCATION DATA: Use ONLY the city/state from "loc" field above. See <constraint id="location"> for details.

${scrapedContentSection ? `<scraped_content>
```

**Justificativa:**
- ⚠️ Pode ajudar a reforçar visualmente
- ⚠️ Mas pode ser redundante se as constraints estiverem claras
- ⚠️ Adicionar apenas se necessário após testar sem ele

---

## 📊 Resumo das Modificações

| # | Modificação | Localização | Prioridade | Redundância? |
|---|-------------|-------------|------------|--------------|
| 1 | Adicionar `<constraint id="location">` | Após linha 1933 | 🔴 MÁXIMA | ❌ Não |
| 2 | Modificar `<knowledge_policy>` | Linhas 1969-1975 | 🔴 ALTA | ❌ Não |
| 3 | Comentário em `<context>` | Após linha 1986 | 🟡 BAIXA | ⚠️ Pode ser |

---

## ✅ Checklist de Implementação

- [ ] Adicionar constraint de localização em `<constraints>`
- [ ] Modificar `<knowledge_policy>` para incluir restrição geográfica
- [ ] Testar geração de descrição com POI do Rio de Janeiro
- [ ] Verificar que descrição não menciona outras cidades
- [ ] (Opcional) Adicionar comentário em `<context>` se necessário
- [ ] Atualizar sistema de verificação para validar localização (próxima etapa)

---

## 🎯 Resultado Esperado

Após as modificações:

1. **Constraint explícita** força uso apenas da cidade/estado dos dados
2. **knowledge_policy modificado** previne uso incorreto de conhecimento histórico
3. **Múltiplas camadas** de proteção sem redundâncias
4. **Estrutura mantida** - não altera organização do prompt

**Teste:** POI "Sala de Leitura da Cidade das Artes" em Rio de Janeiro deve gerar descrição mencionando **apenas** "Rio de Janeiro", nunca "Curitiba".

