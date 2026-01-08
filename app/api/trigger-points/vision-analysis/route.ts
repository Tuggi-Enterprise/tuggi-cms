import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface VisionAnalysisRequest {
  poiId: string
  poiLat: number
  poiLng: number
  mapZoom?: number
  useHighResolution?: boolean
}

interface VisionTriggerPoint {
  lat: number
  lng: number
  type: 'primary' | 'secondary' | 'fallback'
  reasoning: string
  confidence: number
  visualContext: string
}

interface VisionAnalysisResult {
  success: boolean
  triggerPoints: VisionTriggerPoint[]
  analysisText: string
  mapAnalysis: {
    lakeShape: string
    roadNetwork: string
    accessPoints: string[]
    strategicLocations: string[]
  }
  error?: string
}

export async function POST(request: NextRequest) {
  // Require admin for analysis endpoints
  const cookieStore = await cookies()
  const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
  if (authError || !session) {
    return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
  }
  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single()
  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
  }

  // TEMPORARILY DISABLED - AI trigger points functionality
  console.log('🚫 Vision analysis API temporarily disabled')
  
  return NextResponse.json({
    success: false,
    triggerPoints: [],
    analysisText: '',
    mapAnalysis: {
      lakeShape: '',
      roadNetwork: '',
      accessPoints: [],
      strategicLocations: []
    },
    error: 'Vision analysis API is temporarily disabled - AI trigger points functionality has been temporarily disabled'
  }, { status: 503 })
}

async function captureMultipleMapViews(lat: number, lng: number, zoom: number, useHighResolution: boolean): Promise<{
  mainView: string
  satelliteView: string
  hybridView: string
}> {
  console.log('📸 Capturing multiple automated map views...')
  
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new Error('Google Maps API key not found')
  }

  const size = useHighResolution ? '1024x768' : '800x600'
  const scale = useHighResolution ? '2' : '1'

  // 1. Vista principal (roadmap) - mostra ruas e nomes
  const roadmapUrl = `https://maps.googleapis.com/maps/api/staticmap?` +
    `center=${lat},${lng}&` +
    `zoom=${zoom}&` +
    `size=${size}&` +
    `scale=${scale}&` +
    `maptype=roadmap&` +
    `markers=color:red%7Csize:mid%7C${lat},${lng}&` +
    `key=${apiKey}`

  // 2. Vista de satélite - mostra geografia real
  const satelliteUrl = `https://maps.googleapis.com/maps/api/staticmap?` +
    `center=${lat},${lng}&` +
    `zoom=${zoom}&` +
    `size=${size}&` +
    `scale=${scale}&` +
    `maptype=satellite&` +
    `markers=color:red%7Csize:mid%7C${lat},${lng}&` +
    `key=${apiKey}`

  // 3. Vista híbrida - combina satélite com ruas
  const hybridUrl = `https://maps.googleapis.com/maps/api/staticmap?` +
    `center=${lat},${lng}&` +
    `zoom=${zoom}&` +
    `size=${size}&` +
    `scale=${scale}&` +
    `maptype=hybrid&` +
    `markers=color:red%7Csize:mid%7C${lat},${lng}&` +
    `key=${apiKey}`

  // Capturar todas as imagens em paralelo
  const [roadmapResponse, satelliteResponse, hybridResponse] = await Promise.all([
    fetch(roadmapUrl),
    fetch(satelliteUrl),
    fetch(hybridUrl)
  ])

  if (!roadmapResponse.ok || !satelliteResponse.ok || !hybridResponse.ok) {
    throw new Error('Failed to capture one or more map views')
  }

  const [roadmapBuffer, satelliteBuffer, hybridBuffer] = await Promise.all([
    roadmapResponse.arrayBuffer(),
    satelliteResponse.arrayBuffer(),
    hybridResponse.arrayBuffer()
  ])

  const mapImages = {
    mainView: Buffer.from(roadmapBuffer).toString('base64'),
    satelliteView: Buffer.from(satelliteBuffer).toString('base64'),
    hybridView: Buffer.from(hybridBuffer).toString('base64')
  }
  
  console.log('✅ Multiple automated map views captured successfully')
  return mapImages
}

