# 🔐 Implementação de Segurança - Tuggi CMS

Este documento detalha todas as medidas de segurança implementadas no Tuggi CMS e como utilizá-las.

## 📚 Arquivos de Segurança

### 1. Sistema de Logging (`lib/security-logger.ts`)

**Funcionalidade**: Sistema centralizado para registrar eventos de segurança.

**Como usar**:
```typescript
import { securityLogger } from '@/lib/security-logger'

// Registrar falha de autenticação
await securityLogger.logAuthFailure(request, 'Invalid credentials')

// Registrar atividade suspeita
await securityLogger.logSuspiciousActivity(request, 'Multiple failed attempts', userId)

// Registrar violação de rate limit
await securityLogger.logRateLimitExceeded(request, 100)
```

### 2. Validação de Entrada (`lib/input-validation.ts`)

**Funcionalidade**: Validação e sanitização robusta de dados de entrada.

**Como usar**:
```typescript
import { InputValidator, schemas } from '@/lib/input-validation'

// Validar e sanitizar dados
const result = InputValidator.validateAndSanitize(schemas.safeString, userInput)
if (result.success) {
  // Usar result.data (dados limpos)
} else {
  // Tratar erro: result.error
}
```

### 3. Middleware de Validação (`lib/validation-middleware.ts`)

**Funcionalidade**: Middleware para aplicar validação automaticamente em rotas de API.

**Como usar**:
```typescript
import { withValidation } from '@/lib/validation-middleware'
import { z } from 'zod'

const schema = {
  searchParams: {
    id: z.string().uuid(),
    name: z.string().min(1).max(100)
  }
}

export const GET = withValidation(schema)(async (request, validatedData) => {
  // validatedData.searchParams já está validado
  return NextResponse.json({ success: true })
})
```

### 4. Monitor de Segurança (`lib/security-monitor.ts`)

**Funcionalidade**: Monitoramento em tempo real de atividades suspeitas.

**Como usar**:
```typescript
import { securityMonitor } from '@/lib/security-monitor'

// Verificar se IP está bloqueado
if (securityMonitor.isIPBlocked(clientIP)) {
  return NextResponse.json({ error: 'Access denied' }, { status: 403 })
}

// Analisar requisição
const analysis = await securityMonitor.analyzeRequest(request)
if (analysis.riskLevel === 'critical') {
  // Tomar ação apropriada
}
```

### 5. Middleware de Segurança Avançado (`lib/advanced-security-middleware.ts`)

**Funcionalidade**: Middleware completo com múltiplas camadas de proteção.

**Como usar**:
```typescript
import { withAdvancedSecurity } from '@/lib/advanced-security-middleware'

export const POST = withAdvancedSecurity({
  enableIPBlocking: true,
  enableSuspiciousActivityDetection: true,
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  requireHTTPS: true
})(async (request) => {
  // Sua lógica de API aqui
  return NextResponse.json({ success: true })
})
```

### 6. Middleware de Autenticação Atualizado (`lib/auth-middleware.ts`)

**Funcionalidade**: Autenticação com logging de segurança integrado.

**Como usar**:
```typescript
import { withAuth, withRateLimit } from '@/lib/auth-middleware'

export const GET = withAuth(
  withRateLimit(100, 60000)(async (request) => {
    // API protegida com autenticação e rate limiting
    return NextResponse.json({ data: 'protected' })
  })
)
```

## 🛠️ Scripts de Segurança

### Auditoria de Segurança

```bash
# Executar auditoria completa
npm run security:audit

# Verificar vulnerabilidades em dependências
npm run security:check

# Corrigir vulnerabilidades automaticamente
npm run security:fix
```

## 📋 Padrões de Implementação

### 1. Para APIs Públicas (sem autenticação)

```typescript
import { withRateLimit } from '@/lib/auth-middleware'
import { withAdvancedSecurity } from '@/lib/advanced-security-middleware'
import { withValidation } from '@/lib/validation-middleware'

export const GET = withRateLimit(200, 60000)(
  withAdvancedSecurity({
    enableIPBlocking: true,
    allowedMethods: ['GET']
  })(
    withValidation({
      searchParams: {
        query: z.string().min(1).max(100)
      }
    })(async (request, validatedData) => {
      // Lógica da API pública
    })
  )
)
```

### 2. Para APIs Protegidas (com autenticação)

