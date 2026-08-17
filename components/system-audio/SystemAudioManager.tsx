'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Languages, Loader2, Play, RefreshCw, Trash2, Volume2, Wand2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  deleteSystemAudio,
  fetchInventory,
  fileKey,
  formatBytes,
  generateSystemAudio,
  localeDisplay,
  planBatch,
  previewSystemAudioText,
  type GenerateRequest,
  type GenerateResult,
  type SystemAudioFile,
  type SystemAudioInventory,
  type SystemAudioScript,
  type VoiceGender,
  type VoiceTier,
} from '@/lib/audio/system-audio-client'

/**
 * Áudios de sistema — os clipes que não pertencem a nenhum POI.
 *
 * Modelo editorial: **um texto, escrito em pt-BR**, e onze traduções dele. O operador
 * escreve e aprova a linha uma vez, escolhe os idiomas e manda gerar; a tradução é da
 * Edge Function. Não existe "texto por idioma" para escrever à mão — existe conserto
 * pontual de tradução ruim, que é outra coisa.
 *
 * Convenção de nome: `{pasta}/{chave}_{locale}_{genero}.mp3`. O app monta essa URL à
 * mão em três serviços, então o nome é contrato — a tela nunca inventa um, pede o
 * caminho à Edge Function e mostra o que existe.
 */
