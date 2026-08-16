/**
 * The versioned contract template — #342.
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT. The card says it plainly: "a redação jurídica
 * final é de advogado; nós construímos a máquina e a cláusula de aceite". So this is the
 * machine — the clause list, the order, the ids, the variables each clause reads and the
 * rule each one implements. The wording below states the policy that is already registered
 * in `docs/business-rules/`, and it is a MINUTA until a lawyer replaces it.
 *
 * VERSIONING IS NOT DECORATION. A signed contract has to be re-renderable, byte for byte,
 * years later: the acceptance trail stores `template_version`, and the renderer looks the
 * version up here. Publishing v2 therefore never edits v1 — it adds an entry. Editing a
 * published version in place would silently change what a signed hash claims to prove.
 *
 * THE GATE. `legalReview.status` is `pending` while a clause still carries a decision no
 * agent may take — BR-B2B-023, item 2 is explicit that the adjustment index is chosen by
 * the lawyer and the operator and that *no document names it before that*. While it is
 * pending the document can be generated and read (that is how the lawyer gets the draft),
 * but `sendForSignature` and `acceptContract` refuse. The refusal is in
 * `lib/services/partner-contract-service.ts` and it is proven by a test.
 *
 * Numbers in the clauses are not typed here twice: each one is a constant with the ID of
 * the rule it comes from (CLAUDE.md §6, SSOT).
 */

import {
  formatCommissionRate,
  formatDate,
  formatFee,
  formatTaxId,
  type ContractSnapshot,
  type ContractTier,
} from './snapshot'

/** BR-B2B-023, item 1 — rescisão por qualquer parte, aviso em dias corridos. */
export const TERMINATION_NOTICE_DAYS = 30

/** BR-B2B-019, item 2 — tolerância, avisos e suspensão, em dias corridos do vencimento. */
export const GRACE_PERIOD_DAYS = 10
export const FIRST_DUNNING_DAY = 1
export const SECOND_DUNNING_DAY = 7
export const SUSPENSION_DAY = 11

export interface ContractClause {
  /** Stable across versions; the trail and the tests cite this, never the position. */
  id: string
  /** Shown as `<h2>` on the page, in the index and as the heading in the PDF. */
  title: string
  /** The rules this clause implements. Empty only for the ones that are pure form. */
  ruleIds: readonly string[]
  /** Which tier gets the clause. The instrument is the same for both (BR-B2B-022, item 2). */
  appliesTo?: ContractTier
  /** Paragraphs, in order. Reads the snapshot and nothing else. */
  body: (snapshot: ContractSnapshot) => readonly string[]
}

export interface ContractTemplate {
  version: string
  /** What the partner sees as the document title. */
  title: string
  publishedAt: string
  legalReview: {
    status: 'pending' | 'approved'
    /** Clause ids still carrying a decision that is not ours to take. */
    pending: readonly string[]
    note: string
  }
  clauses: readonly ContractClause[]
}

/**
 * The clause the MP 2.200-2, art. 10, §2º requires to be INSIDE the contract: without the
 * parties admitting this form of signature in the instrument itself, nothing else in this
 * feature has legal cover. The checkbox on the signing page references it by name, and a
 * test asserts it is present in the rendered text — remove it and the external route stops
 * being publishable (spec do `design`, §4.2).
 */
export const ELECTRONIC_ACCEPTANCE_CLAUSE_ID = 'electronic_acceptance'

export const ELECTRONIC_ACCEPTANCE_CLAUSE_TITLE = 'Aceite eletrônico e prova da assinatura'