```typescript
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { withAdvancedSecurity } from '@/lib/advanced-security-middleware'
import { withValidation } from '@/lib/validation-middleware'

export const POST = withAuth(
  withRateLimit(50, 60000)(
    withAdvancedSecurity({
      enableIPBlocking: true,
      enableSuspiciousActivityDetection: true,
      requireHTTPS: true
    })(
      withValidation({
        body: z.object({
          name: z.string().min(1).max(200),
          data: z.any()
        })
      })(async (request, validatedData) => {
        // Lógica da API protegida
      })
    )
  )
)
```

### 3. Para APIs de Upload de Arquivos

```typescript
export const POST = withAuth(
  withRateLimit(10, 60000)(
    withAdvancedSecurity({
      maxRequestSize: 50 * 1024 * 1024, // 50MB
      allowedMethods: ['POST'],
      requireHTTPS: true
    })(async (request) => {
      // Validação manual para multipart/form-data
      const contentType = request.headers.get('content-type')
      if (!contentType?.includes('multipart/form-data')) {
        return NextResponse.json({ error: 'Invalid content type' }, { status: 400 })
      }
      
      // Lógica de upload
    })
  )
)
```

## 🔍 Monitoramento e Alertas

### Eventos de Segurança Registrados

1. **Falhas de Autenticação**: Tentativas de login inválidas
2. **Violações de Rate Limit**: Excesso de requisições
3. **Atividades Suspeitas**: Comportamentos anômalos
4. **Acessos Não Autorizados**: Tentativas de acesso a recursos protegidos
5. **Erros de API**: Falhas internas que podem indicar ataques

### Níveis de Severidade

- **Low**: Eventos normais de segurança
- **Medium**: Eventos que requerem atenção
- **High**: Eventos que indicam possível ataque
- **Critical**: Eventos que requerem ação imediata

## 🚨 Resposta a Incidentes

### Bloqueio Automático de IPs

O sistema bloqueia automaticamente IPs que:
- Fazem mais de 5 tentativas de login falhadas
- Violam rate limits mais de 3 vezes
- Apresentam comportamento suspeito consistente

### Desbloqueio Manual

```typescript
// Para desbloquear um IP manualmente (implementar conforme necessário)
import { securityMonitor } from '@/lib/security-monitor'

// Verificar métricas atuais
const metrics = securityMonitor.getSecurityMetrics()
console.log('IPs bloqueados:', metrics.blockedIPs)
```

## 📊 Métricas de Segurança

O sistema coleta as seguintes métricas:

- Número de tentativas de login falhadas
- Violações de rate limit por IP
- IPs marcados como suspeitos
- IPs atualmente bloqueados
- Tipos de ataques detectados

## 🔧 Configuração de Produção

### Variáveis de Ambiente Recomendadas

```bash
# Segurança
NODE_ENV=production
NEXT_PUBLIC_ENVIRONMENT=production

# Rate Limiting (ajustar conforme necessário)
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
SECURITY_LOG_LEVEL=info
SECURITY_LOG_DESTINATION=external_service

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### Headers de Segurança (já configurados)

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy: [configurado]`

## 🔄 Manutenção Regular

### Tarefas Semanais

1. Executar `npm run security:audit`
2. Revisar logs de segurança
3. Verificar IPs bloqueados
4. Atualizar dependências: `npm run security:fix`

### Tarefas Mensais

1. Revisar e atualizar schemas de validação
2. Analisar padrões de ataques
3. Ajustar limites de rate limiting se necessário
4. Testar procedimentos de resposta a incidentes

### Tarefas Trimestrais

1. Realizar testes de penetração
2. Revisar e atualizar políticas de segurança
3. Treinar equipe em novos procedimentos
4. Avaliar necessidade de novas medidas de segurança

## 📞 Suporte e Troubleshooting

### Problemas Comuns

**IP bloqueado incorretamente**:
- Verificar logs para entender o motivo do bloqueio
- Implementar whitelist para IPs confiáveis se necessário

**Rate limiting muito restritivo**:
- Ajustar limites nos middlewares
- Considerar diferentes limites para diferentes tipos de usuários

**Falsos positivos em validação**:
- Revisar schemas de validação
- Adicionar casos especiais se necessário

### Logs de Debug

Em desenvolvimento, todos os eventos de segurança são logados no console. Em produção, configure um serviço de logging externo (Datadog, Sentry, CloudWatch, etc.).

---

**Lembre-se**: A segurança é um processo contínuo. Mantenha-se atualizado com as melhores práticas e atualize regularmente as medidas de proteção.