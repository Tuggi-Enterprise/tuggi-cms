# Gemini Description Service

Módulo novo e limpo para obtenção de descrições usando Gemini via Google AI Studio. Este módulo foi projetado para ser reutilizável em outros contextos e funciona em paralelo com o sistema de descrições existente para comparação.

## 📋 Visão Geral

Este módulo oferece uma alternativa mais simples e direta para geração de descrições de POIs usando a API do Gemini. Diferente do sistema atual, este módulo:

- **Prompts mais simples**: Templates diretos e fáceis de ajustar
- **Código limpo**: Estrutura modular e fácil de entender
- **Flexível**: Fácil de customizar para diferentes casos de uso
- **Reutilizável**: Pode ser usado em outros contextos além de POIs
- **Independente**: Não depende de serviços complexos (OSM, scraping, etc.)

## 🏗️ Estrutura

```
lib/services/gemini-descriptions/
├── gemini-description.service.ts  # Serviço principal
├── types.ts                        # Interfaces e tipos
├── prompts.ts                      # Templates de prompts
├── config.ts                       # Configurações
└── README.md                       # Esta documentação
```

## 🚀 Uso Básico

### Como Serviço

```typescript
import { GeminiDescriptionService } from '@/lib/services/gemini-descriptions/gemini-description.service'
import type { POIData } from '@/lib/services/gemini-descriptions/types'

const poiData: POIData = {
  name: 'Cristo Redentor',
  city: 'Rio de Janeiro',
  country: 'Brazil'
}

const result = await GeminiDescriptionService.generate(poiData, {
  style: 'touristic',
  language: 'pt-br',
  maxWords: 120
})

if (result.success) {
  console.log(result.description)
}
```

### Via API

```bash
POST /api/gemini-descriptions/generate
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "Cristo Redentor",
  "city": "Rio de Janeiro",
  "country": "Brazil",
  "style": "touristic",
  "model": "gemini-2.5-flash-lite"
}
```

## ⚙️ Opções de Configuração

### Estilos de Prompt

- **`touristic`** (padrão): Tom amigável e envolvente, ideal para guias de áudio
- **`historical`**: Foco em fatos históricos e importância histórica
- **`cultural`**: Ênfase em significado cultural e patrimonial
- **`simple`**: Descrição simples e objetiva

### Modelos Gemini

- **`gemini-2.5-flash-lite`** (padrão): Rápido, ideal para descrições simples
- **`gemini-2.5-flash`**: Balanceado, bom para descrições históricas/culturais
- **`gemini-2.5-pro`**: Mais poderoso, para casos complexos

### Parâmetros de Geração

```typescript
const options: GeminiDescriptionOptions = {
  model: 'gemini-2.5-flash-lite',
  style: 'touristic',
  language: 'pt-br',
  maxWords: 120,
  audioDuration: '30s',
  temperature: 0.7,    // Criatividade (0.0-1.0)
  topK: 40,            // Diversidade de tokens
  topP: 0.8,           // Nucleus sampling
  maxTokens: 8192,     // Máximo de tokens de saída
  validate: true       // Validar descrição gerada
}
```

## 📝 Exemplos de Uso

### Exemplo 1: Descrição Turística Simples

```typescript
const result = await GeminiDescriptionService.generate({
  name: 'Praia de Copacabana',
  city: 'Rio de Janeiro',
  country: 'Brazil'
}, {
  style: 'touristic',
  maxWords: 100
})
```

### Exemplo 2: Descrição Histórica Detalhada

```typescript
const result = await GeminiDescriptionService.generate({
  name: 'Museu do Ipiranga',
  city: 'São Paulo',
  country: 'Brazil'
}, {
  style: 'historical',
  model: 'gemini-2.5-flash',
  maxWords: 150,
  additionalContext: 'Fundado em 1895, importante para a história do Brasil'
})
```

### Exemplo 3: Prompt Customizado

```typescript
const result = await GeminiDescriptionService.generate({
  name: 'Parque Ibirapuera',
  city: 'São Paulo',
  country: 'Brazil'
}, {
  customPrompt: 'Crie uma descrição poética sobre {{name}} em {{city}}, focando na natureza e arquitetura.',
  maxWords: 120
})
```

