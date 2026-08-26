'use client'

/**
 * WHAT THIS PLACE MAY HAVE IN THE DESCRIPTION'S PLACE — the band at the top of the description tab.
 *
 * IT IS HERE AND NOT ON THE PARTNER FORM, and that was the operator's call on 2026-08-26: *"o
 * melhor local para essas regras ficarem é no modal de edição de places e nao no form de
 * partners"*. The reasoning holds on its own — the form is the establishment's channel and it is
 * answered before anybody decided anything, while the description is a curation act on a catalogue
 * record. Putting the lock where the text is written is DS-LAYOUT-006, point 1: the tool opens on
 * the object, and on the part of it that is owed.
 *
 * ONE COMPONENT FOR BOTH EDITORS. A partner's place is a `place` when the approval provisioned it
 * and a `poi` when `PlaceLinkPanel` linked one the catalogue already carried — two editors,
 * `lib/partnerships/place-tool.ts`, same rule. It renders `null` for every curated POI, which is
 * every row but a handful, and is what keeps this out of the way of the catalogue.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Lock, Sparkles, Loader2, ShieldAlert, Undo2, AlertTriangle, PlugZap } from 'lucide-react'
import { useAuthenticatedFunctionCall } from '@/lib/hooks/useAuthenticatedFunctionCall'
import { paymentStance } from '@/lib/clients/partner-plan'
import { PaymentStanceBadge } from '@/components/admin/clients/shared/PaymentStanceBadge'
import { useDescriptionException, useDescriptionPolicy } from '@/lib/hooks/use-description-policy'
import { PARTNER_AUDIO_SECONDS } from '@/lib/partnerships/place-description-policy'

interface Props {
  attractionId: string
  /** The language tab the studio is on. The partner narration is generated in it. */
  language: string
  canEdit: boolean
  /** Where the generated text lands — the studio's editor, unsaved, for the operator to read. */
  onGenerated: (description: string) => void
  onFeedback?: (message: string, type: 'success' | 'error') => void
}

const CARD = 'rounded-3xl border shadow-sm p-6'
const REASON_MIN = 10

