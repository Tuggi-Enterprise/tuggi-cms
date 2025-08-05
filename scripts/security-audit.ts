#!/usr/bin/env tsx

/**
 * Script de Auditoria de Segurança do Tuggi CMS
 * 
 * Este script verifica várias medidas de segurança implementadas no sistema
 * e gera um relatório detalhado do status de segurança.
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

interface SecurityCheck {
  name: string
  description: string
  status: 'pass' | 'fail' | 'warning'
  details?: string
  recommendation?: string
}

class SecurityAuditor {
  private checks: SecurityCheck[] = []
  private projectRoot: string
  
  constructor() {
    this.projectRoot = process.cwd()
  }
  
  async runAudit(): Promise<void> {
    console.log('🔍 Iniciando Auditoria de Segurança do Tuggi CMS\n')
    
    // Executar todas as verificações
    await this.checkAuthMiddleware()
    await this.checkRateLimiting()
    await this.checkInputValidation()
    await this.checkSecurityHeaders()
    await this.checkEnvironmentVariables()
    await this.checkGitignore()
    await this.checkDependencies()
    await this.checkFilePermissions()
    await this.checkCORSConfiguration()
    await this.checkSecurityLogging()
    
    // Gerar relatório
    this.generateReport()
  }
  
  private async checkAuthMiddleware(): Promise<void> {
    const authMiddlewarePath = path.join(this.projectRoot, 'lib/auth-middleware.ts')
    
    if (fs.existsSync(authMiddlewarePath)) {
      const content = fs.readFileSync(authMiddlewarePath, 'utf8')
      
      if (content.includes('withAuth') && content.includes('withRateLimit')) {
        this.checks.push({
          name: 'Middleware de Autenticação',
          description: 'Verificar se o middleware de autenticação está implementado',
          status: 'pass',
          details: 'Middleware de autenticação e rate limiting encontrados'
        })
      } else {
        this.checks.push({
          name: 'Middleware de Autenticação',
          description: 'Verificar se o middleware de autenticação está implementado',
          status: 'fail',
          details: 'Middleware incompleto',
          recommendation: 'Implementar funções withAuth e withRateLimit'
        })
      }
    } else {
      this.checks.push({
        name: 'Middleware de Autenticação',
        description: 'Verificar se o middleware de autenticação está implementado',
        status: 'fail',
        details: 'Arquivo de middleware não encontrado',
        recommendation: 'Criar lib/auth-middleware.ts'
      })
    }
  }
  
  private async checkRateLimiting(): Promise<void> {
    const apiRoutes = this.findAPIRoutes()
    let protectedRoutes = 0
    let totalRoutes = apiRoutes.length
    
    for (const route of apiRoutes) {
      const content = fs.readFileSync(route, 'utf8')
      if (content.includes('withRateLimit') || content.includes('withAuth')) {
        protectedRoutes++
      }
    }
    
    const percentage = totalRoutes > 0 ? (protectedRoutes / totalRoutes) * 100 : 0
    
    if (percentage >= 90) {
      this.checks.push({
        name: 'Rate Limiting',
        description: 'Verificar se as rotas de API têm rate limiting',
        status: 'pass',
        details: `${protectedRoutes}/${totalRoutes} rotas protegidas (${percentage.toFixed(1)}%)`
      })
    } else if (percentage >= 70) {
      this.checks.push({
        name: 'Rate Limiting',
        description: 'Verificar se as rotas de API têm rate limiting',
        status: 'warning',
        details: `${protectedRoutes}/${totalRoutes} rotas protegidas (${percentage.toFixed(1)}%)`,
        recommendation: 'Proteger mais rotas de API'
      })
    } else {
      this.checks.push({
        name: 'Rate Limiting',
        description: 'Verificar se as rotas de API têm rate limiting',
        status: 'fail',
        details: `${protectedRoutes}/${totalRoutes} rotas protegidas (${percentage.toFixed(1)}%)`,
        recommendation: 'Implementar rate limiting em todas as rotas de API'
      })
    }
  }
  
  private async checkInputValidation(): Promise<void> {
    const validationPath = path.join(this.projectRoot, 'lib/input-validation.ts')
    const middlewarePath = path.join(this.projectRoot, 'lib/validation-middleware.ts')
    
    if (fs.existsSync(validationPath) && fs.existsSync(middlewarePath)) {
      this.checks.push({
        name: 'Validação de Entrada',
        description: 'Verificar se há sistema de validação de entrada',
        status: 'pass',
        details: 'Sistema de validação implementado com Zod e DOMPurify'
      })
    } else {
      this.checks.push({
        name: 'Validação de Entrada',
        description: 'Verificar se há sistema de validação de entrada',
        status: 'fail',
        details: 'Sistema de validação não encontrado',
        recommendation: 'Implementar validação de entrada com Zod'
      })
    }
  }
  
  private async checkSecurityHeaders(): Promise<void> {
    const nextConfigPath = path.join(this.projectRoot, 'next.config.js')
    
    if (fs.existsSync(nextConfigPath)) {
      const content = fs.readFileSync(nextConfigPath, 'utf8')
      
      const requiredHeaders = [
        'X-Frame-Options',
        'X-Content-Type-Options',
        'Referrer-Policy',
        'Permissions-Policy'
      ]
      
      const foundHeaders = requiredHeaders.filter(header => content.includes(header))
      
      if (foundHeaders.length === requiredHeaders.length) {
        this.checks.push({
          name: 'Headers de Segurança',
          description: 'Verificar se headers de segurança estão configurados',
          status: 'pass',
          details: `Todos os headers essenciais configurados: ${foundHeaders.join(', ')}`
        })
      } else {
        this.checks.push({
          name: 'Headers de Segurança',
          description: 'Verificar se headers de segurança estão configurados',
          status: 'warning',
          details: `Headers encontrados: ${foundHeaders.join(', ')}`,
          recommendation: `Adicionar headers faltantes: ${requiredHeaders.filter(h => !foundHeaders.includes(h)).join(', ')}`
        })
      }
    } else {
      this.checks.push({
        name: 'Headers de Segurança',
        description: 'Verificar se headers de segurança estão configurados',
        status: 'fail',
        details: 'next.config.js não encontrado',
        recommendation: 'Configurar headers de segurança no Next.js'
      })
    }
  }
  
  private async checkEnvironmentVariables(): Promise<void> {
    const envExamplePath = path.join(this.projectRoot, '.env.example')
    const envPath = path.join(this.projectRoot, '.env')
    const envLocalPath = path.join(this.projectRoot, '.env.local')
    
    let status: 'pass' | 'fail' | 'warning' = 'pass'
    let details = ''
    let recommendation = ''
    
    if (!fs.existsSync(envExamplePath)) {
      status = 'warning'
      details += '.env.example não encontrado. '
      recommendation += 'Criar .env.example com variáveis de exemplo. '
    }
    
    if (fs.existsSync(envPath)) {
      status = 'fail'
      details += '.env commitado no repositório. '
      recommendation += 'Remover .env do repositório e adicionar ao .gitignore. '
    }
    
    if (fs.existsSync(envLocalPath)) {
      status = 'fail'
      details += '.env.local commitado no repositório. '
      recommendation += 'Remover .env.local do repositório. '
    }
    
    if (status === 'pass') {
      details = 'Configuração de variáveis de ambiente adequada'
    }
    
    this.checks.push({
      name: 'Variáveis de Ambiente',
      description: 'Verificar se variáveis de ambiente estão seguras',
      status,
      details,
      recommendation: recommendation || undefined
    })
  }
  
  private async checkGitignore(): Promise<void> {
    const gitignorePath = path.join(this.projectRoot, '.gitignore')
    
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8')
      
      const requiredPatterns = [
        '.env',
        '.env.local',
        'node_modules',
        '*.log'
      ]
      
      const foundPatterns = requiredPatterns.filter(pattern => content.includes(pattern))
      
      if (foundPatterns.length === requiredPatterns.length) {
        this.checks.push({
          name: 'Configuração .gitignore',
          description: 'Verificar se .gitignore está configurado adequadamente',
          status: 'pass',
          details: 'Todos os padrões essenciais encontrados'
        })
      } else {
        this.checks.push({
          name: 'Configuração .gitignore',
          description: 'Verificar se .gitignore está configurado adequadamente',
          status: 'warning',
          details: `Padrões faltantes: ${requiredPatterns.filter(p => !foundPatterns.includes(p)).join(', ')}`,
          recommendation: 'Adicionar padrões faltantes ao .gitignore'
        })
      }
    } else {
      this.checks.push({
        name: 'Configuração .gitignore',
        description: 'Verificar se .gitignore está configurado adequadamente',
        status: 'fail',
        details: '.gitignore não encontrado',
        recommendation: 'Criar arquivo .gitignore'
      })
    }
  }
  
  private async checkDependencies(): Promise<void> {
    try {
      const auditResult = execSync('npm audit --audit-level=high --json', { encoding: 'utf8' })
      const audit = JSON.parse(auditResult)
      
      if (audit.metadata.vulnerabilities.high === 0 && audit.metadata.vulnerabilities.critical === 0) {
        this.checks.push({
          name: 'Dependências',
          description: 'Verificar vulnerabilidades em dependências',
          status: 'pass',
          details: 'Nenhuma vulnerabilidade crítica ou alta encontrada'
        })
      } else {
        this.checks.push({
          name: 'Dependências',
          description: 'Verificar vulnerabilidades em dependências',
          status: 'fail',
          details: `${audit.metadata.vulnerabilities.critical} críticas, ${audit.metadata.vulnerabilities.high} altas`,
          recommendation: 'Executar npm audit fix para corrigir vulnerabilidades'
        })
      }
    } catch (error) {
      this.checks.push({
        name: 'Dependências',
        description: 'Verificar vulnerabilidades em dependências',
        status: 'warning',
        details: 'Não foi possível executar npm audit',
        recommendation: 'Verificar manualmente as dependências'
      })
    }
  }
  
  private async checkFilePermissions(): Promise<void> {
    const sensitiveFiles = [
      '.env',
      '.env.local',
      'package.json',
      'next.config.js'
    ]
    
    let hasIssues = false
    const issues: string[] = []
    
    for (const file of sensitiveFiles) {
      const filePath = path.join(this.projectRoot, file)
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath)
          const mode = stats.mode & parseInt('777', 8)
          
          // Verificar se o arquivo é legível por outros (muito permissivo)
          if (mode & parseInt('044', 8)) {
            hasIssues = true
            issues.push(`${file} é legível por outros usuários`)
          }
        } catch (error) {
          // Ignorar erros de permissão em sistemas que não suportam
        }
      }
    }
    
    if (!hasIssues) {
      this.checks.push({
        name: 'Permissões de Arquivo',
        description: 'Verificar permissões de arquivos sensíveis',
        status: 'pass',
        details: 'Permissões adequadas em arquivos sensíveis'
      })
    } else {
      this.checks.push({
        name: 'Permissões de Arquivo',
        description: 'Verificar permissões de arquivos sensíveis',
        status: 'warning',
        details: issues.join(', '),
        recommendation: 'Ajustar permissões de arquivos sensíveis'
      })
    }
  }
  
  private async checkCORSConfiguration(): Promise<void> {
    const corsPath = path.join(this.projectRoot, 'supabase/functions/_shared/cors.ts')
    
    if (fs.existsSync(corsPath)) {
      const content = fs.readFileSync(corsPath, 'utf8')
      
      if (content.includes("'*'")) {
        this.checks.push({
          name: 'Configuração CORS',
          description: 'Verificar configuração CORS das funções Supabase',
          status: 'warning',
          details: 'CORS configurado para permitir todas as origens (*)',
          recommendation: 'Restringir CORS para domínios específicos em produção'
        })
      } else {
        this.checks.push({
          name: 'Configuração CORS',
          description: 'Verificar configuração CORS das funções Supabase',
          status: 'pass',
          details: 'CORS configurado com restrições adequadas'
        })
      }
    } else {
      this.checks.push({
        name: 'Configuração CORS',
        description: 'Verificar configuração CORS das funções Supabase',
        status: 'warning',
        details: 'Arquivo de configuração CORS não encontrado',
        recommendation: 'Verificar configuração CORS das funções Supabase'
      })
    }
  }
  
  private async checkSecurityLogging(): Promise<void> {
    const loggerPath = path.join(this.projectRoot, 'lib/security-logger.ts')
    const monitorPath = path.join(this.projectRoot, 'lib/security-monitor.ts')
    
    if (fs.existsSync(loggerPath) && fs.existsSync(monitorPath)) {
      this.checks.push({
        name: 'Logging de Segurança',
        description: 'Verificar se sistema de logging de segurança está implementado',
        status: 'pass',
        details: 'Sistema de logging e monitoramento de segurança implementado'
      })
    } else {
      this.checks.push({
        name: 'Logging de Segurança',
        description: 'Verificar se sistema de logging de segurança está implementado',
        status: 'fail',
        details: 'Sistema de logging de segurança não encontrado',
        recommendation: 'Implementar sistema de logging de eventos de segurança'
      })
    }
  }
  
  private findAPIRoutes(): string[] {
    const apiDir = path.join(this.projectRoot, 'app/api')
    const routes: string[] = []
    
    if (!fs.existsSync(apiDir)) {
      return routes
    }
    
    const findRoutes = (dir: string) => {
      const items = fs.readdirSync(dir)
      
      for (const item of items) {
        const itemPath = path.join(dir, item)
        const stat = fs.statSync(itemPath)
        
        if (stat.isDirectory()) {
          findRoutes(itemPath)
        } else if (item === 'route.ts' || item === 'route.js') {
          routes.push(itemPath)
        }
      }
    }
    
    findRoutes(apiDir)
    return routes
  }
  
  private generateReport(): void {
    const passed = this.checks.filter(c => c.status === 'pass').length
    const warnings = this.checks.filter(c => c.status === 'warning').length
    const failed = this.checks.filter(c => c.status === 'fail').length
    const total = this.checks.length
    
    console.log('\n📊 RELATÓRIO DE AUDITORIA DE SEGURANÇA')
    console.log('=' .repeat(50))
    console.log(`✅ Aprovado: ${passed}/${total}`)
    console.log(`⚠️  Avisos: ${warnings}/${total}`)
    console.log(`❌ Falhou: ${failed}/${total}`)
    console.log(`\n📈 Score de Segurança: ${((passed / total) * 100).toFixed(1)}%`)
    
    console.log('\n📋 DETALHES DAS VERIFICAÇÕES')
    console.log('=' .repeat(50))
    
    for (const check of this.checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warning' ? '⚠️' : '❌'
      console.log(`\n${icon} ${check.name}`)
      console.log(`   ${check.description}`)
      console.log(`   Status: ${check.details}`)
      
      if (check.recommendation) {
        console.log(`   💡 Recomendação: ${check.recommendation}`)
      }
    }
    
    // Resumo final
    console.log('\n🎯 RESUMO E PRÓXIMOS PASSOS')
    console.log('=' .repeat(50))
    
    if (failed > 0) {
      console.log('❗ AÇÃO URGENTE NECESSÁRIA:')
      this.checks.filter(c => c.status === 'fail').forEach(check => {
        console.log(`   • ${check.name}: ${check.recommendation}`)
      })
    }
    
    if (warnings > 0) {
      console.log('\n⚠️  MELHORIAS RECOMENDADAS:')
      this.checks.filter(c => c.status === 'warning').forEach(check => {
        console.log(`   • ${check.name}: ${check.recommendation}`)
      })
    }
    
    if (failed === 0 && warnings === 0) {
      console.log('🎉 Parabéns! Todas as verificações de segurança passaram!')
      console.log('   Continue monitorando e atualizando as medidas de segurança regularmente.')
    }
    
    console.log('\n📅 Execute esta auditoria regularmente para manter a segurança do sistema.')
  }
}

// Executar auditoria se o script for chamado diretamente
if (require.main === module) {
  const auditor = new SecurityAuditor()
  auditor.runAudit().catch(console.error)
}

export { SecurityAuditor }