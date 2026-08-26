/**
 * BACKFILL — o local de parceiro que não paga volta a ser só o nome.
 *
 * POR QUE É UM SCRIPT E NÃO A RPC. `core.cms_apply_name_only_description` recusa por desenho
 * quando há descrição de outra origem no caminho (devolve `blocked`), e essa recusa é o 5º caso de
 * borda de BR-B2B-016 em código: *"'Somente o nome' não é degradação do que já existe"*. Ela vale
 * para sempre no caminho do produto. O que este script faz é a DECISÃO NOVA que aquele caso de
 * borda exige — tomada pelo operador em 2026-08-26, olhando a medição — e decisão nova se executa
 * uma vez, com rastro, não afrouxando a guarda que protege o caminho de todo dia. Um parâmetro
 * `force` na RPC seria a guarda com uma porta dos fundos permanente.
 *
 * O QUE ELE MEDE E O QUE ELE NÃO REESCREVE. Quem decide se o parceiro paga é
 * `derivePartnerPlan` + `describeDescriptionPolicy`, importados daqui — os mesmos módulos que a
 * tela e a rota usam. Nenhuma régua é reimplementada em SQL nem neste arquivo: o script levanta os
 * fatos, pergunta, e obedece. Consequência que importa: um parceiro com EXCEÇÃO aberta responde
 * `partner_story` e não é tocado, sem este arquivo precisar saber que exceções existem.
 *
 * REVERSÍVEL, e é isso que o torna seguro de rodar. O texto substituído não é apagado: vai para
 * `generation_meta.replaced_description`, junto com o `kind` de quem o escreveu e a data. Voltar
 * atrás é ler essa chave — ver `docs/dev/backfill-parceiro-somente-nome.md`.
 *
 * O ÁUDIO VAI JUNTO, e é por isso que o script chama a Edge Function em vez de só escrever no
 * banco. Texto novo pareado com áudio velho é o invariante que `generate-description` defende no
 * próprio upsert; se este script só trocasse o texto, os 15 locais que hoje TÊM áudio ficariam
 * mudos até alguém passar de novo — o app tem guarda nativa contra tocar o direcional sozinho.
 *
 *   npx tsx --env-file=.env scripts/backfill-partner-name-only-descriptions.ts            # análise
 *   npx tsx --env-file=.env scripts/backfill-partner-name-only-descriptions.ts --apply    # aplica
 */

import { getSupabaseService } from '../lib/core/supabase-client'
import { derivePartnerPlan, planFactsFromRow } from '../lib/clients/partner-plan'
import { describeDescriptionPolicy } from '../lib/partnerships/place-description-policy'

const APPLY = process.argv.includes('--apply')
/** Só a voz: para os locais que já estão com o nome no texto e sem `audio_url`. */
const VOICE = process.argv.includes('--voice')

/**
 * QUAL CHAVE A EDGE FUNCTION ACEITA, e não é a do CMS.
 *
 * O projeto tem QUATRO chaves secretas — `default`, `cms_secret_key`, `app_secret_key` e
 * `ef_secret_key` — e `_shared/secret-key.ts` faz o bypass interno comparando o bearer com a
 * `ef_secret_key` (ou, na falta dela, com a `SUPABASE_SERVICE_ROLE_KEY` legada). O
 * `SUPABASE_SECRET_KEY` do `.env` do CMS é outra das quatro: chega na função como token
 * desconhecido, `getUser()` o rejeita, e a resposta é `401 Invalid or expired token`.
 *
 * Medido em 2026-08-26, e é por isso que este script pede a chave por fora em vez de usar
 * `db.functions.invoke`: a separação das quatro é deliberada e não se contorna reusando a errada.
 */
const EF_KEY = process.env.EF_SECRET_KEY ?? ''

/**
 * O idioma em que a voz é pedida quando este script pede voz. NÃO é "a linha que o ajuste toca":
 * o ajuste toca TODAS as linhas do local, e a distinção custou caro.
 *
 * MEDIDO EM 2026-08-26. A primeira versão cravou `pt-br/male` como "a linha base" e deixou as
 * outras em paz. Três locais tinham também uma linha `en-us` com a narração antiga, e dez minutos
 * depois do backfill o `Brigaderia da Vovó` estava de volta com 183 caracteres: o app pediu a
 * descrição, `generate-description` não achou áudio, caiu no passo de TRADUÇÃO, achou o inglês
 * intacto e traduziu o texto velho de volta para português — com voz.
 *
 * A régua não fala de idioma. BR-B2B-016, item 1, diz o que o Tuggi DIZ sobre o local, e ele diz
 * em todos. Uma linha esquecida em qualquer idioma é a semente de que o resto rebrota.
 */
const VOICE_LANGUAGE = 'pt-br'
const VOICE_GENDER = 'male'

