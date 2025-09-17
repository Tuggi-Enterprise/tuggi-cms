# Guia de Deploy - Trigger Points Google Migration

## 🚀 Visão Geral do Deploy

Este guia fornece instruções completas para fazer o deploy do sistema de trigger points migrado para Google APIs em diferentes ambientes.

## 📋 Pré-requisitos

### 1. Configuração do Ambiente
- Node.js 18+
- NPM ou Yarn
- Google Cloud Platform account
- Supabase project
- Vercel account (para deploy)

### 2. APIs e Serviços
- Google Maps APIs habilitadas
- Supabase database configurado
- Variáveis de ambiente configuradas

## 🔧 Configuração de Ambiente

### 1. Variáveis de Ambiente

```bash
# .env.production
# Google APIs
GOOGLE_MAPS_API_KEY=your_production_google_maps_api_key

# Supabase
SUPABASE_URL=your_production_supabase_url
SUPABASE_ANON_KEY=your_production_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_supabase_service_role_key

# Sistema
NODE_ENV=production
TRIGGER_POINTS_MAX_SEARCH_RADIUS=2000
TRIGGER_POINTS_MIN_QUALITY=0.3
TRIGGER_POINTS_CACHE_TTL=86400

# Rate Limiting
GOOGLE_API_RATE_LIMIT=1000
OSM_API_RATE_LIMIT=1

# Timeouts
GOOGLE_API_TIMEOUT=10000
OSM_API_TIMEOUT=15000

# Cache
CACHE_TTL_GEOGRAPHIC=86400
CACHE_TTL_BOUNDARY=604800
CACHE_TTL_STREETS=3600
```

### 2. Configuração do Google Cloud Platform

```bash
# 1. Criar projeto no Google Cloud
gcloud projects create tuggi-trigger-points --name="Tuggi Trigger Points"

# 2. Configurar billing
gcloud billing accounts list
gcloud billing projects link tuggi-trigger-points --billing-account=BILLING_ACCOUNT_ID

# 3. Habilitar APIs necessárias
gcloud services enable places-backend.googleapis.com
gcloud services enable roads.googleapis.com
gcloud services enable streetview.googleapis.com
gcloud services enable elevation.googleapis.com

# 4. Criar API key
gcloud services api-keys create --display-name="Tuggi Trigger Points API Key"
```

### 3. Configuração do Supabase

```sql
-- Criar tabelas necessárias
CREATE TABLE IF NOT EXISTS core.trigger_points_google (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id UUID REFERENCES core.attractions(id),
  location GEOGRAPHY(POINT, 4326),
  radius_meters INTEGER,
  expected_bearing DECIMAL(5,2),
  bearing_threshold DECIMAL(5,2),
  type VARCHAR(20),
  priority INTEGER,
  confidence_score DECIMAL(3,2),
  quality_score DECIMAL(3,2),
  street_data JSONB,
  distance_meters DECIMAL(8,2),
  generation_method VARCHAR(50),
  context_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índices
CREATE INDEX idx_trigger_points_google_attraction_id ON core.trigger_points_google(attraction_id);
CREATE INDEX idx_trigger_points_google_location ON core.trigger_points_google USING GIST(location);
CREATE INDEX idx_trigger_points_google_type ON core.trigger_points_google(type);
CREATE INDEX idx_trigger_points_google_confidence ON core.trigger_points_google(confidence_score);

-- Criar função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_trigger_points_google_updated_at 
  BEFORE UPDATE ON core.trigger_points_google 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

## 🏗️ Build e Preparação

### 1. Build do Projeto

```bash
# Instalar dependências
npm install

# Executar testes
npm run test

# Build para produção
npm run build

# Verificar build
npm run build:check
```

### 2. Scripts de Build

```json
{
  "scripts": {
    "build": "next build",
    "build:check": "next build && next start --port 3001",
    "build:analyze": "ANALYZE=true next build",
    "test": "jest",
    "test:ci": "jest --ci --coverage --watchAll=false",
    "lint": "next lint",
    "lint:fix": "next lint --fix"
  }
}
```

### 3. Verificação de Qualidade

```bash
# Linting
npm run lint

# Type checking
npm run type-check

# Testes de integração
npm run test:integration

# Testes de performance
npm run test:performance
```

## 🚀 Deploy para Produção

### 1. Deploy no Vercel

```bash
# Instalar Vercel CLI
npm install -g vercel

# Login no Vercel
vercel login

# Deploy
vercel --prod

