import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabase } from '@/lib/core/supabase-client'

export const dynamic = 'force-dynamic'

/**
 * API Endpoint: Get list of POIs candidates for migration
 * GET /api/migration/list-candidates
 */
/**
 * PORTÃO: `withAuth({ roles: ['admin'] })`, desde 2026-09-01.
 *
 * Antes, a Única checagem era "existe sessão" — nenhuma linha deste arquivo lia `role` nem
 * `cms_users`. Logo abaixo, o módulo instancia `getSupabase('service')`. Ou seja: qualquer conta
 * do CMS com sessão (um `client`, que é um parceiro) disparava o pipeline de migração — escrita
 * em `core.attractions`, geração de descrição e áudio com custo de LLM/TTS, leitura do schema
 * `homolog` inteiro. A tela `/poi-processing` é admin-only pelo proxy; a API que ela consome
 * não era, e o proxy não cobre `/api`.
 *
 * `withAuth` também troca `getSession()` por `getUser()`, que revalida o JWT contra o servidor
 * de Auth — ver o cabeçalho de `lib/auth-middleware.ts`.
 */
export const GET = withAuth({ roles: ['admin'] }, async (request) => {
  try {
    // Use service role client for data fetching to ensure we can see homolog schema
    const supabaseService = getSupabase('service')

    const searchParams = request.nextUrl.searchParams
    const country = searchParams.get('country')
    const state = searchParams.get('state')
    const city = searchParams.get('city')
    const processingStatus = searchParams.get('processing_status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const source = searchParams.get('source') || 'homolog'

    // Configure query target
    const targetSchema = source === 'core' ? 'core' : 'homolog'
    const targetTable = source === 'core' ? 'attractions' : 'pois'
    
    // Select columns based on source
    // Core uses 'id', Homolog uses 'uuid_id'
    const selectColumns = source === 'core' 
      ? 'id, name, city, state, country, approved' 
      : 'uuid_id, name, city, state, country, processing_status'

    // Build query
    let query = supabaseService
      .schema(targetSchema)
      .from(targetTable)
      .select(selectColumns)

    // Apply filters
    if (country === '__missing__') {
      query = query.or('country.is.null,country.eq.,state.is.null,state.eq.,city.is.null,city.eq.')
    } else if (country && country !== 'all') {
      query = query.eq('country', country)
    }
    
    if (state && state !== 'all' && country !== '__missing__') {
      query = query.eq('state', state)
    }
    
    if (city && city !== 'all' && country !== '__missing__') {
      query = query.eq('city', city)
    }
    
    // Apply Status Filter
    if (source === 'homolog') {
      if (processingStatus && processingStatus !== 'all') {
        // Explicit filter from user
        query = query.eq('processing_status', processingStatus)
      } else {
        // DEFAULT for parallel processing: only return actionable POIs
        // This ensures Worker B never sees POIs already claimed by Worker A
        // Include null status (POIs imported before the field existed)
        query = query.or('processing_status.in.(pending,failed,new),processing_status.is.null')
      }
    } else if (source === 'core') {
      if (processingStatus === 'pending') {
         query = query.eq('approved', true)
      } else if (processingStatus === 'failed') {
        query = query.eq('approved', false)
      }
    }

    // Limit results
    query = query.limit(limit)

    const { data: pois, error } = await query

    if (error) {
      console.error('Error fetching migration candidates:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: pois?.map((p: any) => ({
        id: p.uuid_id || p.id,
        name: p.name,
        city: p.city,
        state: p.state,
        country: p.country,
        processing_status: p.processing_status || (p.approved ? 'approved' : 'pending')
      })) || []
    })

  } catch (error) {
    console.error('Error in list-candidates:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