interface Row {
  id: string
  name: string
  city: string | null
  /** `core.attractions.description` — a terceira fonte, e a que o app mostra na TELA. */
  description: string | null
  partner_client_id: string | null
  partner_description_exception_at: string | null
  partner_description_exception_by: string | null
  partner_description_exception_reason: string | null
}

async function main() {
  const db = getSupabaseService()

  // 1 · Os locais de parceiro. `entity_kind` NÃO filtra: um POI que o `PlaceLinkPanel` vinculou é
  //     local de parceiro do mesmo jeito, e a régua não conhece a diferença.
  const { data: places, error: placesError } = await db
    .schema('core')
    .from('attractions')
    .select(
      'id, name, city, description, partner_client_id, partner_description_exception_at, ' +
        'partner_description_exception_by, partner_description_exception_reason'
    )
    .not('partner_client_id', 'is', null)
  if (placesError) throw new Error(`attractions: ${placesError.message}`)

  const rows = (places ?? []) as Row[]
  const clientIds = Array.from(new Set(rows.map((r) => r.partner_client_id).filter(Boolean))) as string[]

  // 2 · Os fatos de dinheiro, por cliente. Três leituras, não uma por local.
  const [clients, contracts, choices] = await Promise.all([
    db.schema('partner').from('clients').select('id, monthly_fee_cents, is_courtesy, courtesy_reason').in('id', clientIds),
    db.schema('partner').from('partner_contracts').select('client_id, tier, created_at').in('client_id', clientIds).is('superseded_by', null).order('created_at', { ascending: false }),
    db.schema('partner').from('partner_form_submissions').select('promoted_client_id, answers, promoted_at').in('promoted_client_id', clientIds).eq('status', 'promoted').order('promoted_at', { ascending: false }),
  ])
  if (clients.error) throw new Error(`clients: ${clients.error.message}`)
  if (contracts.error) throw new Error(`contracts: ${contracts.error.message}`)
  if (choices.error) throw new Error(`submissions: ${choices.error.message}`)

  const clientById = new Map((clients.data ?? []).map((c: any) => [c.id, c]))
  const tierById = new Map<string, string | null>()
  for (const c of (contracts.data ?? []) as any[]) if (!tierById.has(c.client_id)) tierById.set(c.client_id, c.tier ?? null)
  const choiceById = new Map<string, string | null>()
  for (const s of (choices.data ?? []) as any[]) {
    if (!choiceById.has(s.promoted_client_id)) choiceById.set(s.promoted_client_id, s.answers?.plan_choice ?? null)
  }

  // 3 · A descrição-base de cada um.
  const { data: descs, error: descError } = await db
    .schema('core')
    .from('attraction_descriptions')
    .select('attraction_id, language, gender, description, audio_url, generation_meta')
    .in('attraction_id', rows.map((r) => r.id))
  if (descError) throw new Error(`descriptions: ${descError.message}`)

  // TODAS as linhas de cada local, agrupadas. Uma esquecida rebrota — ver `VOICE_LANGUAGE`.
  const descsById = new Map<string, any[]>()
  for (const d of (descs ?? []) as any[]) {
    const list = descsById.get(d.attraction_id) ?? []
    list.push(d)
    descsById.set(d.attraction_id, list)
  }

  // 4 · A decisão, pela régua do repo. Nada é decidido neste arquivo.
  const targets: { row: Row; desc: any }[] = []
  /** Locais cujo `core.attractions.description` ainda carrega texto. */
  const sourceTargets: Row[] = []
  const skipped: { name: string; why: string }[] = []

  for (const row of rows) {
    const client = clientById.get(row.partner_client_id as string)
    const decision = describeDescriptionPolicy({
      partnerClientId: row.partner_client_id,
      plan: client
        ? derivePartnerPlan(
            planFactsFromRow({
              partner_client_id: row.partner_client_id,
              monthly_fee_cents: client.monthly_fee_cents,
              is_courtesy: client.is_courtesy,
              courtesy_reason: client.courtesy_reason,
              plan_choice: choiceById.get(row.partner_client_id as string) ?? null,
              contract_tier: tierById.get(row.partner_client_id as string) ?? null,
            })
          )
        : null,
      exception: row.partner_description_exception_at
        ? {
            at: row.partner_description_exception_at,
            by: row.partner_description_exception_by,
            reason: row.partner_description_exception_reason ?? '',
          }
        : null,
    })

    if (decision.policy !== 'name_only') {
      skipped.push({ name: row.name, why: decision.reason })
      continue
    }

    // Toda linha cujo texto não é o nome, em QUALQUER idioma e gênero.
    const existing = descsById.get(row.id) ?? []
    const stale = existing.filter((d: any) => {
      const text = (d.description ?? '').trim()
      return text && text !== '[PROCESSING]' && text !== row.name.trim()
    })

    /**
     * SEM LINHA NENHUMA NÃO É "JÁ ESTÁ CERTO" — é o local mudo, e ele precisa do nome.
     *
     * Custou uma volta em 2026-08-26: `Sabor e Arte Restaurante` apareceu como `já é só o nome`
     * porque não tinha linha alguma para comparar, e a tela do operador mostrava vazio. A linha
     * tinha sido APAGADA pela própria Edge Function — o lock sobrescreve com `[PROCESSING]` e o
     * `catch` apaga —, e é por isso que o conserto do `catch` anda junto com este.
     *
     * `null` em `desc` é o sinal de INSERT para o passo de escrita.
     */
    const missingBase = !existing.some(
      (d: any) => d.language === VOICE_LANGUAGE && d.gender === VOICE_GENDER
    )
    if (missingBase) targets.push({ row, desc: null })
    for (const desc of stale) targets.push({ row, desc })

    // A FONTE, e ela é uma terceira. `core.attractions.description` guarda outro texto ainda —
    // medido em 2026-08-26: 23 locais de faixa gratuita com promoção de festival ali. O app a lê
    // pelo read model (`core.app_poi_read.description` sai de `a.description` em
    // `app_poi_read_build`), então o turista LIA a promoção mesmo com o áudio dizendo só o nome.
    //
    // ANTES do `continue` de propósito: um local pode estar com a narração já certa e ainda ter a
    // promoção na fonte. Ficou depois na primeira versão e só 2 dos 23 foram vistos.
    if ((row.description ?? '').trim()) sourceTargets.push(row)

    if (!missingBase && stale.length === 0) {
      skipped.push({ name: row.name, why: 'a narração já é só o nome em todos os idiomas' })
      continue
    }
  }

  console.log(`\n${rows.length} locais de parceiro. ${targets.length} a ajustar, ${skipped.length} fora.\n`)
  for (const { row, desc } of targets) {
    if (!desc) {
      console.log(`  · ${row.name}  [SEM LINHA — o local está mudo, ganha o nome]`)
      continue
    }
    const audio = desc.audio_url ? 'com áudio' : 'sem áudio'
    console.log(`  · ${row.name}  [${desc.language}/${desc.gender}, ${desc.generation_meta?.kind ?? 'sem trilha'}, ${audio}]`)
    console.log(`      → "${String(desc.description).slice(0, 90)}…"`)
  }
  if (sourceTargets.length) {
    console.log(`\n  ${sourceTargets.length} com texto em core.attractions.description (o que o app MOSTRA):`)
    for (const row of sourceTargets) console.log(`   · ${row.name} — "${String(row.description).slice(0, 70)}…"`)
  }
  const byReason = new Map<string, number>()
  for (const s of skipped) byReason.set(s.why, (byReason.get(s.why) ?? 0) + 1)
  if (byReason.size) {
    console.log('\n  Fora do ajuste:')
    for (const [why, n] of byReason) console.log(`   · ${n} — ${why}`)
  }

  /**
   * MODO VOZ — os que já estão com o nome no texto e continuam sem `audio_url`.
   *
   * Existe porque texto e voz podem se separar: o `--apply` de 2026-08-26 ajustou 19 textos e não
   * gerou áudio nenhum (a EF recusou por chave). Sem este modo o conserto seria reverter tudo e
   * refazer — e reverter põe de volta no ar exatamente o conteúdo que o operador mandou tirar.
   */
  if (VOICE) {
    const mute = rows.filter((row) => {
      const desc = (descsById.get(row.id) ?? []).find(
        (d: any) => d.language === VOICE_LANGUAGE && d.gender === VOICE_GENDER
      )
      const text = (desc?.description ?? '').trim()
      return text && text === row.name.trim() && !desc?.audio_url
    })
    console.log(`\n${mute.length} locais com o nome no texto e sem voz.\n`)
    if (!APPLY) {
      for (const row of mute) console.log(`  · ${row.name}`)
      console.log('\nANÁLISE. Rode com --voice --apply para gerar.\n')
      return
    }
    let ok = 0
    for (const row of mute) if (await speak(row.id, row.name)) ok++
    console.log(`\n${ok} de ${mute.length} com voz.\n`)
    return
  }

  if (!APPLY) {
    console.log('\nANÁLISE. Nada foi escrito. Rode com --apply para ajustar.\n')
    return
  }

  // 5 · O ajuste. Texto primeiro, áudio em seguida, um local por vez: são 26 no total e uma falha
  //     no meio precisa deixar claro ONDE parou.
  console.log('\nAplicando…\n')
  let written = 0
  let voiced = 0
  for (const { row, desc } of targets) {
    const name = row.name.trim()
    if (!desc) {
      // Não havia linha: o local está mudo e ganha o nome. Sem `replaced_*` — não houve o que
      // substituir, e uma chave de recuperação vazia mentiria sobre existir algo a recuperar.
      const { error: insertError } = await db.schema('core').from('attraction_descriptions').insert({
        attraction_id: row.id,
        language: VOICE_LANGUAGE,
        gender: VOICE_GENDER,
        description: name,
        facts_pack_json: [],
        audio_url: null,
        updated_at: new Date().toISOString(),
        verification_status: 'approved',
        generation_meta: { kind: 'partner_name_only', created_by: 'backfill-partner-name-only-descriptions' },
      })
      if (insertError) {
        console.error(`  ✗ ${row.name}: insert falhou — ${insertError.message}`)
        continue
      }
      written++
      console.log(`  ✓ ${row.name} → "${name}" (linha criada)`)
      continue
    }
    const { data: written_rows, error: writeError } = await db
      .schema('core')
      .from('attraction_descriptions')
      .update({
        description: name,
        facts_pack_json: [],
        audio_url: null,
        updated_at: new Date().toISOString(),
        verification_status: 'approved',
        generation_meta: {
          kind: 'partner_name_only',
          // A volta atrás mora aqui. Sem isto o ajuste seria irreversível, e uma decisão nova
          // sobre conteúdo publicado não deveria ser.
          replaced_description: desc.description,
          replaced_kind: desc.generation_meta?.kind ?? null,
          replaced_at: new Date().toISOString(),
          replaced_by: 'backfill-partner-name-only-descriptions',
        },
      })
      .eq('attraction_id', row.id)
      .eq('language', desc.language)
      .eq('gender', desc.gender)
      // `.select()` NÃO é enfeite: sem ele o PostgREST devolve sucesso para um UPDATE que casou
      // ZERO linhas, e foi assim que três locais entraram na contagem de "ajustados" em
      // 2026-08-26 sem nunca terem sido escritos. Agora o script conta o que voltou.
      .select('attraction_id')

    if (writeError) {
      console.error(`  ✗ ${row.name}: ${writeError.message}`)
      continue
    }
    if (!written_rows || (written_rows as any[]).length === 0) {
      console.error(`  ✗ ${row.name} [${desc.language}/${desc.gender}]: nenhuma linha casou — nada escrito`)
      continue
    }
    written++

    if (desc.language === VOICE_LANGUAGE && desc.gender === VOICE_GENDER) {
      if (await speak(row.id, row.name)) voiced++
    }
  }

  // A TERCEIRA FONTE. Limpar `attractions.description` e MANDAR RECONSTRUIR o read model — nunca
  // escrever em `core.app_poi_read` direto: ele é derivado, e escrever no derivado é a segunda
  // casa do mesmo fato.
  let sourcesCleared = 0
  for (const row of sourceTargets) {
    const { error } = await db
      .schema('core')
      .from('attractions')
      .update({ description: null })
      .eq('id', row.id)
      .select('id')
    if (error) {
      console.error(`  ✗ ${row.name}: core.attractions.description — ${error.message}`)
      continue
    }
    sourcesCleared++
  }
  if (sourcesCleared) {
    const { error: buildError } = await db
      .schema('core')
      .rpc('app_poi_read_build', { p_ids: sourceTargets.map((r) => r.id) })
    console.log(
      buildError
        ? `\n  ⚠ ${sourcesCleared} fontes limpas, mas o read model não reconstruiu: ${buildError.message}`
        : `\n  ${sourcesCleared} fontes limpas e read model reconstruído.`
    )
  }

  console.log(`\n${written} textos ajustados, ${voiced} com áudio novo.\n`)
  if (voiced < written) {
    console.log('Rode com --voice depois de resolver a chave para completar o áudio que faltou.\n')
  }
}

/**
 * A voz de um local. `force: false` cai no caminho `tts_only` — texto gravado, sem chamada de LLM.
 * Devolve `false` e imprime o motivo; nunca derruba o laço, porque um local que falhou não é razão
 * para os outros 18 ficarem sem.
 */
async function speak(attractionId: string, name: string): Promise<boolean> {
  if (!EF_KEY) {
    console.error(`  ⚠ ${name}: texto pronto, áudio NÃO gerado — falta EF_SECRET_KEY no ambiente.`)
    return false
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-description`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EF_KEY}` },
      body: JSON.stringify({
        poi_id: attractionId,
        language: VOICE_LANGUAGE,
        gender: VOICE_GENDER,
        generate_audio: true,
        force: false,
      }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !(body as any)?.success) {
      console.error(`  ⚠ ${name}: áudio falhou — HTTP ${res.status} ${(body as any)?.error ?? (body as any)?.detail ?? ''}`)
      return false
    }
    console.log(`  ✓ ${name} → "${name}" (com voz)`)
    return true
  } catch (e) {
    console.error(`  ⚠ ${name}: áudio falhou — ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