# Configurar variáveis de ambiente
vercel env add GOOGLE_MAPS_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

### 2. Configuração do Vercel

```json
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/next"
    }
  ],
  "env": {
    "GOOGLE_MAPS_API_KEY": "@google-maps-api-key",
    "SUPABASE_URL": "@supabase-url",
    "SUPABASE_SERVICE_ROLE_KEY": "@supabase-service-role-key"
  },
  "functions": {
    "app/api/trigger-points/generate-google/route.ts": {
      "maxDuration": 30
    },
    "app/api/trigger-points/generate-batch-google/route.ts": {
      "maxDuration": 60
    }
  }
}
```

### 3. Deploy Manual

```bash
# 1. Build do projeto
npm run build

# 2. Upload para servidor
scp -r .next/ user@server:/path/to/app/
scp -r public/ user@server:/path/to/app/
scp package.json user@server:/path/to/app/
scp package-lock.json user@server:/path/to/app/

# 3. Instalar dependências no servidor
ssh user@server "cd /path/to/app && npm ci --production"

# 4. Reiniciar aplicação
ssh user@server "pm2 restart tuggi-cms"
```

## 🔄 Deploy Automatizado

### 1. GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run test:ci
      - run: npm run lint
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run build
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: '--prod'
```

### 2. Configuração de Secrets

```bash
# Configurar secrets no GitHub
gh secret set VERCEL_TOKEN --body "your_vercel_token"
gh secret set ORG_ID --body "your_vercel_org_id"
gh secret set PROJECT_ID --body "your_vercel_project_id"
gh secret set GOOGLE_MAPS_API_KEY --body "your_google_maps_api_key"
gh secret set SUPABASE_URL --body "your_supabase_url"
gh secret set SUPABASE_SERVICE_ROLE_KEY --body "your_supabase_service_role_key"
```

## 📊 Monitoramento

### 1. Health Checks

```typescript
// app/api/health/trigger-points/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const healthChecks = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    services: {
      googleAPIs: await checkGoogleAPIs(),
      supabase: await checkSupabase(),
      cache: await checkCache()
    }
  };
  
  const allHealthy = Object.values(healthChecks.services).every(status => status === 'up');
  healthChecks.status = allHealthy ? 'healthy' : 'unhealthy';
  
  return NextResponse.json(healthChecks, {
    status: allHealthy ? 200 : 503
  });
}

async function checkGoogleAPIs(): Promise<'up' | 'down'> {
  try {
    // Teste simples da API
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${process.env.GOOGLE_MAPS_API_KEY}`);
    return response.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

async function checkSupabase(): Promise<'up' | 'down'> {
  try {
    // Teste de conexão com Supabase
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY!
      }
    });
    return response.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

async function checkCache(): Promise<'up' | 'down'> {
  // Implementar verificação de cache
  return 'up';
}
```

### 2. Métricas de Performance

```typescript
// lib/monitoring/metrics.ts
export class MetricsCollector {
  private static metrics: Map<string, any> = new Map();
  
  static recordAPICall(api: string, duration: number, success: boolean) {
    const key = `api.${api}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        calls: 0,
        totalDuration: 0,
        successes: 0,
        failures: 0
      });
    }
    
    const metric = this.metrics.get(key);
    metric.calls++;
    metric.totalDuration += duration;
    
    if (success) {
      metric.successes++;
    } else {
      metric.failures++;
    }
  }
  
  static recordTriggerPointGeneration(poiId: string, duration: number, count: number) {
    const key = 'trigger_points.generation';
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        totalGenerations: 0,
        totalDuration: 0,
        totalTriggerPoints: 0,
        averageDuration: 0,
        averageTriggerPoints: 0
      });
    }
    
    const metric = this.metrics.get(key);
    metric.totalGenerations++;
    metric.totalDuration += duration;
    metric.totalTriggerPoints += count;
    metric.averageDuration = metric.totalDuration / metric.totalGenerations;
    metric.averageTriggerPoints = metric.totalTriggerPoints / metric.totalGenerations;
  }
  
  static getMetrics() {
    return Object.fromEntries(this.metrics);
  }
}
```

### 3. Logging Estruturado

```typescript
// lib/logging/logger.ts
export class Logger {
  static info(message: string, context?: any) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      context,
      timestamp: new Date().toISOString()
    }));
  }
  
  static error(message: string, error?: Error, context?: any) {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error?.message,
      stack: error?.stack,
      context,
      timestamp: new Date().toISOString()
    }));
  }
  
  static warn(message: string, context?: any) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      context,
      timestamp: new Date().toISOString()
    }));
  }
}
```

## 🔒 Segurança

### 1. Rate Limiting

```typescript
// lib/security/rate-limiter.ts
import { NextRequest } from 'next/server';

