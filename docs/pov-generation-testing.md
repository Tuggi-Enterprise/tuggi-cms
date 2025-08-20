# 🧪 POV Generation Testing Guide

Este documento explica como testar a funcionalidade de geração automática de Pontos de Observação (POVs) usando o Gemini 1.5.

## 📋 Pré-requisitos

1. **Banco de dados atualizado** com os novos campos:
   - `name` (text)
   - `description` (text) 
   - `access` (text) - com constraint CHECK

2. **Variáveis de ambiente configuradas**:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   GOOGLE_GEMINI_API_KEY=your_gemini_api_key
   ```

## 🚀 Como Testar

### 1. Listar Attractions Disponíveis

```bash
npm run list:attractions
```

Este comando lista as últimas 20 attractions com coordenadas disponíveis para teste.

### 2. Executar Teste de Geração de POVs

```bash
# Teste básico (apenas geração)
npm run test:pov <attraction-id>

# Teste com salvamento no banco
npm run test:pov <attraction-id> --save
```

**Exemplo:**
```bash
npm run test:pov 123e4567-e89b-12d3-a456-426614174000
```

## 📊 O que o Teste Faz

1. **Busca a attraction** no banco de dados
2. **Gera POVs** usando o Gemini 1.5
3. **Valida e exibe** os POVs gerados
4. **Transforma** POVs em Trigger Points
5. **Salva no banco** (se `--save` for usado)

## 🔍 Saída Esperada

```
🧪 Starting POV Generation Test...

🔍 Fetching attraction data...
✅ Attraction found:
   Name: Cristo Redentor
   City: Rio de Janeiro, Brazil
   Coordinates: -22.9519, -43.2105

🤖 Generating POVs with Gemini 1.5...
✅ POVs generated successfully!
   Total POVs: 8

📍 Generated POVs:
   1. Mirante do Corcovado
      Coordinates: -22.9519, -43.2105
      Distance: 150m
      Azimuth: 45°
      Access: both
      Vantage: overlook

   2. Estrada das Paineiras
      Coordinates: -22.9525, -43.2110
      Distance: 300m
      Azimuth: 90°
      Access: car
      Vantage: highway

🔄 Transforming to Trigger Points...
✅ Trigger Points created:
   1. Mirante do Corcovado
      Type: primary
      Priority: 1
      Access: both
      Radius: 150m
      Bearing: 45°

💾 Saving Trigger Points to database...
✅ Saved: Mirante do Corcovado
✅ Saved: Estrada das Paineiras

🎉 POV Generation Test completed successfully!
```

## ⚠️ Troubleshooting

### Erro: "Rate limit exceeded"
- Aguarde alguns segundos e tente novamente
- O sistema tem rate limiting de 15 requests/minuto

### Erro: "No JSON found in response"
- O Gemini pode ter retornado uma resposta malformada
- Verifique o prompt e tente novamente

### Erro: "Invalid attraction data"
- Verifique se a attraction tem coordenadas válidas
- Certifique-se de que o ID está correto

## 🔧 Configurações

### Rate Limiting
- **Requests por minuto**: 15
- **Cooldown entre requests**: 4 segundos
- **Requests por hora**: 1000

### Validações
- Coordenadas com 6 casas decimais
- Azimute entre 0-360°
- Distância em metros (inteiro)
- Acesso: 'walk', 'car', 'both'

## 📈 Métricas

O sistema registra métricas de cada geração:
- Tempo de geração
- Número de POVs gerados
- Taxa de sucesso
- Erros encontrados

## 🎯 Próximos Passos

Após os testes bem-sucedidos:
1. Integrar no frontend (TriggerPointsManager)
2. Adicionar botão "Gerar POVs Automáticos"
3. Implementar cache para evitar regenerações
4. Adicionar métricas no dashboard
