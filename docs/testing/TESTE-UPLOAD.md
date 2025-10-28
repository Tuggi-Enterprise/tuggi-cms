# 🧪 Teste de Upload - Supabase

## 📋 Pré-requisitos

1. **Servidor rodando**: `npm run dev`
2. **Migrations executadas**: `supabase db push`
3. **Node.js 18+**: Para suporte ao `fetch`

## 🚀 Como Executar os Testes

### 1. Teste Ultra-Simples (Recomendado)
```bash
node test-server.js
```
**O que testa**: Se o servidor está rodando e respondendo

### 2. Teste de Conexão
```bash
node test-supabase-connection.js
```
**O que testa**: Se as APIs do Supabase estão funcionando

### 3. Teste Completo de Upload
```bash
node test-upload.js
```
**O que testa**: Upload completo de POIs e coordenadas

### 4. Todos os Testes
```bash
node run-tests.js
```
**O que testa**: Todos os testes em sequência

## 📊 O que Cada Teste Verifica

### ✅ Teste do Servidor
- [ ] Servidor rodando na porta 3000
- [ ] API `/api/supabase/stats` respondendo
- [ ] Headers corretos

### ✅ Teste de Conexão
- [ ] API de POIs funcionando
- [ ] API de coordenadas funcionando  
- [ ] API de estatísticas funcionando
- [ ] Tabelas criadas no Supabase

### ✅ Teste de Upload
- [ ] Salvamento de POIs
- [ ] Salvamento de coordenadas
- [ ] Cálculo de distâncias
- [ ] Relacionamentos funcionando

## 🔧 Solução de Problemas

### ❌ "ECONNREFUSED"
```bash
# Servidor não está rodando
npm run dev
```

### ❌ "API failed: 500"
```bash
# Migrations não foram executadas
supabase db push
```

### ❌ "fetch is not defined"
```bash
# Node.js muito antigo
node --version  # Deve ser 18+
```

### ❌ "Missing uploadId or data"
```bash
# APIs não estão configuradas corretamente
# Verificar se as rotas existem
```

## 📈 Resultados Esperados

### ✅ Sucesso Total
```
🎉 [TEST] Todos os testes passaram! Sistema pronto!
✅ POIs salvos no Supabase
✅ Coordenadas salvas no Supabase  
✅ APIs funcionando corretamente
✅ Sistema pronto para uso!
```

### ⚠️ Parcial
```
✅ Servidor funcionando
✅ Conexão Supabase funcionando
❌ Upload falhou - verificar logs
```

### ❌ Falha Total
```
❌ Servidor não está rodando
❌ Migrations não executadas
❌ APIs não configuradas
```

## 🎯 Próximos Passos

1. **Se todos os testes passaram**: Sistema pronto para uso!
2. **Se alguns falharam**: Verificar logs e corrigir
3. **Se todos falharam**: Verificar configuração básica

## 📝 Logs Importantes

- **✅ Sucesso**: `POIs salvos com sucesso`
- **✅ Sucesso**: `Coordenadas salvas com sucesso`
- **❌ Erro**: `API failed: 500` - Verificar Supabase
- **❌ Erro**: `ECONNREFUSED` - Servidor não rodando