export class RateLimiter {
  private static requests: Map<string, number[]> = new Map();
  
  static checkRateLimit(ip: string, limit: number = 100, window: number = 3600): boolean {
    const now = Date.now();
    const windowStart = now - (window * 1000);
    
    if (!this.requests.has(ip)) {
      this.requests.set(ip, []);
    }
    
    const userRequests = this.requests.get(ip)!;
    
    // Remove requests outside the window
    const validRequests = userRequests.filter(time => time > windowStart);
    this.requests.set(ip, validRequests);
    
    if (validRequests.length >= limit) {
      return false;
    }
    
    validRequests.push(now);
    return true;
  }
}
```

### 2. Validação de Input

```typescript
// lib/validation/input-validator.ts
export class InputValidator {
  static validatePOIData(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!data.id || typeof data.id !== 'string') {
      errors.push('POI ID is required and must be a string');
    }
    
    if (!data.name || typeof data.name !== 'string') {
      errors.push('POI name is required and must be a string');
    }
    
    if (!data.location || typeof data.location !== 'object') {
      errors.push('POI location is required and must be an object');
    } else {
      if (typeof data.location.lat !== 'number' || data.location.lat < -90 || data.location.lat > 90) {
        errors.push('POI latitude must be a number between -90 and 90');
      }
      
      if (typeof data.location.lng !== 'number' || data.location.lng < -180 || data.location.lng > 180) {
        errors.push('POI longitude must be a number between -180 and 180');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}
```

## 📈 Otimização de Performance

### 1. Caching

```typescript
// lib/cache/cache-manager.ts
import NodeCache from 'node-cache';

export class CacheManager {
  private static cache = new NodeCache({
    stdTTL: 3600, // 1 hour default
    checkperiod: 600 // 10 minutes
  });
  
  static set(key: string, value: any, ttl?: number) {
    this.cache.set(key, value, ttl);
  }
  
  static get(key: string) {
    return this.cache.get(key);
  }
  
  static del(key: string) {
    this.cache.del(key);
  }
  
  static flush() {
    this.cache.flushAll();
  }
  
  static getStats() {
    return this.cache.getStats();
  }
}
```

### 2. Connection Pooling

```typescript
// lib/database/connection-pool.ts
import { createClient } from '@supabase/supabase-js';

export class DatabaseConnectionPool {
  private static clients: Map<string, any> = new Map();
  
  static getClient(connectionString: string) {
    if (!this.clients.has(connectionString)) {
      const client = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          db: {
            schema: 'core'
          }
        }
      );
      
      this.clients.set(connectionString, client);
    }
    
    return this.clients.get(connectionString);
  }
}
```

## 🚨 Troubleshooting

### 1. Problemas Comuns

```bash
# Erro de API key
Error: The provided API key is invalid
Solution: Verificar se a API key está correta e as APIs estão habilitadas

# Erro de quota
Error: OVER_QUERY_LIMIT
Solution: Verificar quotas no Google Cloud Console

# Erro de timeout
Error: Request timeout
Solution: Aumentar timeout ou otimizar queries

# Erro de memória
Error: JavaScript heap out of memory
Solution: Aumentar limite de memória ou otimizar processamento
```

### 2. Logs de Debug

```typescript
// Habilitar logs detalhados
process.env.DEBUG = 'trigger-points:*';

// Verificar logs no Vercel
vercel logs --follow

// Verificar logs no servidor
pm2 logs tuggi-cms
```

## 📋 Checklist de Deploy

### Pré-Deploy
- [ ] Testes passando
- [ ] Build funcionando
- [ ] Variáveis de ambiente configuradas
- [ ] APIs habilitadas
- [ ] Database configurado

### Deploy
- [ ] Deploy executado com sucesso
- [ ] Health checks passando
- [ ] Métricas sendo coletadas
- [ ] Logs funcionando
- [ ] Rate limiting ativo

### Pós-Deploy
- [ ] Testes de integração passando
- [ ] Performance dentro dos limites
- [ ] Monitoramento ativo
- [ ] Alertas configurados
- [ ] Backup funcionando

Este guia garante um deploy seguro e eficiente do sistema de trigger points migrado para Google APIs.
