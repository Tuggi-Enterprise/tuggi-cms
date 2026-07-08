/**
 * backfill-buzios-descriptions.ts
 *
 * Adiciona descrições pt-br aos EVENTOS e LOCAIS de Armação dos Búzios, gravando em
 * core.attraction_descriptions (language='pt-br') — o SSOT que a aba Descrição do CMS
 * lê e que serve de base para áudio/tradução — e espelhando em core.attractions.description
 * quando vazio. Comércios que já têm attractions.description reusam esse texto.
 * Idempotente (só grava onde falta). Trigger Points / áudio à parte.
 *
 * Uso:  npx tsx --env-file=.env scripts/backfill-buzios-descriptions.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Armação dos Búzios'

// Descrições pt-br por nome. Comércios que já têm attractions.description NÃO precisam
// entrar aqui (o fallback reusa o texto existente).
const DESC: Record<string, string> = {
  // ---- Eventos ----
  '11ª Parada do Orgulho LGBT+ de Búzios': 'Edição anual da Parada do Orgulho LGBT+ de Armação dos Búzios, com trio elétrico e festa ao longo da Rua das Pedras, celebrando a diversidade num dos destinos mais acolhedores do litoral fluminense.',
  '2ª Corrida das Guardas de Búzios': 'Corrida de rua promovida pelas Guardas de Búzios, com percurso pelo centro partindo da Praça Escola Darcy Ribeiro, reunindo atletas e a comunidade local.',
  'Búzios Café e Chocolate': 'Feira gastronômica dedicada ao café e ao chocolate em Armação dos Búzios, com produtores, cafeterias e chocolatiers, degustações, oficinas e atrações para toda a família.',
  'Búzios ON': 'Evento de música e entretenimento em Armação dos Búzios, com programação de shows e atrações que animam a temporada na cidade.',
  'Búzios Sailing Week Optimist': 'Semana de regatas da classe Optimist em Armação dos Búzios, sediada na marina da cidade, reunindo jovens velejadores em uma das etapas tradicionais da vela brasileira.',
  'Cantata de Natal': 'Apresentação natalina com corais e música em Armação dos Búzios, marcando as celebrações de fim de ano com espírito festivo à beira-mar.',
  'Circuito Bike Lagos': 'Etapa do circuito de ciclismo da Região dos Lagos em Armação dos Búzios, com pedal e provas que percorrem as paisagens litorâneas da península.',
  'Consciência Negra': 'Celebração do Dia da Consciência Negra em Armação dos Búzios, no dia 20 de novembro, com programação cultural que valoriza a história e a herança afro-brasileira, incluindo a comunidade quilombola local.',
  'Degusta Búzios': 'Festival gastronômico de Armação dos Búzios que reúne os melhores restaurantes e chefs da cidade, com pratos autorais e experiências para os amantes da boa mesa ao longo do verão.',
  'Dia das Crianças': 'Programação especial de Dia das Crianças em Armação dos Búzios, com atrações, brincadeiras e atividades recreativas para a garotada.',
  'Encontro de Carros Antigos': 'Encontro de veículos antigos e clássicos em Armação dos Búzios, reunindo colecionadores e admiradores em uma exposição a céu aberto pela cidade.',
  'Encontro de Motos': 'Encontro de motociclistas em Armação dos Búzios, com concentração de motos, passeios e programação que movimenta a cidade e o comércio local.',
  'Evento Pets': 'Evento voltado aos animais de estimação em Armação dos Búzios, com atividades, feira e ações de adoção responsável para tutores e seus bichos.',
  "Festa de Sant'Anna": 'Festa da padroeira de Armação dos Búzios, celebrada tradicionalmente no bairro dos Ossos em torno de 26 de julho, com missas, procissão e manifestações religiosas e populares junto à histórica Igreja de Sant’Anna.',
  'Festa do Divino': 'Tradicional Festa do Divino Espírito Santo em Armação dos Búzios, com novenas, procissões e festejos religiosos na Capela de Sant’Anna — uma das manifestações mais antigas da cultura buziana.',
  'Festa Literária de Búzios': 'Festival literário de Armação dos Búzios, com encontros de autores, mesas de debate, lançamentos e atividades que celebram a literatura à beira-mar.',
  'Festival da Sardinha': 'Festival tradicional que celebra a sardinha, peixe símbolo da cultura pesqueira de Armação dos Búzios, com pratos típicos, música e homenagem às raízes caiçaras da cidade.',
  'Festival de Inverno de Búzios': 'Festival de Inverno de Armação dos Búzios, com shows e programação musical que aquecem a temporada de baixa estação na cidade.',
  'Mister Búzios': 'Concurso de beleza masculina realizado em Armação dos Búzios, com desfile e premiação que integram a agenda de eventos da cidade.',
  'Natal Luz': 'Programação natalina de Armação dos Búzios ao longo de dezembro, com iluminação especial, decoração e atrações que transformam a Orla Bardot e o centro em cenário de fim de ano.',
  'Parafina': 'Evento ligado ao surfe e à cultura do mar em Armação dos Búzios, reunindo a comunidade surfista nas praias da cidade.',

  // ---- Hotéis / pousadas (locais) ----
  'Apuã Concept Hotel & Spa': 'Hotel-conceito com spa em Manguinhos, Armação dos Búzios, com hospedagem sofisticada perto das águas calmas ideais para esportes náuticos.',
  'Azeda Boutique Hotel': 'Hotel boutique em Armação dos Búzios, próximo à paradisíaca Praia Azeda, com proposta intimista e acolhedora.',
  'Buzios Beach Resort': 'Resort à beira-mar em Armação dos Búzios, com estrutura completa de lazer, piscinas e acesso à praia para hóspedes em família.',
  'Búzios Espiritualidade Resort Caravelas': 'Resort no bairro Caravelas, Armação dos Búzios, voltado ao descanso e bem-estar, cercado pela natureza da porção sul da península.',
  'Colonna Park': 'Hotel no bairro João Fernandes, Armação dos Búzios, próximo às praias de águas cristalinas mais badaladas da cidade.',
  'El Parador Pousada': 'Pousada no centro de Armação dos Búzios, a poucos passos da Rua das Pedras e da Orla Bardot, com localização privilegiada para explorar a cidade.',
  'Hotel Aretê': 'Hotel na região da Marina, Armação dos Búzios, com fácil acesso ao centro e aos passeios náuticos da cidade.',
  'Hotel Ilha Branca Inn': 'Hotel no bairro João Fernandes, Armação dos Búzios, próximo às praias tranquilas do lado norte da península.',
  'Hotel Latitud': 'Hotel em Armação dos Búzios, com hospedagem confortável e fácil acesso às praias e ao centro da cidade.',
  'Le Relais La Borie': 'Hotel à beira-mar em Armação dos Búzios, conhecido pela hospitalidade e pela localização junto a uma das praias da cidade.',
  'Local Friend': 'Hostel descontraído em Armação dos Búzios, opção acessível e sociável para viajantes que querem aproveitar a cidade.',
  'Numa Boa': 'Hostel em Armação dos Búzios com clima jovem e informal, ideal para quem busca hospedagem econômica perto das praias.',
  'Pousada Amancay': 'Pousada aconchegante em Armação dos Búzios, com atendimento familiar e ambiente tranquilo para o descanso.',
  'Pousada Bucaneiro': 'Pousada em Armação dos Búzios, próxima ao centro, com proposta simples e acolhedora para explorar a cidade.',
  'Pousada do Namorado': 'Pousada charmosa em Armação dos Búzios, ideal para casais em busca de um refúgio romântico à beira-mar.',
  'Pousada dos Guardiões': 'Pousada em Armação dos Búzios, com ambiente tranquilo e boa localização para aproveitar as praias e o centro.',
  'Pousada dos Tangarás': 'Pousada no bairro de Geribá, Armação dos Búzios, próxima a uma das praias mais famosas da cidade, point de surfe e pôr do sol.',
  'Pousada Marbella': 'Pousada em Armação dos Búzios, com hospedagem confortável e fácil acesso às atrações da cidade.',
  'Pousada Pelicano': 'Pousada em Armação dos Búzios, com ambiente acolhedor e localização conveniente para explorar as praias e o centro histórico.',
}

async function upsertPtBr(id: string, desc: string) {
  const { data: existing } = await db.from('attraction_descriptions')
    .select('id, description').eq('attraction_id', id).eq('language', 'pt-br').maybeSingle()
  if (existing) {
    if ((existing.description || '').trim()) return 'já tinha pt-br'
    const { error } = await db.from('attraction_descriptions')
      .update({ description: desc, updated_at: new Date().toISOString() }).eq('id', existing.id)
    if (error) throw error
    return 'atualizado (pt-br vazio)'
  }
  const { error } = await db.from('attraction_descriptions')
    .insert({ attraction_id: id, language: 'pt-br', description: desc, play_count: 0 })
  if (error) throw error
  return 'inserido pt-br'
}

async function main() {
  console.log(`\n=== Descrições pt-br Búzios (events+places) ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  let done = 0, skipped = 0, missing = 0
  for (const kind of ['event', 'place'] as const) {
    const { data } = await db.from('attractions')
      .select('id, name, description').eq('city', CITY).eq('entity_kind', kind).order('name')
    console.log(`\n— ${kind.toUpperCase()} (${data?.length}) —`)
    for (const r of data || []) {
      const desc = DESC[r.name] || (r.description || '').trim() || null
      if (!desc) { console.log(`  ⚠ SEM texto p/ "${r.name}" — pulado`); missing++; continue }
      if (DRY) { console.log(`  · ${r.name} → "${desc.slice(0, 60)}..."`); done++; continue }
      try {
        const st = await upsertPtBr(r.id, desc)
        // espelha no canônico attractions.description se estiver vazio
        if (!(r.description || '').trim()) {
          await db.from('attractions').update({ description: desc }).eq('id', r.id)
        }
        console.log(`  ✓ ${r.name.padEnd(40)} ${st}`)
        if (st.startsWith('já')) skipped++; else done++
      } catch (e: any) { console.error(`  ✗ ${r.name}: ${e.message}`) }
    }
  }
  console.log(`\n=== ${DRY ? '[DRY] ' : ''}gravados ${done} | já tinham ${skipped} | sem texto ${missing} ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