export function SystemAudioManager() {
  const [inventory, setInventory] = useState<SystemAudioInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Voz e masterização
  const [tier, setTier] = useState<VoiceTier>('hd')
  // Vazio = automática: a EF usa a voz recomendada DO IDIOMA de cada arquivo. Fixar
  // uma voz aqui vale para o lote inteiro e apaga o mapa por idioma.
  const [maleVoice, setMaleVoice] = useState('')
  const [femaleVoice, setFemaleVoice] = useState('')
  const [effectsProfile, setEffectsProfile] = useState(true)
  const [speakingRate, setSpeakingRate] = useState(1)
  const [targetLufs, setTargetLufs] = useState(-14)

  // Idiomas e vozes do lote + idioma que a matriz mostra
  const [selectedLocales, setSelectedLocales] = useState<string[]>([])
  // Só masculino por padrão: é o que o acervo tem hoje, e gerar uma voz que ninguém
  // pediu custa TTS, tradução e um arquivo a mais em bucket público.
  const [selectedGenders, setSelectedGenders] = useState<VoiceGender[]>(['male'])
  const [inspectLocale, setInspectLocale] = useState('pt-br')
  const [overwrite, setOverwrite] = useState(false)

  const [openScript, setOpenScript] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState<Record<string, string>>({})
  /** chave → { locale → linha traduzida }. Preenchido por "Revisar traduções". */
  const [translationPreview, setTranslationPreview] = useState<
    Record<string, Record<string, string>>
  >({})
  const [busy, setBusy] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteTyped, setDeleteTyped] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchInventory()
      setInventory(data)
      setSelectedLocales((current) =>
        current.length > 0 ? current : data.catalogue.locales.map((l) => l.locale)
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filesByPath = useMemo(() => {
    const map = new Map<string, SystemAudioFile>()
    inventory?.files.forEach((f) => map.set(f.path, f))
    return map
  }, [inventory])

  const catalogue = inventory?.catalogue
  const scripts = catalogue?.scripts ?? []
  const genders = catalogue?.genders ?? []
  const localesInfo = catalogue?.locales ?? []
  const sourceLocale = catalogue?.sourceLocale ?? 'pt-br'

  const fileNameOf = (path: string) => path.split('/').pop() ?? path

  const pathFor = (script: SystemAudioScript, locale: string, gender: VoiceGender) =>
    catalogue ? fileKey(script.family, catalogue.folders, script.key, locale, gender) : ''

  const voiceFor = (gender: VoiceGender) => (gender === 'male' ? maleVoice : femaleVoice)

  /**
   * `text` é o texto-FONTE em pt-BR. A EF traduz para qualquer locale que não seja o
   * de origem — é o que permite escrever uma vez e gerar em doze idiomas.
   */
  const requestFor = (
    script: SystemAudioScript,
    locale: string,
    gender: VoiceGender
  ): GenerateRequest => ({
    family: script.family,
    key: script.key,
    locale,
    gender,
    tier,
    voiceName: tier === 'hd' && voiceFor(gender) ? voiceFor(gender) : undefined,
    speakingRate,
    effectsProfile,
    targetLufs,
    text: textDraft[script.key]?.trim() ? textDraft[script.key].trim() : undefined,
  })

  const sourceTextOf = (script: SystemAudioScript) =>
    textDraft[script.key]?.trim() || script.sourceText || ''

  const generateOne = async (script: SystemAudioScript, locale: string, gender: VoiceGender) => {
    const path = pathFor(script, locale, gender)
    setBusy(path)
    setError(null)
    try {
      setLastResult(await generateSystemAudio(requestFor(script, locale, gender)))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Lote: cada chave com texto escrito × cada idioma marcado × as duas vozes.
   * Sequencial de propósito — cada item é uma tradução no Gemini e uma síntese no
   * Google, e paralelizar aqui só troca espera por 429.
   */
  const generateBatch = async (only?: SystemAudioScript) => {
    if (!catalogue) return

    const targets = planBatch({
      scripts: only ? [only] : scripts,
      folders: catalogue.folders,
      locales: selectedLocales,
      genders: selectedGenders,
      existing: new Set(filesByPath.keys()),
      overwrite,
      sourceTextOf,
    })

    if (targets.length === 0) return

    setBusy('batch')
    setBatchProgress({ done: 0, total: targets.length })
    setError(null)

    try {
      for (const [index, target] of targets.entries()) {
        try {
          setLastResult(
            await generateSystemAudio(requestFor(target.script, target.locale, target.gender))
          )
        } catch (e) {
          // Um idioma que falha não derruba o lote — o que ficou de fora reaparece
          // como buraco na matriz, que é onde o operador vai procurar de novo.
          setError(
            `${target.script.key}/${target.locale}/${target.gender}: ${
              e instanceof Error ? e.message : 'falhou'
            }`
          )
        }
        setBatchProgress({ done: index + 1, total: targets.length })
      }
      await load()
    } finally {
      setBusy(null)
      setBatchProgress(null)
    }
  }

  const remove = async () => {
    if (!deleteTarget || deleteTyped !== fileNameOf(deleteTarget)) return
    setBusy(deleteTarget)
    setError(null)
    try {
      await deleteSystemAudio(deleteTarget)
      setDeleteTarget(null)
      setDeleteTyped('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao apagar')
    } finally {
      setBusy(null)
    }
  }

  const toggleText = async (script: SystemAudioScript) => {
    if (openScript === script.key) {
      setOpenScript(null)
      return
    }
    setOpenScript(script.key)
    setTextDraft((prev) =>
      prev[script.key] === undefined ? { ...prev, [script.key]: script.sourceText ?? '' } : prev
    )
  }

  /**
   * Traduz a linha em TODOS os idiomas marcados e mostra a tabela, sem gerar áudio.
   *
   * É a auditoria que faltava: o arquivo no bucket não guarda o texto falado, então
   * a única forma de saber o que uma voz diz em coreano era ouvir. Foi assim que
   * `logo à frente` virou "Logo ahead" em inglês e ninguém viu até tocar.
   */
  const reviewTranslations = async (script: SystemAudioScript) => {
    setBusy(`preview:${script.key}`)
    setError(null)
    try {
      const lines: Record<string, string> = {}
      for (const locale of selectedLocales) {
        try {
          const preview = await previewSystemAudioText(
            requestFor(script, locale, selectedGenders[0] ?? 'male')
          )
          lines[locale] = preview.text
        } catch (e) {
          lines[locale] = `⚠️ ${e instanceof Error ? e.message : 'falhou'}`
        }
      }
      setTranslationPreview((prev) => ({ ...prev, [script.key]: lines }))
    } finally {
      setBusy(null)
    }
  }

  /** Cobertura da chave contra o que está marcado — idiomas do catálogo × vozes escolhidas. */
  const coverageOf = (script: SystemAudioScript) => {
    let done = 0
    for (const { locale } of localesInfo) {
      for (const gender of selectedGenders) {
        if (filesByPath.has(pathFor(script, locale, gender))) done++
      }
    }
    return { done, total: localesInfo.length * selectedGenders.length }
  }

  /** Exatamente o que o botão de lote vai escrever — mesma função, sem segunda regra. */
  const plannedTargets = useMemo(() => {
    if (!catalogue) return []
    return planBatch({
      scripts,
      folders: catalogue.folders,
      locales: selectedLocales,
      genders: selectedGenders,
      existing: new Set(filesByPath.keys()),
      overwrite,
      sourceTextOf,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, scripts, selectedLocales, selectedGenders, filesByPath, overwrite, textDraft])

  /**
   * Quantos alvos o lote está pulando por já existirem. Sem este número o operador
   * pede "gerar tudo", recebe "gerar 4", e conclui que a sobrescrita falhou — foi o
   * que aconteceu: 30 arquivos de janeiro ficaram intactos e pareceram um defeito.
   */
  const skippedExisting = useMemo(() => {
    if (!catalogue || overwrite) return 0
    const all = planBatch({
      scripts,
      folders: catalogue.folders,
      locales: selectedLocales,
      genders: selectedGenders,
      existing: new Set<string>(),
      overwrite: true,
      sourceTextOf,
    })
    return all.length - plannedTargets.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, scripts, selectedLocales, selectedGenders, overwrite, plannedTargets, textDraft])

  if (loading && !inventory) {
    return (
      <div className="flex items-center gap-2 p-8 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando áudios de sistema…
      </div>
    )
  }

  const directional = scripts.filter((s) => s.family === 'directional')
  const notices = scripts.filter((s) => s.family === 'notice')
  const inspectInfo = localesInfo.find((l) => l.locale === inspectLocale)
  const hdUnavailable = tier === 'hd' && inspectInfo && !inspectInfo.hdAvailable

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Volume2 className="h-6 w-6" /> Áudios de sistema
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Um texto em pt-BR por chave, traduzido para os idiomas marcados. Nome fechado:{' '}
            <code>{'{chave}_{locale}_{genero}.mp3'}</code>.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy !== null}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {deleteTarget && (
        <Card className="border-red-300 dark:border-red-900">
          <CardContent className="space-y-3 pt-6">
            <div className="text-sm">
              Apagar <code className="font-semibold">{deleteTarget}</code>. Quem já tem o app
              continua tocando o que está em cache; quando o cache cair, o clipe some até ser
              gerado de novo. Digite <code>{fileNameOf(deleteTarget)}</code> para confirmar.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                placeholder={fileNameOf(deleteTarget)}
                className="max-w-sm"
              />
              <Button
                variant="destructive"
                disabled={deleteTyped !== fileNameOf(deleteTarget) || busy !== null}
                onClick={() => void remove()}
              >
                {busy === deleteTarget ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Apagar
              </Button>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Voz</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Tipo de voz</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as VoiceTier)}>
              <option value="hd">Áudio 3D (Chirp 3: HD)</option>
              <option value="legacy">Áudio atual (Neural2 / WaveNet)</option>
            </Select>
          </div>

          <div>
            <Label>Altura</Label>
            <Select value={String(targetLufs)} onValueChange={(v) => setTargetLufs(Number(v))}>
              <option value="-16">−16 LUFS · discreto</option>
              <option value="-14">−14 LUFS · Spotify &quot;Normal&quot; (padrão)</option>
              <option value="-11">−11 LUFS · Spotify &quot;Loud&quot;, para estrada</option>
            </Select>
          </div>

          <div>
            <Label>Velocidade ({speakingRate.toFixed(2)}×)</Label>
            <input
              type="range"
              min={0.75}
              max={1.3}
              step={0.05}
              value={speakingRate}
              onChange={(e) => setSpeakingRate(Number(e.target.value))}
              className="mt-3 w-full"
            />
          </div>

          {tier === 'hd' && (
            <>
              {(['male', 'female'] as VoiceGender[]).map((gender) => {
                const value = gender === 'male' ? maleVoice : femaleVoice
                const setValue = gender === 'male' ? setMaleVoice : setFemaleVoice
                const suggested = inspectInfo?.recommendedVoice?.[gender]

                return (
                  <div key={gender}>
                    <Label>Voz {gender === 'male' ? 'masculina' : 'feminina'}</Label>
                    <Select value={value} onValueChange={setValue}>
                      <option value="">
                        Automática — recomendada por idioma
                        {suggested ? ` (${inspectLocale}: ${suggested})` : ''}
                      </option>
                      {catalogue?.voices
                        .filter((v) => v.gender === gender)
                        .map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                )
              })}
              <p className="text-xs text-gray-500 md:col-span-3">
                Em automática, cada idioma recebe a voz sugerida para ele — o mapa está em{' '}
                <code>CHIRP3_HD_VOICE_BY_LOCALE</code>. Escolher uma voz aqui fixa a mesma para
                <strong> todos</strong> os idiomas do lote, o que desfaz o mapa.
              </p>
            </>
          )}

          <div className="flex items-end gap-2">
            <Checkbox
              id="effects-profile"
              checked={effectsProfile}
              onCheckedChange={(v: boolean) => setEffectsProfile(Boolean(v))}
            />
            <Label htmlFor="effects-profile" className="mb-0">
              Perfil automotivo (EQ de som de carro)
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Languages className="h-5 w-5" /> Idiomas e vozes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Label className="mb-0 text-xs text-gray-500">Gerar nas vozes</Label>
            {genders.map((gender) => (
              <div key={gender} className="flex items-center gap-2">
                <Checkbox
                  id={`gender-${gender}`}
                  checked={selectedGenders.includes(gender)}
                  onCheckedChange={(v: boolean) =>
                    setSelectedGenders((prev) =>
                      v ? [...prev, gender] : prev.filter((g) => g !== gender)
                    )
                  }
                />
                <Label htmlFor={`gender-${gender}`} className="mb-0 text-sm capitalize">
                  {gender === 'male' ? 'Masculina' : 'Feminina'}
                </Label>
              </div>
            ))}
            {selectedGenders.length === 0 && (
              <span className="text-xs text-amber-600">Nenhuma voz marcada — nada será gerado.</span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {localesInfo.map(({ locale, hdAvailable }) => {
              const selected = selectedLocales.includes(locale)
              const display = localeDisplay(locale)
              return (
                <label
                  key={locale}
                  className={cn(
                    'relative flex cursor-pointer select-none flex-col items-center justify-center rounded-xl border py-2 text-center transition-all',
                    selected
                      ? 'border-tuggi-blue bg-tuggi-blue/10 ring-1 ring-tuggi-blue/20'
                      : 'border-gray-200 hover:border-tuggi-blue/40 dark:border-gray-800'
                  )}
                  title={hdAvailable ? locale : `${locale} — sem Chirp 3: HD, sai na voz atual`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    onChange={() =>
                      setSelectedLocales((prev) =>
                        prev.includes(locale)
                          ? prev.filter((l) => l !== locale)
                          : [...prev, locale]
                      )
                    }
                  />
                  <span className="text-xl leading-none">{display.flag}</span>
                  <span className="mt-1 text-[10px] font-bold uppercase tracking-tight">
                    {display.short}
                  </span>
                  {locale === sourceLocale && (
                    <span className="text-[9px] text-tuggi-blue">fonte</span>
                  )}
                  {!hdAvailable && <span className="text-[9px] text-amber-600">sem 3D</span>}
                </label>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-gray-500">
              {selectedLocales.length} idioma(s) ·{' '}
              {selectedGenders.length === 2 ? 'duas vozes' : selectedGenders[0] === 'female' ? 'voz feminina' : 'voz masculina'}
              {' · '}
              <strong>{plannedTargets.length}</strong> arquivo(s) a gerar
            </span>
            <div className="flex items-center gap-3">
              <button
                className="text-xs font-semibold text-tuggi-blue hover:underline"
                onClick={() => setSelectedLocales(localesInfo.map((l) => l.locale))}
              >
                Todos
              </button>
              <button
                className="text-xs font-semibold text-gray-400 hover:underline"
                onClick={() => setSelectedLocales([])}
              >
                Nenhum
              </button>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="overwrite"
                  checked={overwrite}
                  onCheckedChange={(v: boolean) => setOverwrite(Boolean(v))}
                />
                <Label htmlFor="overwrite" className="mb-0 text-xs">
                  Regerar o que já existe
                </Label>
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={busy !== null || plannedTargets.length === 0}
            onClick={() => void generateBatch()}
          >
            {busy === 'batch' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            {batchProgress
              ? `Gerando ${batchProgress.done}/${batchProgress.total}…`
              : `Traduzir e gerar ${plannedTargets.length} arquivo(s)`}
          </Button>

          {skippedExisting > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {skippedExisting} arquivo(s) já existem e serão <strong>pulados</strong>. Para
              substituir o acervo antigo pela voz e pelo volume atuais, marque{' '}
              <em>Regerar o que já existe</em>.
            </p>
          )}

          {batchProgress && (
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full bg-tuggi-blue transition-all"
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Label className="mb-0 shrink-0 text-xs text-gray-500">Ouvir o idioma</Label>
            <Select value={inspectLocale} onValueChange={setInspectLocale} className="max-w-xs">
              {localesInfo.map((l) => (
                <option key={l.locale} value={l.locale}>
                  {localeDisplay(l.locale).flag} {l.locale}
                  {l.hdAvailable ? '' : ' (sem áudio 3D)'}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {hdUnavailable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            O Google não publica Chirp 3: HD para <strong>{inspectLocale}</strong>. O que for
            gerado nesse idioma sai na voz atual — e o resultado diz isso. Não há troca por outro
            sotaque.
          </span>
        </div>
      )}

      {lastResult && (
        <Card>
          <CardContent className="space-y-1 pt-6 text-sm">
            <div className="font-semibold">{lastResult.path}</div>
            <div className="italic text-gray-600 dark:text-gray-400">
              &ldquo;{lastResult.text}&rdquo;
              {lastResult.translated && ' · tradução automática'}
            </div>
            <div className="text-gray-500">
              {lastResult.voice} · {formatBytes(lastResult.bytes)} · {lastResult.bitrateKbps} kbps ·{' '}
              {lastResult.sampleRate} Hz
            </div>
            <div className="text-gray-500">
              {lastResult.loudness.inputLufs} → <strong>{lastResult.loudness.outputLufs} LUFS</strong>{' '}
              (alvo {lastResult.loudness.targetLufs}) · pico {lastResult.loudness.truePeakDbtp} dBTP ·
              ganho {lastResult.loudness.appliedGainDb} dB · limitador{' '}
              {lastResult.loudness.limiterReductionDb} dB
            </div>
            {lastResult.loudness.peakLimited && (
              <div className="text-amber-700 dark:text-amber-300">
                Nem com o limitador o alvo foi alcançado — o clipe saiu mais baixo que o pedido.
              </div>
            )}
            {lastResult.tierRequested === 'hd' && lastResult.tierUsed === 'legacy' && (
              <div className="text-amber-700 dark:text-amber-300">
                Pedido em áudio 3D, gerado na voz atual — este idioma não tem Chirp 3: HD.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {[
        { title: 'Direções', rows: directional },
        { title: 'Avisos', rows: notices },
      ].map(({ title, rows }) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((script) => {
              const coverage = coverageOf(script)
              const hasText = Boolean(sourceTextOf(script))

              return (
                <div key={script.key} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[18rem]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{script.key}</span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            coverage.done === coverage.total
                              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                          )}
                        >
                          {coverage.done}/{coverage.total}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">{script.trigger}</div>
                      <div className="mt-1 text-sm italic text-gray-700 dark:text-gray-300">
                        &ldquo;{sourceTextOf(script) || 'sem texto'}&rdquo;
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      {genders.map((gender) => {
                        const path = pathFor(script, inspectLocale, gender)
                        const file = filesByPath.get(path)
                        const isBusy = busy === path

                        return (
                          <div key={gender} className="flex items-center gap-2">
                            <span className="w-14 text-xs uppercase text-gray-500">{gender}</span>
                            {file ? (
                              <>
                                <audio controls preload="none" src={file.publicUrl} className="h-8" />
                                <span className="text-xs text-gray-500">
                                  {formatBytes(file.bytes)}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy || busy !== null}
                                  onClick={() => void generateOne(script, inspectLocale, gender)}
                                  title="Gerar de novo com as configurações acima"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={isBusy || busy !== null}
                                  onClick={() => {
                                    setDeleteTarget(path)
                                    setDeleteTyped('')
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                disabled={busy !== null || !hasText}
                                onClick={() => void generateOne(script, inspectLocale, gender)}
                              >
                                {isBusy ? (
                                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                ) : (
                                  <Play className="mr-2 h-3 w-3" />
                                )}
                                Gerar
                              </Button>
                            )}
                          </div>
                        )
                      })}

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          busy !== null ||
                          !hasText ||
                          selectedLocales.length === 0 ||
                          selectedGenders.length === 0
                        }
                        onClick={() => void generateBatch(script)}
                        title="Gerar esta chave nos idiomas e vozes marcados acima"
                      >
                        <Languages className="mr-2 h-3 w-3" /> Todos os idiomas
                      </Button>

                      <Button size="sm" variant="ghost" onClick={() => void toggleText(script)}>
                        Texto
                      </Button>
                    </div>
                  </div>

                  {openScript === script.key && (
                    <div className="mt-3 space-y-2">
                      <Label>Texto base ({sourceLocale})</Label>
                      <Textarea
                        rows={3}
                        value={textDraft[script.key] ?? ''}
                        onChange={(e) =>
                          setTextDraft((prev) => ({ ...prev, [script.key]: e.target.value }))
                        }
                      />
                      <p className="text-xs text-gray-500">
                        Este é o único texto escrito à mão. Os outros onze idiomas são tradução
                        dele, feita na hora de gerar — editar aqui muda todos.
                      </p>
                      <div className="space-y-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null || selectedLocales.length === 0}
                          onClick={() => void reviewTranslations(script)}
                        >
                          {busy === `preview:${script.key}` ? (
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          ) : (
                            <Languages className="mr-2 h-3 w-3" />
                          )}
                          Revisar traduções ({selectedLocales.length} idiomas)
                        </Button>

                        {translationPreview[script.key] && (
                          <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-sm">
                              <tbody>
                                {Object.entries(translationPreview[script.key]).map(
                                  ([locale, line]) => (
                                    <tr key={locale} className="border-b last:border-0">
                                      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500">
                                        {localeDisplay(locale).flag} {locale}
                                      </td>
                                      <td className="px-3 py-1.5 italic">{line}</td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                            <p className="px-3 py-2 text-xs text-gray-500">
                              Nada disso foi sintetizado — é só a tradução. Leia antes de gerar:
                              o arquivo no bucket não guarda o texto falado.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