### Exemplo 4: Geração com Prompt Direto

```typescript
const description = await GeminiDescriptionService.generateWithPrompt(
  'Descreva o Cristo Redentor em português brasileiro, máximo 100 palavras.',
  {
    model: 'gemini-2.5-flash-lite',
    temperature: 0.8
  }
)
```

## 🔄 Comparação com Sistema Atual

### Sistema Atual (`DescriptionService`)

- ✅ Enriquecimento OSM
- ✅ Scraping de fontes
- ✅ Sistema de verificação complexo
- ✅ Cache de cidade
- ✅ Análise de qualidade detalhada
- ❌ Código mais complexo
- ❌ Prompts muito longos
- ❌ Muitas dependências

### Novo Módulo (`GeminiDescriptionService`)

- ✅ Código simples e limpo
- ✅ Prompts diretos e ajustáveis
- ✅ Flexível e reutilizável
- ✅ Menos dependências
- ✅ Rate limiting integrado
- ❌ Sem enriquecimento OSM (por design)
- ❌ Sem scraping (por design)
- ❌ Validação simplificada

## 🎯 Quando Usar Cada Sistema

### Use o Novo Módulo (`GeminiDescriptionService`) quando:

- Você precisa de descrições rápidas e simples
- Você quer prompts facilmente customizáveis
- Você precisa reutilizar em outros contextos
- Você quer menos dependências
- Você está testando diferentes abordagens

### Use o Sistema Atual (`DescriptionService`) quando:

- Você precisa de enriquecimento com dados OSM
- Você quer scraping automático de fontes
- Você precisa de verificação detalhada
- Você quer cache e otimizações avançadas
- Você precisa de análise de qualidade completa

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Obrigatório
GEMINI_API_KEY=your_api_key_here

# Ou alternativamente
GOOGLE_GEMINI_API_KEY=your_api_key_here
```

### Configuração de Rate Limiting

O rate limiting é configurado automaticamente por modelo em `config.ts`:

```typescript
{
  'gemini-2.5-flash-lite': {
    requestsPerMinute: 20,
    requestsPerHour: 2000,
    cooldownMs: 3000
  },
  // ...
}
```

## 📊 Validação

O módulo inclui validação simplificada que verifica:

- ✅ Tamanho da descrição (palavras)
- ✅ Presença de conteúdo proibido (telefones, preços, horários)
- ✅ Menção ao nome do POI
- ✅ Pontuação básica (0-100)

Para validação mais detalhada, use o sistema atual.

## 🧪 Testes

### Teste Básico

```typescript
import { GeminiDescriptionService } from '@/lib/services/gemini-descriptions/gemini-description.service'

const result = await GeminiDescriptionService.generate({
  name: 'Test POI',
  city: 'Test City',
  country: 'Brazil'
})

console.log(result.success ? result.description : result.error)
```

### Teste de Validação

```typescript
const validation = await GeminiDescriptionService.validate(
  'Descrição de teste sobre um POI interessante.',
  'Test POI'
)

console.log(`Aprovada: ${validation.aprovada}, Pontuação: ${validation.pontuacao}`)
```

## 🔮 Próximos Passos

1. **Testes Comparativos**: Comparar resultados do novo vs. antigo
2. **Ajustes de Prompt**: Refinar prompts baseado em resultados
3. **Otimização**: Ajustar parâmetros e modelos
4. **Migração Gradual**: Se resultados forem melhores, migrar gradualmente
5. **Expansão**: Adicionar suporte para outros casos de uso

## 📚 Referências

- [Google AI Studio](https://ai.google.dev/aistudio/)
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Sistema Atual de Descrições](../poi-processing/description.service.ts)

## 🤝 Contribuindo

Ao fazer alterações neste módulo:

1. Mantenha a simplicidade
2. Documente mudanças nos prompts
3. Teste com diferentes estilos e modelos
4. Compare resultados com o sistema atual
5. Atualize esta documentação

---

**Versão**: 1.0.0  
**Última atualização**: 2024