const V1: ContractTemplate = {
  version: 'v1-2026-08',
  title: 'Contrato de parceria — Tuggi',
  publishedAt: '2026-08-14',
  legalReview: {
    status: 'pending',
    pending: ['price_and_payment', 'governing_law'],
    note:
      'Minuta pendente de revisão jurídica: o índice de reajuste (BR-B2B-023, item 2) e o foro ' +
      'são escolha do advogado e do operador, e nenhum agente os nomeia. Enquanto esta versão ' +
      'estiver pendente, o contrato pode ser gerado e lido, mas não pode ser enviado para ' +
      'assinatura.',
  },
  clauses: [
    {
      id: 'parties',
      title: 'Das partes',
      ruleIds: ['BR-B2B-024'],
      body: (s) => [
        `CONTRATADA: ${s.provider.legalName}, inscrita no CNPJ sob o nº ${formatTaxId(s.provider.taxId)}, ` +
          `com sede em ${s.provider.addressLine}, neste ato representada por ${s.provider.representativeName}, ` +
          `${s.provider.representativeRole}, doravante denominada TUGGI.`,
        `CONTRATANTE: ${s.partner.legalName}${s.partner.tradeName && s.partner.tradeName !== s.partner.legalName ? `, nome fantasia ${s.partner.tradeName}` : ''}, ` +
          `inscrita no CNPJ sob o nº ${formatTaxId(s.partner.taxId)}, com estabelecimento em ${s.partner.addressLine}, ` +
          `neste ato representada por ${s.partner.representativeName}, ${s.partner.representativeRole}, ` +
          `doravante denominada ESTABELECIMENTO.`,
        'A contraparte deste contrato é a pessoa jurídica identificada pelo CNPJ acima. A alteração do ' +
          'quadro societário ou da titularidade, mantido o mesmo CNPJ, não altera este contrato, que ' +
          'permanece íntegro. A operação do estabelecimento sob CNPJ diverso exige contrato novo, e nada ' +
          'deste instrumento se transfere automaticamente a ele.',
      ],
    },
    {
      id: 'object',
      title: 'Do objeto',
      ruleIds: ['BR-B2B-016'],
      body: (s) => [
        'A TUGGI opera um guia de áudio para turistas. Este contrato tem por objeto a inclusão do ' +
          'estabelecimento do CONTRATANTE no aplicativo da TUGGI, em uma das duas faixas descritas abaixo.',
        'FAIXA GRATUITA: o estabelecimento é um ponto no aplicativo, e o áudio entregue ao turista que ' +
          'passa nas proximidades indica a direção e diz o nome do estabelecimento, e nada além disso. ' +
          'Não há remuneração devida à TUGGI nesta faixa; a contrapartida do ESTABELECIMENTO é a exibição ' +
          'do QR Code e do display fornecidos pela TUGGI, na forma da cláusula "Do material de divulgação".',
        'FAIXA PAGA: ao mesmo áudio acrescenta-se uma descrição do estabelecimento, produzida pela TUGGI ' +
          'a partir das informações fornecidas pelo ESTABELECIMENTO, mediante a contraprestação mensal ' +
          'prevista na cláusula "Do preço, da forma de pagamento e do reajuste".',
        s.tier === 'paid'
          ? 'A faixa contratada neste instrumento é a FAIXA PAGA.'
          : 'A faixa contratada neste instrumento é a FAIXA GRATUITA.',
        'A contratação de qualquer das faixas não concede ao ESTABELECIMENTO, a seus sócios, prepostos ou ' +
          'clientes qualquer acesso, plano, crédito de tempo ou vantagem no aplicativo da TUGGI, e não ' +
          'altera o preço pago pelo turista.',
      ],
    },
    {
      id: 'regularity',
      title: 'Da regularidade do estabelecimento',
      ruleIds: ['BR-B2B-022'],
      body: () => [
        'O ESTABELECIMENTO declara, neste ato, que possui CNPJ ativo, alvará de funcionamento vigente e ' +
          'documentação de constituição que identifica o seu representante legal, e que apresentou os ' +
          'documentos correspondentes à TUGGI.',
        'A regularidade é obrigação continuada e não retrato da data da assinatura. O ESTABELECIMENTO ' +
          'obriga-se a manter, durante toda a vigência deste contrato, as condições de regularidade acima, ' +
          'e a comunicar à TUGGI, por escrito, a perda de qualquer uma delas.',
        'A perda da regularidade é causa de encerramento deste contrato, sem prejuízo do disposto na ' +
          'cláusula "Do descumprimento e da penalidade".',
      ],
    },
    {
      id: 'tuggi_obligations',
      title: 'Do material de divulgação e das obrigações da Tuggi',
      ruleIds: ['BR-B2B-021'],
      body: (s) => [
        `A TUGGI obriga-se a fornecer ao ESTABELECIMENTO, sem custo, o QR Code e o display de mesa de sua ` +
          `identidade visual, no prazo de ${s.qrDeliveryDays} dias corridos contados da assinatura deste contrato.`,
        'O QR Code fornecido é instrumento de atribuição da origem do turista, e não instrumento de venda. ' +
          'O material não constitui brinde, kit ou contrapartida comercial de qualquer natureza.',
        'A TUGGI obriga-se, ainda, a manter o estabelecimento incluído no aplicativo na faixa contratada, ' +
          'observadas as demais cláusulas deste instrumento.',
      ],
    },
    {
      id: 'partner_obligations',
      title: 'Das obrigações do estabelecimento',
      ruleIds: ['BR-B2B-021'],
      body: () => [
        'O ESTABELECIMENTO obriga-se a manter o QR Code e o display fornecidos pela TUGGI visíveis ao ' +
          'público, na forma acordada, de maneira continuada durante toda a vigência deste contrato. Esta ' +
          'obrigação não se cumpre com um único ato de adesão.',
        'O ESTABELECIMENTO obriga-se a fornecer à TUGGI as informações necessárias à faixa contratada e a ' +
          'comunicar alterações relevantes de endereço, razão social, representação legal e regularidade.',
      ],
    },
    {
      id: 'curation',
      title: 'Da curadoria do conteúdo',
      ruleIds: ['BR-B2B-016', 'BR-B2B-025'],
      body: () => [
        'O ESTABELECIMENTO fornece o insumo; a TUGGI redige, produz e narra o texto que chega ao turista. ' +
          'A redação final, a extensão, o tom e a decisão de publicar são da TUGGI, e o ESTABELECIMENTO não ' +
          'tem direito de exigir a publicação de texto de sua própria autoria.',
        'A TUGGI pode recusar ou solicitar a substituição de insumo que não atenda à sua régua editorial, ' +
          'sem que isso configure descumprimento deste contrato por qualquer das partes.',
      ],
    },
    {
      id: 'content_accuracy',
      title: 'Da veracidade das informações',
      ruleIds: ['BR-B2B-025'],
      body: () => [
        'O ESTABELECIMENTO declara que as informações que fornece à TUGGI são verdadeiras e que não ' +
          'infringem direito de terceiro, seja autoral, de imagem ou de marca, e responde por elas.',
        'A TUGGI narra o que o ESTABELECIMENTO afirma e não apura, confere ou certifica fato de terceiro em ' +
          'razão deste contrato.',
      ],
    },
    {
      id: 'term',
      title: 'Da vigência e do início da cobrança',
      ruleIds: ['BR-B2B-018', 'BR-B2B-023', 'BR-B2B-026'],
      body: (s) => [
        `Este contrato vigora por prazo indeterminado e a sua vigência começa a contar da data da ` +
          `assinatura eletrônica de que trata a cláusula "${ELECTRONIC_ACCEPTANCE_CLAUSE_TITLE}".`,
        s.tier === 'paid'
          ? 'Vigência e cobrança são coisas distintas: a contraprestação mensal somente começa a correr na ' +
            'data da publicação, no aplicativo, do ponto do ESTABELECIMENTO com a descrição da faixa paga no ' +
            'ar. Não há cobrança pela adesão, pelo envio de informações nem pelo período que anteceder a ' +
            'publicação.'
          : 'Na faixa gratuita não há contraprestação devida à TUGGI, em nenhum momento da vigência.',
        `Qualquer das partes pode rescindir este contrato a qualquer tempo, sem multa e sem período mínimo ` +
          `de permanência, mediante aviso à outra parte com ${TERMINATION_NOTICE_DAYS} dias corridos de ` +
          `antecedência, contados do recebimento do aviso.`,
      ],
    },
    {
      id: 'price_and_payment',
      title: 'Do preço, da forma de pagamento e do reajuste',
      ruleIds: ['BR-B2B-017', 'BR-B2B-023'],
      appliesTo: 'paid',
      body: (s) => [
        s.isCourtesy
          ? `A faixa paga é concedida ao ESTABELECIMENTO em regime de cortesia, sem contraprestação mensal, ` +
            `pelo seguinte motivo: ${s.courtesyReason}. A cortesia não é gratuidade permanente e a sua ` +
            `alteração observa o disposto no parágrafo sobre revisão de valor.`
          : `Pela faixa paga, o ESTABELECIMENTO pagará à TUGGI a quantia mensal de ${formatFee(s.monthlyFeeCents)}, ` +
            `a partir do início da cobrança previsto na cláusula "Da vigência e do início da cobrança".`,
        s.isCourtesy
          ? 'Não há forma de pagamento acordada enquanto durar a cortesia.'
          : `A forma de pagamento acordada entre as partes é: ${s.paymentMethod === 'pix' ? 'Pix' : 'boleto bancário'}.`,
        `O valor acima é o valor aceito pelo ESTABELECIMENTO no ato da assinatura deste instrumento e é o ` +
          `valor devido durante a sua vigência. A alteração do valor de contrato vigente depende de termo ` +
          `aditivo com novo aceite do ESTABELECIMENTO, e nenhuma alteração de cadastro interno da TUGGI ` +
          `altera o valor aqui pactuado.`,
        `O valor será reajustado anualmente, no aniversário deste contrato, pela variação acumulada do ` +
          `índice [ÍNDICE A DEFINIR PELO JURÍDICO] no período, ou pelo índice que legalmente o substituir.`,
      ],
    },
    {
      id: 'payment_default',
      title: 'Da inadimplência',
      ruleIds: ['BR-B2B-019'],
      appliesTo: 'paid',
      body: () => [
        `Vencida e não paga a contraprestação mensal, o ESTABELECIMENTO disporá de tolerância de ` +
          `${GRACE_PERIOD_DAYS} dias corridos contados do vencimento, e será avisado pela TUGGI no ` +
          `${FIRST_DUNNING_DAY}º e no ${SECOND_DUNNING_DAY}º dia após o vencimento.`,
        `Persistindo a inadimplência, a TUGGI suspenderá a descrição do ESTABELECIMENTO no aplicativo a ` +
          `partir do ${SUSPENSION_DAY}º dia contado do vencimento.`,
        'A suspensão alcança exclusivamente a descrição da faixa paga daquele estabelecimento. O ponto ' +
          'permanece no aplicativo, rebaixado à menção direcional da faixa gratuita, e a suspensão não ' +
          'alcança o nome, a presença no mapa, o QR Code ou a participação na receita.',
        'O pagamento do débito restabelece a descrição, sem nova triagem do insumo já apresentado.',
      ],
    },
    {
      id: 'commission',
      title: 'Da participação na receita',
      ruleIds: ['BR-MONETIZACAO-039', 'BR-B2B-018'],
      body: (s) => [
        `O ESTABELECIMENTO faz jus a ${formatCommissionRate(s.commissionRate)} da receita líquida ` +
          `atribuída à origem identificada pelo QR Code que lhe for fornecido, apurada na forma acordada ` +
          `entre as partes.`,
        'A participação na receita e a contraprestação mensal da faixa paga, quando houver, são fluxos ' +
          'independentes e não se compensam entre si.',
      ],
    },
    {
      id: 'penalties',
      title: 'Do descumprimento e da penalidade',
      ruleIds: ['BR-B2B-027'],
      body: () => [
        'O descumprimento das obrigações deste contrato, em especial a não manutenção do QR Code e do ' +
          'display visíveis ao público e a perda da regularidade do estabelecimento, sujeita o ' +
          'ESTABELECIMENTO à suspensão da descrição da faixa paga e à suspensão da atribuição de origem do ' +
          'seu QR Code.',
        'O ponto do estabelecimento permanece no aplicativo em qualquer hipótese, rebaixado à menção ' +
          'direcional da faixa gratuita.',
      ],
    },
    {
      id: 'non_exclusivity',
      title: 'Da não exclusividade',
      ruleIds: ['BR-B2B-023'],
      body: () => [
        'Este contrato não é exclusivo em nenhuma das duas direções. A TUGGI não se obriga a manter o ' +
          'ESTABELECIMENTO como único do seu ramo, da sua rua, do seu bairro ou da sua cidade no ' +
          'aplicativo, e o ESTABELECIMENTO não fica impedido de contratar com concorrentes da TUGGI.',
      ],
    },
    {
      id: 'brand_license',
      title: 'Da licença de uso de marca e imagem',
      ruleIds: ['BR-B2B-023'],
      body: () => [
        'O ESTABELECIMENTO licencia à TUGGI, sem exclusividade e sem remuneração adicional, o uso do seu ' +
          'nome, marca, imagem e fotografias do local no aplicativo e no material de divulgação da TUGGI, ' +
          'limitado à finalidade deste contrato.',
        'A TUGGI licencia ao ESTABELECIMENTO, nos mesmos termos, o uso da sua marca no display e no QR Code ' +
          'por ela fornecidos, limitado à finalidade deste contrato.',
        'Ambas as licenças terminam com o contrato, e nenhuma das partes adquire direito sobre a marca da ' +
          'outra.',
      ],
    },
    {
      id: 'data_protection',
      title: 'Da proteção de dados pessoais',
      ruleIds: ['BR-USUARIO-028'],
      body: () => [
        'As partes obrigam-se a observar a Lei nº 13.709/2018 (LGPD) no tratamento dos dados pessoais ' +
          'decorrentes deste contrato.',
        'Cada parte é controladora dos dados pessoais que trata para as suas próprias finalidades. Os dados ' +
          'do representante legal e os documentos fornecidos pelo ESTABELECIMENTO são tratados pela TUGGI ' +
          'para a celebração e a execução deste contrato e para o cumprimento de obrigação legal.',
        'Os dados do turista coletados pela TUGGI quando da leitura do QR Code fornecido ao ESTABELECIMENTO ' +
          'são tratados pela TUGGI, na qualidade de controladora, para a atribuição de origem e para a ' +
          'apuração da participação na receita. A TUGGI não compartilha com o ESTABELECIMENTO dado pessoal ' +
          'identificável do turista.',
      ],
    },
    {
      id: ELECTRONIC_ACCEPTANCE_CLAUSE_ID,
      title: ELECTRONIC_ACCEPTANCE_CLAUSE_TITLE,
      ruleIds: ['BR-B2B-026'],
      body: (s) => [
        'As partes admitem, expressamente e para todos os efeitos, a assinatura eletrônica deste contrato ' +
          'por meio da plataforma da TUGGI, na forma do art. 10, §2º, da Medida Provisória nº 2.200-2/2001, ' +
          'reconhecendo-a como forma válida de comprovação de autoria e de integridade, ainda que não ' +
          'utilize certificado emitido no âmbito da ICP-Brasil.',
        'A assinatura se dá pelo acesso do representante legal do ESTABELECIMENTO ao endereço eletrônico ' +
          'de uso único enviado ao seu e-mail, pela leitura do inteiro teor deste contrato na tela, pela ' +
          'declaração expressa de aceite e pela digitação do seu nome completo, ato que as partes reconhecem ' +
          'como a sua assinatura.',
        'A TUGGI registra e conserva, como prova da assinatura: o resumo criptográfico SHA-256 do documento ' +
          'exibido, a versão deste modelo, o endereço IP registrado pelo servidor, a data e a hora ' +
          'do servidor, e o endereço de e-mail ao qual o endereço eletrônico de uso único foi enviado.',
        'A TUGGI registra também o agente de usuário informado pelo navegador utilizado no aceite. Esse ' +
          'dado é declaração do próprio navegador, e não é conservado como prova de dispositivo.',
        `Este documento corresponde à versão ${s.templateVersion} do modelo de contrato da TUGGI, gerada em ` +
          `${formatDate(s.generatedAt)}.`,
        'As partes dispensam a assinatura de testemunhas, na forma do art. 784, §4º, do Código de Processo ' +
          'Civil.',
      ],
    },
    {
      id: 'governing_law',
      title: 'Do foro e da lei aplicável',
      ruleIds: [],
      body: () => [
        'Este contrato é regido pelas leis da República Federativa do Brasil.',
        'Fica eleito o foro da comarca de [FORO A DEFINIR PELO JURÍDICO] para dirimir as controvérsias ' +
          'decorrentes deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.',
      ],
    },
  ],
}

