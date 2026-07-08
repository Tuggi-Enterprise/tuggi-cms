/**
 * backfill-buzios-event-descriptions.ts
 *
 * Grava descrições pt-br PESQUISADAS (fatos verificados, com fonte) para os 21 eventos
 * de Armação dos Búzios em core.attraction_descriptions (pt-br) + espelha em
 * attractions.description. Substitui as descrições escritas à mão. Matching por
 * substring normalizado (sem acento/apóstrofo). Idempotente (upsert).
 *
 * Uso:  npx tsx --env-file=.env scripts/backfill-buzios-event-descriptions.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Armação dos Búzios'

const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// { substring normalizado do nome no DB : descrição pt-br pesquisada }
const DESC: { key: string; text: string }[] = [
  { key: 'parada do orgulho', text: 'Edição da Parada do Orgulho LGBT+ de Armação dos Búzios, com concentração na Rua das Pedras. Organizada pelo grupo Cores de Búzios com apoio da Prefeitura, reúne uma pauta de diversidade, direitos humanos e cidadania, integrando a Semana LGBT+ da cidade.' },
  { key: 'corrida das guardas', text: 'Corrida de rua promovida pela Guarda Civil Municipal de Búzios (Associação dos Guardas Civis Municipais com a Secretaria de Lazer e Esportes), com caminhada de 3 km e corridas de 6 e 9 km. De caráter solidário, a segunda edição reuniu mais de 450 participantes e levantou a bandeira do combate à violência contra a mulher, em alusão aos 23 anos da corporação.' },
  { key: 'cafe e chocolate', text: 'Festival gastronômico inédito no calendário de Búzios em 2026, dedicado ao café e ao chocolate. Reúne estandes de cafés especiais e chocolates artesanais, produtores do estado do Rio, oficinas de harmonização e atrações musicais.' },
  { key: 'buzios on', text: 'Festival de música realizado em Armação dos Búzios, com shows de artistas nacionais e atrações de entretenimento ao público.' },
  { key: 'sailing week', text: 'Etapa da classe Optimist da Búzios Sailing Week, a tradicional regata do Iate Clube Armação de Búzios (ICAB). Voltada à formação de jovens velejadores, tem apoio da Prefeitura e da Confederação Brasileira de Vela e integra o calendário náutico da cidade.' },
  { key: 'cantata de natal', text: 'Apresentação natalina do Coral Municipal de Búzios, com regência do maestro Alberto Midon e mais de cem vozes acompanhadas de orquestra ao vivo. Realizada na Rasa (Praça Tia Uia em edições recentes), marca as celebrações de fim de ano da cidade.' },
  { key: 'circuito bike', text: 'Evento de ciclismo do calendário oficial de Armação dos Búzios, realizado em outubro, integrando a agenda esportiva da Região dos Lagos.' },
  { key: 'consciencia negra', text: 'Celebração do Dia da Consciência Negra em Armação dos Búzios, realizada com as comunidades quilombolas da cidade — o Quilombo da Rasa e o Quilombo de Baía Formosa, ambos certificados pela Fundação Palmares. A programação valoriza a história, a luta pelo território e a resistência cultural afro-brasileira, com atividades nas comunidades e no Ginásio Municipal.' },
  { key: 'degusta', text: 'Maior festival gastronômico da Região dos Lagos, o Degusta Búzios reúne mais de 150 bares, restaurantes e cafés da cidade em uma celebração da gastronomia, com pratos autorais e atrações musicais. Realização da Prefeitura de Búzios.' },
  { key: 'dia das criancas', text: 'Festa municipal gratuita de Dia das Crianças em Armação dos Búzios, promovida pela Prefeitura em praças da cidade, com atrações musicais e recreativas para a garotada.' },
  { key: 'carros antigos', text: 'Encontro de veículos antigos e clássicos em Armação dos Búzios. Entre as edições da cidade está o Fest Car Classic Búzios, realizado no Espaço Cultural Zanine pela Prefeitura em parceria com a AVA – Amantes de Veículos Antigos, com entrada solidária mediante doação de alimento.' },
  { key: 'encontro de motos', text: 'O Búzios Biker Fest é o Encontro Internacional de Motociclistas de Armação dos Búzios, realizado pela Prefeitura em parceria com o Búzios Moto Clube no Campo do Azul e Branco. Reúne milhares de motociclistas com shows de wheeling, globo da morte, expositores, praça de alimentação e apresentações musicais.' },
  { key: 'evento pets', text: 'O festival Mais que Petz é o evento de Búzios dedicado ao universo animal, promovido pela Prefeitura por meio da Secretaria da Causa Animal, com entrada gratuita. Inclui feira de adoção, demonstrações de adestramento, workshops de nutrição e saúde, vacinação, microchipagem e terapia assistida por animais.' },
  { key: 'sant', text: 'A mais antiga tradição religiosa de Armação dos Búzios, a Festa de Sant’Anna celebra a padroeira da cidade em torno de 26 de julho (feriado municipal), no Morro da Igreja, entre os Ossos e a Armação. Organizada pelos Festeiros da Padroeira e pela Paróquia de Sant’Anna e Santa Rita de Cássia, tem alvorada, procissão, cerimônia do mastro, missa campal e shows, junto à histórica Igreja de Sant’Anna — construída por volta de 1740, única edificação da era baleeira ainda de pé em Búzios.' },
  { key: 'festa do divino', text: 'Festa do Divino Espírito Santo de Armação dos Búzios, celebrada no Morro da Capela de Sant’Anna, nos Ossos. Tradição retomada em 2023 após anos sem a festa, tem a coroação do menino Imperador, o cortejo da Corte Imperial pelas ruas, o hasteamento do mastro do Divino e a procissão marítima entre os Ossos e o Canto. Organização da Paróquia de Sant’Anna e Santa Rita de Cássia com os festeiros do Divino.' },
  { key: 'literaria', text: 'Festa Literária de Armação dos Búzios, promovida pela Prefeitura por meio da Secretaria de Educação, Ciência e Tecnologia, na Praça Dona Dita, na Ferradura. Reúne tendas temáticas, troca de livros, contação de histórias, exposições e atrações culturais, celebrando a cultura, a natureza e a ancestralidade da cidade.' },
  { key: 'sardinha', text: 'O Festival da Sardinha e Frutos do Mar de Búzios celebra a culinária caiçara nativa, preparada tradicionalmente por mulheres da comunidade. Realizado em setembro no campo da Sociedade Esportiva de Búzios (SEB), reúne dezenas de barracas com pratos à base de sardinha e frutos do mar, além de shows musicais.' },
  { key: 'inverno', text: 'Em Búzios, o Festival de Inverno é o Festival Sesc de Inverno, evento do Sesc RJ que inclui a cidade em sua rota com shows gratuitos, geralmente na Praça Tia Uia, na Rasa, reunindo grandes nomes da música brasileira durante a temporada de inverno.' },
  { key: 'mister buzios', text: 'O Mister Búzios é um campeonato de fisiculturismo (bodybuilding) realizado em Armação dos Búzios, reconhecido pela Brasil Fisiculturismo e Fitness. Reúne atletas de todo o país em categorias como Classic Physique, Wellness, Bikini e Beach Model, avaliados por massa muscular, definição, simetria e presença de palco.' },
  { key: 'natal luz', text: 'Iluminação e decoração natalina de Armação dos Búzios, promovida pela Prefeitura ao longo de dezembro, com pontos iluminados e esculturas temáticas — Papai Noel, trenós com renas, guirlandas, sinos e estrelas — espalhados por várias localidades da cidade.' },
  { key: 'parafina', text: 'O Parafina Festival é um festival de esporte, música e cultura centrado no bodyboard, realizado na Praia de Geribá, em Armação dos Búzios. Já sediou a etapa final do Circuito Brasileiro de Bodyboard Pro, organizado pela Confederação Brasileira de Bodyboarding com a Associação de Surfe de Búzios e a Prefeitura, com competições, oficinas e shows.' },
]

function descFor(name: string): string | null {
  const n = norm(name)
  // Sant'Anna precisa casar com 'sant' + 'anna' (evita colidir com nada mais)
  const hit = DESC.find(d => d.key === 'sant' ? (n.includes('sant') && n.includes('anna')) : n.includes(d.key))
  return hit?.text ?? null
}

async function upsertPtBr(id: string, desc: string): Promise<string> {
  const { data: rows } = await db.from('attraction_descriptions').select('id').eq('attraction_id', id).eq('language', 'pt-br')
  if (rows && rows.length) {
    const { error } = await db.from('attraction_descriptions').update({ description: desc, updated_at: new Date().toISOString() }).eq('attraction_id', id).eq('language', 'pt-br')
    if (error) throw error
    return 'atualizado'
  }
  const { error } = await db.from('attraction_descriptions').insert({ attraction_id: id, language: 'pt-br', description: desc, play_count: 0 })
  if (error) throw error
  return 'inserido'
}

async function main() {
  console.log(`\n=== Descrições pesquisadas — eventos Búzios ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const { data } = await db.from('attractions').select('id, name').eq('city', CITY).eq('entity_kind', 'event').order('name')
  let done = 0, missing = 0
  for (const e of data || []) {
    const desc = descFor(e.name)
    if (!desc) { console.log(`  ⚠ SEM match p/ "${e.name}"`); missing++; continue }
    if (DRY) { console.log(`  · ${e.name.padEnd(40)} → "${desc.slice(0, 55)}..."`); done++; continue }
    try {
      const st = await upsertPtBr(e.id, desc)
      await db.from('attractions').update({ description: desc }).eq('id', e.id)
      console.log(`  ✓ ${e.name.padEnd(40)} ${st}`)
      done++
    } catch (err: any) { console.error(`  ✗ ${e.name}: ${err.message}`) }
  }
  console.log(`\n=== ${DRY ? '[DRY] ' : ''}${done} gravadas | ${missing} sem match ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