export function PartnerDescriptionGate({
  attractionId,
  language,
  canEdit,
  onGenerated,
  onFeedback,
}: Props) {
  const t = useTranslations('Modals.PartnerDescription')
  const { callFunction } = useAuthenticatedFunctionCall()
  const { data: view, isLoading, error } = useDescriptionPolicy(attractionId)
  const { open, close } = useDescriptionException(attractionId)

  const [reason, setReason] = useState('')
  const [askingException, setAskingException] = useState(false)
  const [withOffer, setWithOffer] = useState(true)
  const [generating, setGenerating] = useState(false)

  /**
   * A FALHA APARECE. Ela some para POI de curadoria — e só para ele.
   *
   * Até 2026-08-26 qualquer erro de leitura devolvia `null`, que na tela é idêntico a "este local
   * não tem parceiro". O operador abriu a aba, viu o estúdio de sempre e não tinha o que reportar;
   * a causa estava a um `console` de distância e ninguém sabia disso. Uma faixa que se apaga
   * sozinha quando quebra é pior que faixa nenhuma: ela ensina que está tudo certo.
   */
  if (error) {
    return (
      <section className={`${CARD} bg-red-50/60 dark:bg-red-900/10 border-red-200 dark:border-red-800/50`}>
        <div className="flex items-start gap-3">
          <PlugZap className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
          <div className="min-w-0">
            <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
              {t('unavailable.heading')}
            </h4>
            <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{t('unavailable.body')}</p>
            <p className="mt-2 font-mono text-xs text-red-700 dark:text-red-400 break-words">
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        </div>
      </section>
    )
  }

  // Nothing to say about a curated POI, and saying nothing is the point: this band must not become
  // one more thing to read on the 2.2 million records the rule does not reach.
  if (isLoading || !view || view.decision.policy === 'curation') return null

  const { decision, story, plan } = view
  const handle = story?.socialHandle ?? null

  /**
   * PAGA OU NÃO PAGA, aqui também — pedido do operador em 2026-08-26: *"leva essa info para a aba
   * de descriçoes tmb, para sabermos"*.
   *
   * MESMO SELO E MESMA RÉGUA do card de Locais: `derivePartnerPlan` já rodou no servidor, sobre as
   * mesmas cinco colunas, e `paymentStance` é o único lugar que colapsa isso no binário. Duas
   * telas não podem discordar sobre o mesmo parceiro.
   *
   * A FONTE VAI JUNTO, e não é enfeite: o selo diz que ninguém está cobrando, e a fonte diz de
   * quem é essa resposta. `cadastro` sobre um parceiro sem contrato é outra conversa que
   * `contrato` — a primeira é trabalho pendente de alguém, a segunda é o que ele assinou.
   */
  const stance = plan ? paymentStance(plan.kind) : null
  const planLine = plan ? (
    <div className="flex items-center gap-2 shrink-0">
      {stance && <PaymentStanceBadge stance={stance} />}
      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
        {t(`plan_source.${plan.source}`)}
      </span>
    </div>
  ) : null

  const generate = async () => {
    if (!story) return
    setGenerating(true)
    try {
      const { data, error } = await callFunction('generate-description', {
        poi_id: attractionId,
        language,
        generate_audio: false,
        // The 10–15s band of the paid tier. It is sent and not defaulted in the Edge Function
        // because this is where the number lives (`PARTNER_AUDIO_SECONDS`).
        audio_duration: PARTNER_AUDIO_SECONDS.target,
        // Fresh every time: the partner input is what changed, and translating an older narration
        // would keep narrating whatever the place used to say.
        force: true,
        partner_input: {
          name: view.name,
          city: view.city ?? '',
          blocks: story.blocks,
          socialHandle: handle,
          withOffer: withOffer && !!handle,
        },
      })

      if (error) throw new Error(error.message)
      const text = (data as { data?: { description?: string } })?.data?.description
      if (!text) throw new Error(t('generate_empty'))

      onGenerated(text)
      onFeedback?.(t('generate_done'), 'success')
    } catch (e: any) {
      onFeedback?.(e?.message || t('generate_failed'), 'error')
    } finally {
      setGenerating(false)
    }
  }

  // ── The free tier: the name, and nothing beyond it ────────────────────────────────────────────
  if (decision.policy === 'name_only') {
    return (
      <section
        className={`${CARD} bg-amber-50/60 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50`}
      >
        <header className="flex items-start gap-3">
          <Lock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                {t('free.heading')}
              </h4>
              {planLine}
            </div>
            <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{t('free.body')}</p>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {view.baseDescription
                ? t('free.on_air', { text: view.baseDescription.text })
                : t('free.not_yet')}
            </p>
          </div>
        </header>

        {canEdit && decision.mayException && (
          <div className="mt-5 pl-8">
            {!askingException ? (
              <button
                onClick={() => setAskingException(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 transition-all"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {t('free.open_exception')}
              </button>
            ) : (
              <div className="space-y-3">
                {/* The reason is not a formality: it is the half of the decision that outlives
                    today, and the CHECK behind the columns refuses the record without it. */}
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter">
                  {t('free.reason_label')}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={t('free.reason_placeholder')}
                  className="w-full px-4 py-3 bg-white dark:bg-gray-900/60 border border-amber-200 dark:border-amber-800 rounded-xl text-sm dark:text-white outline-none focus:ring-2 focus:ring-amber-400"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => open.mutate(reason.trim())}
                    disabled={reason.trim().length < REASON_MIN || open.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700 transition-all"
                  >
                    {open.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    {t('free.confirm_exception')}
                  </button>
                  <button
                    onClick={() => { setAskingException(false); setReason('') }}
                    className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-gray-500 hover:text-gray-700"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    )
  }

  // ── The paid tier, or a free one under an exception ───────────────────────────────────────────
  return (
    <section className={`${CARD} bg-white dark:bg-gray-800/40 border-gray-100 dark:border-gray-700/50`}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Sparkles className="h-5 w-5 shrink-0 text-tuggi-blue mt-0.5" />
          <div className="min-w-0">
            <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
              {t('paid.heading')}
            </h4>
            <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">
              {decision.reason === 'operator_exception' ? t('paid.body_exception') : t('paid.body')}
            </p>
          </div>
        </div>
        {planLine}
      </header>

      {/* The exception, in full, wherever it is what explains the screen. Who, when and why —
          without the three it is state nobody can review. */}
      {decision.exception && (
        <div className="mt-4 ml-8 rounded-2xl bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 p-4">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-400 uppercase tracking-widest">
            {t('exception.heading')}
          </p>
          <p className="mt-1.5 text-sm text-gray-800 dark:text-gray-200">{decision.exception.reason}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t('exception.trail', {
              by: decision.exception.by ?? t('exception.unknown_operator'),
              at: new Date(decision.exception.at).toLocaleDateString('pt-BR'),
            })}
          </p>
          {canEdit && (
            <button
              onClick={() => close.mutate()}
              disabled={close.isPending}
              className="mt-3 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-40"
            >
              {close.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              {t('exception.undo')}
            </button>
          )}
        </div>
      )}

      {/* Gate 2 of BR-B2B-011 is a person's, so this says what is missing and stops — it never
          refuses on its own, and it never invents input the establishment did not send. */}
      {!story ? (
        <div className="mt-4 ml-8 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <span>{t('paid.no_input')}</span>
        </div>
      ) : (
        <div className="mt-5 ml-8 space-y-4">
          <div className="space-y-3">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              {t('paid.input_heading')}
            </p>
            {story.blocks.map((block) => (
              <div key={block.id} className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-4">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  {t(`questions.${block.id}`)}
                </p>
                <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{block.answer}</p>
              </div>
            ))}
          </div>

          {/* BR-B2B-016, item 8: the offer may go in, identified. The operator decided on
              2026-08-26 that the identification is the LAST beat, together with the invitation. */}
          {handle ? (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={withOffer}
                onChange={(e) => setWithOffer(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded accent-tuggi-blue"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('paid.with_offer', { handle })}
              </span>
            </label>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('paid.no_handle')}</p>
          )}

          {canEdit && (
            <button
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-tuggi-blue text-white hover:bg-tuggi-blue/90 disabled:opacity-40 transition-all"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t('paid.generate', { seconds: PARTNER_AUDIO_SECONDS.target })}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
