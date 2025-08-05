// Exemplo de como aplicar os middlewares de segurança em uma rota de API
// Este arquivo serve como referência para implementação

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { withAdvancedSecurity } from '@/lib/advanced-security-middleware'
import { withValidation } from '@/lib/validation-middleware'
import { z } from 'zod'
import { InputValidator } from '@/lib/input-validation'

// Exemplo 1: API com segurança básica (autenticação + rate limiting)
export const basicSecureAPI = withAuth(withRateLimit(100, 60000)(async function(request: NextRequest) {
  // Sua lógica de API aqui
  return NextResponse.json({ message: 'Success' })
}))

// Exemplo 2: API com validação de entrada
const validationSchema = {
  searchParams: {
    name: z.string().min(1).max(100),
    email: z.string().email().optional()
  },
  body: z.object({
    description: z.string().min(1).max(500),
    category: z.enum(['tourism', 'restaurant', 'hotel'])
  })
}

export const validatedAPI = withAuth(
  withRateLimit(50, 60000)(
    withValidation(validationSchema)(async function(request: NextRequest, validatedData: any) {
      // Os dados já estão validados e sanitizados
      const { searchParams, body } = validatedData
      
      // Sua lógica de API aqui
      return NextResponse.json({ 
        message: 'Data processed successfully',
        data: { searchParams, body }
      })
    })
  )
)

// Exemplo 3: API com segurança avançada completa
export const fullySecureAPI = withAuth(
  withRateLimit(30, 60000)(
    withAdvancedSecurity({
      enableIPBlocking: true,
      enableSuspiciousActivityDetection: true,
      enableRequestAnalysis: true,
      maxRequestSize: 5 * 1024 * 1024, // 5MB
      allowedMethods: ['GET', 'POST'],
      requireHTTPS: true
    })(
      withValidation({
        searchParams: {
          id: z.string().uuid(),
          format: z.enum(['json', 'xml']).optional()
        }
      })(async function(request: NextRequest, validatedData: any) {
        // API com máxima segurança
        return NextResponse.json({ 
          message: 'Highly secure endpoint accessed successfully',
          timestamp: new Date().toISOString()
        })
      })
    )
  )
)

// Exemplo 4: API específica para upload de arquivos
export const fileUploadAPI = withAuth(
  withRateLimit(10, 60000)( // Limite mais restritivo para uploads
    withAdvancedSecurity({
      maxRequestSize: 50 * 1024 * 1024, // 50MB para uploads
      allowedMethods: ['POST'],
      requireHTTPS: true
    })(async function(request: NextRequest) {
      // Validação manual para multipart/form-data
      const contentType = request.headers.get('content-type')
      if (!contentType?.includes('multipart/form-data')) {
        return NextResponse.json(
          { error: 'Only multipart/form-data allowed for file uploads' },
          { status: 400 }
        )
      }
      
      try {
        const formData = await request.formData()
        const file = formData.get('file') as File
        
        if (!file) {
          return NextResponse.json(
            { error: 'No file provided' },
            { status: 400 }
          )
        }
        
        // Validação adicional do arquivo
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
        if (!allowedTypes.includes(file.type)) {
          return NextResponse.json(
            { error: 'File type not allowed' },
            { status: 400 }
          )
        }
        
        if (file.size > 10 * 1024 * 1024) { // 10MB
          return NextResponse.json(
            { error: 'File too large' },
            { status: 400 }
          )
        }
        
        // Processar upload aqui
        return NextResponse.json({ 
          message: 'File uploaded successfully',
          filename: file.name,
          size: file.size
        })
        
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to process upload' },
          { status: 500 }
        )
      }
    })
  )
)

// Exemplo 5: API pública com segurança limitada (sem autenticação)
export const publicAPI = withRateLimit(200, 60000)( // Rate limiting mais permissivo
  withAdvancedSecurity({
    enableIPBlocking: true,
    enableSuspiciousActivityDetection: true,
    enableRequestAnalysis: true,
    allowedMethods: ['GET'],
    requireHTTPS: false // Permitir HTTP para desenvolvimento
  })(
    withValidation({
      searchParams: {
        query: z.string().min(1).max(100),
        limit: z.coerce.number().int().min(1).max(50).default(10)
      }
    })(async function(request: NextRequest, validatedData: any) {
      const { searchParams } = validatedData
      
      // API pública com dados não sensíveis
      return NextResponse.json({ 
        message: 'Public data accessed',
        query: searchParams.query,
        limit: searchParams.limit,
        results: [] // Seus dados aqui
      })
    })
  )
)

/*
COMO USAR ESTES EXEMPLOS:

1. Para uma nova rota de API, copie um dos exemplos acima
2. Ajuste os parâmetros de segurança conforme necessário:
   - Rate limiting: ajuste o número de requisições e janela de tempo
   - Validação: defina schemas apropriados para seus dados
   - Segurança avançada: configure as opções conforme o nível de segurança necessário

3. Substitua a lógica de exemplo pela sua implementação

4. Teste a API para garantir que a segurança está funcionando:
   - Teste com dados inválidos (deve retornar erro 400)
   - Teste excedendo rate limit (deve retornar erro 429)
   - Teste sem autenticação quando necessária (deve retornar erro 401)
   - Teste com IPs bloqueados (deve retornar erro 403)

LEMBRETE: Sempre teste suas APIs em ambiente de desenvolvimento antes de fazer deploy!
*/