const TEMPLATES: Record<string, ContractTemplate> = {
  [V1.version]: V1,
}

/** The version a NEW contract is generated with. Signed contracts keep their own. */
export const ACTIVE_TEMPLATE_VERSION = V1.version

export function activeTemplate(): ContractTemplate {
  return V1
}

/**
 * The template a stored contract was generated with. Never falls back to the active one:
 * rendering a signed document with a different version would break the hash it is proved
 * by, and answering "unknown version" is the honest failure.
 */
export function templateByVersion(version: string): ContractTemplate | null {
  return TEMPLATES[version] ?? null
}

export interface RenderedClause {
  id: string
  /** 1-based, computed at render because the tier decides which clauses are in. */
  number: number
  title: string
  ruleIds: readonly string[]
  paragraphs: readonly string[]
}

/**
 * The single source both surfaces render from: the HTML page and the PDF walk this same
 * array. Two presentations of one document — never two documents.
 */
export function renderClauses(snapshot: ContractSnapshot): RenderedClause[] {
  const template = templateByVersion(snapshot.templateVersion)
  if (!template) {
    throw new Error(`unknown contract template version: ${snapshot.templateVersion}`)
  }

  return template.clauses
    .filter((clause) => !clause.appliesTo || clause.appliesTo === snapshot.tier)
    .map((clause, index) => ({
      id: clause.id,
      number: index + 1,
      title: clause.title,
      ruleIds: clause.ruleIds,
      paragraphs: [...clause.body(snapshot)],
    }))
}
