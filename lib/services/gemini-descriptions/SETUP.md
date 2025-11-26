# Guia de Configuração - Gemini Description Service

## 📋 Requisitos para Usar o Serviço

### 1. ✅ API Key do Gemini (OBRIGATÓRIO)

Você precisa de uma **API Key do Google Gemini**. Não precisa configurar nada no GCP, apenas obter a chave.

#### Como Obter a API Key:

1. **Acesse o Google AI Studio**: https://ai.google.dev/aistudio/
2. **Faça login** com sua conta Google
3. **Clique em "Get API Key"** ou vá em "API Keys" no menu
4. **Crie uma nova API Key** ou use uma existente
5. **Copie a chave** (formato: `AIza...`)

#### Configurar no Projeto:

Adicione a variável de ambiente no seu `.env` ou `.env.local`:

```bash
# Opção 1 (prioridade)
GEMINI_API_KEY=AIzaSyC...sua_chave_aqui

# Opção 2 (fallback)
GOOGLE_GEMINI_API_KEY=AIzaSyC...sua_chave_aqui
```

**Ordem de Prioridade:**
1. O serviço primeiro tenta usar `GEMINI_API_KEY`
2. Se não encontrar, usa `GOOGLE_GEMINI_API_KEY`
3. Se nenhuma existir, retorna erro

**Nota**: Se você já tem `GEMINI_API_KEY` configurado no projeto, o serviço vai usar essa automaticamente. Se quiser usar especificamente `GOOGLE_GEMINI_API_KEY`, você pode remover ou renomear o `GEMINI_API_KEY`, ou simplesmente usar `GOOGLE_GEMINI_API_KEY` (o serviço vai usar se `GEMINI_API_KEY` não existir).

### 2. ❌ NÃO Precisa Passar Prompt

O serviço **já vem com prompts prontos**! Você pode usar os templates incluídos ou passar um customizado (opcional).

#### Opções de Uso:

**Opção A: Usar Templates Prontos (Recomendado)**
```typescript
// Usa o template "touristic" automaticamente
const result = await GeminiDescriptionService.generate({
  name: 'Cristo Redentor',
  city: 'Rio de Janeiro',
  country: 'Brazil'
}, {
  style: 'touristic' // ou 'historical', 'cultural', 'simple'
})
```

**Opção B: Prompt Customizado (Opcional)**
```typescript
// Se quiser usar seu próprio prompt
const result = await GeminiDescriptionService.generate({
  name: 'Cristo Redentor',
  city: 'Rio de Janeiro',
  country: 'Brazil'
}, {
  customPrompt: 'Sua descrição customizada aqui...'
})
```

### 3. ❌ NÃO Precisa Configurar no GCP

**Não é necessário**:
- ❌ Criar projeto no Google Cloud Platform
- ❌ Habilitar APIs no GCP Console
- ❌ Configurar billing
- ❌ Configurar IAM/permissões
- ❌ Instalar SDKs do Google Cloud

**O que você precisa**:
- ✅ Apenas a API Key do Google AI Studio
- ✅ A API Key já dá acesso direto à API do Gemini

### 4. ✅ Permissões na API

A API Key do Google AI Studio **já vem com as permissões necessárias** para usar a API do Gemini. Não precisa configurar permissões adicionais.

#### Limites da API Key:

- **Gratuita**: Até 15 requisições por minuto (modelo Flash-Lite)
- **Paga**: Limites maiores conforme seu plano
- **Rate Limiting**: O serviço já gerencia automaticamente

## 🚀 Exemplo de Uso Completo

### Passo 1: Configurar API Key

```bash
# .env ou .env.local
# Use uma das opções abaixo:

# Opção 1 (prioridade)
GEMINI_API_KEY=AIzaSyC...sua_chave_aqui

# Opção 2 (fallback - se GEMINI_API_KEY não existir)
GOOGLE_GEMINI_API_KEY=AIzaSyC...sua_chave_aqui
```

**Importante**: Se você já tem `GEMINI_API_KEY` no projeto, o serviço vai usar essa. Se quiser usar `GOOGLE_GEMINI_API_KEY` especificamente, certifique-se de que `GEMINI_API_KEY` não está definida, ou use apenas `GOOGLE_GEMINI_API_KEY`.

### Passo 2: Usar o Serviço

```typescript
import { GeminiDescriptionService } from '@/lib/services/gemini-descriptions/gemini-description.service'

// Uso simples - sem passar prompt
const result = await GeminiDescriptionService.generate({
  name: 'Praia de Copacabana',
  city: 'Rio de Janeiro',
  country: 'Brazil'
})

if (result.success) {
  console.log(result.description)
} else {
  console.error(result.error)
}
```

### Passo 3: Via API Endpoint

```bash
curl -X POST http://localhost:3000/api/gemini-descriptions/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu_token" \
  -d '{
    "name": "Praia de Copacabana",
    "city": "Rio de Janeiro",
    "country": "Brazil",
    "style": "touristic"
  }'
```

## 🔍 Verificação de Configuração

### Teste Rápido:

```typescript
import { GeminiDescriptionService } from '@/lib/services/gemini-descriptions/gemini-description.service'

try {
  const result = await GeminiDescriptionService.generate({
    name: 'Test POI',
    city: 'Test City',
    country: 'Brazil'
  })
  
  if (result.success) {
    console.log('✅ Configuração OK!')
    console.log('Descrição:', result.description)
  } else {
    console.error('❌ Erro:', result.error)
  }
} catch (error) {
  console.error('❌ Erro de configuração:', error.message)
  // Provavelmente falta a API Key
}
```

### Erros Comuns:

1. **"Gemini API key not configured"**
   - ✅ Solução: Adicione `GEMINI_API_KEY` ou `GOOGLE_GEMINI_API_KEY` no `.env`
   - 💡 Se já existe `GEMINI_API_KEY`, o serviço vai usar essa. Se quiser usar `GOOGLE_GEMINI_API_KEY`, certifique-se de que `GEMINI_API_KEY` não está definida.

2. **"Rate limit exceeded"**
   - ✅ Solução: Aguarde alguns segundos ou use um plano pago

3. **"Gemini API error 403"**
   - ✅ Solução: Verifique se a API Key está correta e ativa

4. **"Gemini API error 429"**
   - ✅ Solução: Você excedeu os limites. O serviço já gerencia isso automaticamente.

## 📊 Resumo dos Requisitos

| Item | Necessário? | Onde Obter |
|------|-------------|------------|
| API Key do Gemini | ✅ **SIM** | Google AI Studio (https://ai.google.dev/aistudio/) |
| Prompt | ❌ **NÃO** | Templates já incluídos |
| Configuração GCP | ❌ **NÃO** | Não necessário |
| Permissões Especiais | ❌ **NÃO** | API Key já inclui |
| Conta Google | ✅ **SIM** | Para obter a API Key |
| Billing GCP | ❌ **NÃO** | Só se quiser limites maiores |

## 🎯 Próximos Passos

1. ✅ Obter API Key no Google AI Studio
2. ✅ Adicionar `GEMINI_API_KEY` ou `GOOGLE_GEMINI_API_KEY` no `.env`
   - Se já existe `GEMINI_API_KEY` no projeto, o serviço vai usar essa
   - Se quiser usar `GOOGLE_GEMINI_API_KEY`, use apenas essa (ou remova `GEMINI_API_KEY`)
3. ✅ Testar com um POI simples
4. ✅ Ajustar estilo/template conforme necessário

---

**Dúvidas?** Consulte o [README.md](./README.md) para mais exemplos e detalhes.