async function analyzeMapWithGeminiVision(imageBase64: string, poiLat: number, poiLng: number) {
  console.log('🤖 Analyzing map with Gemini Vision...')
  
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('Gemini API key not found')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })

  const prompt = `
Você é um especialista em análise geográfica e posicionamento de trigger points para áudio-guias.

Analise esta imagem de mapa e identifique os MELHORES locais para colocar trigger points ao redor do POI marcado em vermelho.

CONTEXTO:
- POI está localizado em: ${poiLat}, ${poiLng}
- Trigger points são áreas onde visitantes passam e devem ouvir áudio sobre o POI
- Precisamos de 8-12 pontos estratégicos ao redor do POI

ANÁLISE NECESSÁRIA:

1. FORMA E CARACTERÍSTICAS DO POI:
   - Que tipo de local é? (lago, parque, prédio, etc.)
   - Qual o formato e tamanho aproximado?
   - Quais são as extremidades/bordas importantes?

2. REDE VIÁRIA:
   - Identifique TODAS as ruas ao redor (principais e pequenas)
   - Onde as ruas se aproximam mais do POI?
   - Quais intersecções são estratégicas?

3. PONTOS DE ACESSO:
   - Onde as pessoas podem chegar ao POI?
   - Quais ruas dão acesso direto?
   - Onde ficam as entradas principais?

4. PONTOS DE VISIBILIDADE:
   - De onde se tem a melhor vista do POI?
   - Quais locais oferecem perspectivas diferentes?
   - Onde as pessoas naturalmente param para observar?

RESPOSTA ESPERADA:
Forneça uma análise detalhada em JSON com:
{
  "analysis": "Descrição completa do que você vê",
  "mapAnalysis": {
    "lakeShape": "Descrição da forma do POI",
    "roadNetwork": "Descrição das vias ao redor",
    "accessPoints": ["Lista de pontos de acesso identificados"],
    "strategicLocations": ["Lista de locais estratégicos para trigger points"]
  },
  "recommendedPoints": [
    {
      "location": "Descrição do local (ex: 'Intersecção da Rua X com Y')",
      "reasoning": "Por que este ponto é estratégico",
      "priority": "primary/secondary/fallback",
      "visualContext": "O que se vê neste local"
    }
  ]
}

SEJA MUITO ESPECÍFICO e identifique pontos que as APIs tradicionais perderiam!
  `

  const imagePart = {
    inlineData: {
      data: imageBase64,
      mimeType: 'image/png'
    }
  }

  const result = await model.generateContent([prompt, imagePart])
  const response = await result.response
  const text = response.text()

  console.log('✅ Gemini Vision analysis complete')
  
  // Tentar extrair JSON da resposta
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.warn('⚠️ Could not parse JSON from Gemini response, using text analysis')
  }

  // Fallback: usar análise de texto
  return {
    analysis: text,
    mapAnalysis: {
      lakeShape: 'Análise textual disponível',
      roadNetwork: 'Ver análise completa',
      accessPoints: ['Pontos identificados na análise'],
      strategicLocations: ['Locais estratégicos na análise']
    },
    recommendedPoints: []
  }
}

async function convertVisionToTriggerPoints(visionResult: any, poiLat: number, poiLng: number): Promise<VisionTriggerPoint[]> {
  console.log('🎯 Converting vision analysis to trigger points...')
  
  const triggerPoints: VisionTriggerPoint[] = []
  
  if (visionResult.recommendedPoints && Array.isArray(visionResult.recommendedPoints)) {
    visionResult.recommendedPoints.forEach((point: any, index: number) => {
      // Para cada ponto recomendado, estimar coordenadas baseadas na descrição
      // Em uma implementação real, isso seria mais sofisticado
      const estimatedCoords = estimateCoordinatesFromDescription(point.location, poiLat, poiLng, index)
      
      triggerPoints.push({
        lat: estimatedCoords.lat,
        lng: estimatedCoords.lng,
        type: point.priority || 'secondary',
        reasoning: point.reasoning || 'Ponto identificado por análise visual',
        confidence: 0.85, // Alta confiança da análise visual
        visualContext: point.visualContext || point.location
      })
    })
  }

  // Se não há pontos específicos, criar baseado na análise geral
  if (triggerPoints.length === 0) {
    // Criar pontos baseados na análise textual
    const defaultPoints = generateDefaultPointsFromAnalysis(visionResult.analysis, poiLat, poiLng)
    triggerPoints.push(...defaultPoints)
  }

  console.log(`✅ Generated ${triggerPoints.length} trigger points from vision analysis`)
  return triggerPoints
}

function estimateCoordinatesFromDescription(description: string, baseLat: number, baseLng: number, index: number): {lat: number, lng: number} {
  // Algoritmo simples para estimar coordenadas baseado na descrição
  // Em uma implementação real, isso seria muito mais sofisticado
  
  const radius = 0.003 // ~300m
  const angle = (index * 45) * (Math.PI / 180) // Distribuir em círculo
  
  const lat = baseLat + (radius * Math.cos(angle))
  const lng = baseLng + (radius * Math.sin(angle))
  
  return { lat, lng }
}

function generateDefaultPointsFromAnalysis(analysis: string, baseLat: number, baseLng: number): VisionTriggerPoint[] {
  // Gerar pontos padrão se a análise não retornou pontos específicos
  const points: VisionTriggerPoint[] = []
  const angles = [0, 45, 90, 135, 180, 225, 270, 315]
  
  angles.forEach((angle, index) => {
    const radian = (angle * Math.PI) / 180
    const radius = 0.002 // ~200m
    const lat = baseLat + (radius * Math.cos(radian))
    const lng = baseLng + (radius * Math.sin(radian))
    
    points.push({
      lat,
      lng,
      type: index < 4 ? 'primary' : 'secondary',
      reasoning: 'Ponto gerado baseado em análise visual geral',
      confidence: 0.7,
      visualContext: `Ponto ${index + 1} baseado em análise de imagem`
    })
  })
  
  return points
}
