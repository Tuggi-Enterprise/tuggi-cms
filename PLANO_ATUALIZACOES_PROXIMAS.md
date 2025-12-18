# Plano de Atualizações Adicionais - Dependências Seguras

**Status:** Após correção de arquivos corrompidos  
**Data:** 18 de dezembro de 2025

---

## 📊 Atualizações Ainda Disponíveis

### ✅ SEGURAS - Podem ser aplicadas agora

#### 1. **tsx** → 4.21.0
**Atual:** 4.20.6 → **4.21.0**  
**Tipo:** PATCH  
**Risco:** MUITO BAIXO

- Executador TypeScript com melhorias menores
- Sem impacto em runtime da aplicação
- Recomendado: **SIM** - aplicar imediatamente

```bash
npm install tsx@4.21.0 --save-dev
```

---

#### 2. **better-sqlite3** → 12.5.0
**Atual:** 12.4.6 → **12.5.0**  
**Tipo:** PATCH  
**Risco:** MUITO BAIXO

- Biblioteca SQLite com melhorias menores
- Sem breaking changes
- Recomendado: **SIM** - aplicar imediatamente

```bash
npm install better-sqlite3@12.5.0 --save-dev
```

---

#### 3. **@types/node** → 25.0.3 (Opcional)
**Atual:** 20.19.27 → **25.0.3**  
**Tipo:** MAJOR (mas só tipos)  
**Risco:** BAIXO

- Apenas melhoria de types TypeScript
- Sem impacto em runtime
- Pode aumentar erros de linting se código antigo
- Recomendado: **SIM, mas com cuidado** - validar depois

```bash
npm install @types/node@25.0.3 --save-dev
```

---

### ⚠️ NÃO RECOMENDADO (Breaking Changes - Requerem Refatoração)

#### ❌ Não fazer agora:
- `eslint` → 9.x (breaking changes, requer novo .eslintrc)
- `react` → 19.x (breaking changes em componentes)
- `next` → 16.x (major upgrade complexo)
- `tailwindcss` → 4.x (requer @tailwindcss/postcss)
- `@supabase/auth-helpers` → 0.15 (descontinuado)
- `@types/react` → 19.x (acompanha React, não aplique sem React 19)
- `@types/react-dom` → 19.x (acompanha React DOM, não aplique sem React 19)

---

## 🎯 Recomendação Imediata

**Aplicar as atualizações seguras AGORA:**

```bash
# 1. Update simples e seguro
npm install tsx@4.21.0 better-sqlite3@12.5.0 @types/node@25.0.3 --save-dev

# 2. Validar build
npm run build

# 3. Se passou, fazer commit
git add package.json package-lock.json
git commit -m "chore: atualizar dependências seguras (tsx, better-sqlite3, @types/node)"
```

**Tempo estimado:** 5 minutos

---

## 📋 Status Geral de Atualizações

| Pacote | Tipo | Status | Ação |
|--------|------|--------|------|
| **tsx** | PATCH | ✅ Pronto | Aplicar agora |
| **better-sqlite3** | PATCH | ✅ Pronto | Aplicar agora |
| **@types/node** | MAJOR (tipos) | ✅ Pronto | Aplicar com validação |
| eslint | MAJOR | ❌ Futuro | Requer refatoração |
| tailwindcss | MAJOR | ❌ Futuro | Requer @tailwindcss/postcss |
| react/react-dom | MAJOR | ❌ Futuro | Aguardar ecossistema |
| next | MAJOR | ❌ Futuro | Aguardar estabilização |

---

## 🚀 Próximas Fases (Não agora)

### Fase A: ESLint 9 (2-3 dias)
- Requer migração para flat config
- Pode quebrar algumas regras atuais

### Fase B: Tailwind CSS 4.x (2-3 dias)
- Requer instalação de @tailwindcss/postcss
- Mudança no PostCSS config

### Fase C: React 19 + Next.js 16 (3-5 dias)
- Maior esforço
- Múltiplos breaking changes
- Refatoração de componentes necessária

---

## ✅ Checklist para Agora

- [ ] Aplicar tsx 4.21.0
- [ ] Aplicar better-sqlite3 12.5.0  
- [ ] Aplicar @types/node 25.0.3
- [ ] Executar `npm run build` - deve passar
- [ ] Executar `npm run lint` - verificar novos warnings
- [ ] Fazer commit e push
- [ ] Testar em `npm run dev` - verificar no browser

**Após isso:** Projeto terá atualizações menores aplicadas, pronto para decisão sobre próximas fases maiores.
