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
 * THERE IS NO GATE, AND NO FIELD DESCRIBING ONE. This template used to carry a
 * `legalReview` object, and `sendForSignature` answered `legal_review_pending` while its
 * status was `pending`. That check came out on 2026-08-17 by decision of the operator —
 * approving a minuta is a human act taken outside this software, and whoever is about to
 * put the document in front of a partner is the one who knows if it is ready. The field
 * outlived the gate by one commit, printing a banner that told the partner the document he
 * had just been sent could not be sent, so it came out too: nothing reads the review state
 * because nothing decides by it. Do not put either back; both are absent on purpose, and
 * `lib/services/partner-contract-service.ts` says the same at `sendForSignature`.
 *
 * What BR-B2B-023, item 2 does require is still enforced by the text itself and by a test:
 * no document NAMES the adjustment index before the lawyer picks it, which is why the
 * clause carries a bracketed hole instead of an acronym. The foro of `governing_law` is a
 * hole for the same reason: it is the lawyer's and the operator's choice, not an agent's.
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

/**
 * O dia do vencimento da mensalidade — decisão do operador em 2026-08-18, para dar ao
 * financeiro uma data só: *"vamos colocar o vencimento para o dia 20 de cada mes, assim podemos
 * enviar as cobranças no inicio do mes"*.
 *
 * ELE PREENCHE UM BURACO, não muda uma régua. BR-B2B-019 conta tolerância, avisos e suspensão
 * *"do vencimento"* e nunca diz que dia é esse — toda a escada de 10/1/7/11 pendia de um marco
 * que documento nenhum fixava. `produto` precisa registrar isto como item da regra.
 */
export const DUE_DAY_OF_MONTH = 20

/**
 * Os números que a minuta de 2026-08-18 introduziu — TODOS PROPOSTA, nenhum decidido.
 *
 * Estão aqui, com nome e ID, para que a revisão do advogado seja uma linha e não uma caçada
 * dentro de parágrafo. Cada um é o valor de mercado usual para o caso, e nenhum tem origem em
 * regra `BR-*` ainda: `produto` registra depois que o jurídico fechar.
 */
/**
 * Multa sobre o débito que sobrevive à rescisão por inadimplência. 2% é o costume do mercado e o
 * teto do CDC, adotado por prudência.
 *
 * NÃO EXISTE CONSTANTE DE JUROS ao lado desta, e a ausência é a decisão: com vencimento certo a
 * mora é automática (Código Civil, arts. 397 e 406), então o contrato cita `juros legais` e não
 * um número que alguém teria de conferir contra a Selic. A multa convencional é a única que
 * precisa estar escrita para existir (art. 408).
 */
export const LATE_FINE_PERCENT = 2

/**
 * O buraco que só o advogado fecha — BR-B2B-023, item 2, e ele continua aberto de propósito.
 *
 * O operador perguntou qual índice é o usual em 2026-08-18 e a resposta é IPCA: o IGP-M mede
 * atacado, é puxado por commodity e câmbio, e acumulou mais de 37% em doze meses em 2021 contra
 * uma inflação ao consumidor perto de 10% — é o reajuste que faz o parceiro cancelar. O IPCA é a
 * inflação oficial, publicada pelo IBGE, e explica-se sozinho ao dono do restaurante.
 *
 * MAS RESPONDER NÃO É DECIDIR. A regra reserva a escolha ao advogado, e trocar o marcador por
 * uma sigla aqui seria um agente tomando a decisão no lugar dele. O marcador fica, e agora ele
 * BLOQUEIA a geração em vez de sair impresso num documento que parece pronto.
 */
export const ADJUSTMENT_INDEX_PLACEHOLDER = '[ÍNDICE A DEFINIR PELO JURÍDICO]'

/**
 * Todo marcador de revisão que o modelo ainda carrega. `contractChecklist` recusa a geração
 * enquanto qualquer um deles aparecer no texto renderizado — um contrato com colchete no corpo é
 * pior que um campo vazio, porque ele parece pronto.
 */
export const REVIEW_PLACEHOLDER_PATTERN = /\[[A-ZÀ-Ú][A-ZÀ-Ú\s]+\]/

/**
 * O foro eleito — a comarca da sede da TUGGI, decidida pelo operador em 2026-08-18.
 *
 * Válido entre empresas (CPC, art. 63). Num contrato de adesão o juiz pode reputar abusiva a
 * eleição que dificulte a defesa (art. 63, §3º), e é por isso que ela acompanha a sede de quem
 * redige em vez de escolher uma comarca sem relação com ninguém.
 */
export const JURISDICTION_CITY = 'São Paulo'
export const JURISDICTION_STATE = 'São Paulo'
/** Dias corridos do vencimento a partir dos quais a TUGGI pode rescindir por falta de pagamento. */
export const TERMINATION_FOR_DEFAULT_DAYS = 60
/** Dias úteis para a TUGGI corrigir erro factual apontado por escrito pelo ESTABELECIMENTO. */
export const FACTUAL_CORRECTION_BUSINESS_DAYS = 5
/** Dias corridos de indisponibilidade contínua imputável à TUGGI que geram crédito proporcional. */
export const OUTAGE_CREDIT_DAYS = 5
/** Meses de mensalidade que limitam a responsabilidade direta, na faixa paga. */
export const LIABILITY_CAP_MONTHS = 12

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

/**
 * As cláusulas que RESTRINGEM o parceiro, e por isso saem em destaque na tela.
 *
 * Contrato de adesão tem duas regras que fazem do destaque medida defensiva, não enfeite: o
 * art. 423 do Código Civil manda interpretar a cláusula ambígua a favor de quem aderiu, e o
 * art. 424 fulmina a renúncia antecipada a direito próprio da natureza do negócio. Uma cláusula
 * limitativa que o aderente não teve como notar é exatamente o que esses dois artigos alcançam.
 *
 * A lista é dos IDs e não de posições, porque a numeração muda com a faixa contratada — a
 * gratuita não recebe as duas cláusulas de dinheiro.
 */
export const RESTRICTIVE_CLAUSE_IDS: readonly string[] = [
  'curation',
  'non_exclusivity',
  'penalties',
  'payment_default',
  'brand_license',
  // O caso de manual do art. 424: limitar responsabilidade é limitar direito do aderente.
  'liability',
]

export interface ContractTemplate {
  version: string
  /** What the partner sees as the document title. */
  title: string
  publishedAt: string
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

/**
 * V2 — o dia do vencimento e o acordo da apuração (2026-08-18).
 *
 * POR QUE UMA VERSÃO NOVA E NÃO UMA EDIÇÃO. Quatro contratos já tinham sido ENVIADOS na v1
 * quando estas duas mudanças foram decididas. Nenhum estava assinado, então nada que um hash
 * prove mudou — mas quatro parceiros tinham na mão um link para um documento, e editar a v1
 * teria trocado o texto sob os pés deles em silêncio. A v1 continua exatamente como saiu; quem
 * a recebeu lê o que recebeu, e um contrato novo nasce na v2.
 *
 * AS CLÁUSULAS VÊM DA v1 E DUAS SÃO SUBSTITUÍDAS POR ID. Não é economia de digitação: escrito
 * assim, o `diff` entre as duas versões é esta constante, e é ela que alguém lê daqui a um ano
 * para saber o que mudou. A v1 estar congelada é o que torna a referência segura, e
 * `tests/api/contract-template-versions.test.ts` fixa o texto renderizado dela por hash — editar
 * a v1 fica vermelho.
 */
const V2_REPLACEMENTS: Record<string, ContractClause> = {
  price_and_payment: {
    id: 'price_and_payment',
    title: 'Do preço, da forma de pagamento e do reajuste',
    ruleIds: ['BR-B2B-017', 'BR-B2B-019', 'BR-B2B-023'],
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
      // O marco que faltava: BR-B2B-019 conta tolerância, avisos e suspensão "do vencimento" e
      // nunca disse que dia era esse.
      `A contraprestação é mensal, vence no dia ${DUE_DAY_OF_MONTH} de cada mês e corresponde ao mês ` +
        `em que vence. A fatura é enviada ao ESTABELECIMENTO no início do mês do vencimento.`,
      `O primeiro vencimento é o dia ${DUE_DAY_OF_MONTH} do mês seguinte ao da publicação de que trata ` +
        `a cláusula "Da vigência e do início da cobrança", e a primeira fatura compreende o período ` +
        `proporcional entre a data da publicação e o último dia daquele mês, somado ao mês do ` +
        `vencimento.`,
      `Recaindo o vencimento em sábado, domingo ou feriado bancário, o pagamento pode ser feito no ` +
        `primeiro dia útil seguinte, sem qualquer encargo.`,
      `O valor acima é o valor aceito pelo ESTABELECIMENTO no ato da assinatura deste instrumento e é o ` +
        `valor devido durante a sua vigência. A alteração do valor de contrato vigente depende de termo ` +
        `aditivo com novo aceite do ESTABELECIMENTO, e nenhuma alteração de cadastro interno da TUGGI ` +
        `altera o valor aqui pactuado.`,
      `O valor será reajustado anualmente, no aniversário deste contrato, pela variação acumulada do ` +
        `índice ${ADJUSTMENT_INDEX_PLACEHOLDER} no período, ou pelo índice que legalmente o substituir.`,
      // Bruto ou líquido, e quem emite o documento fiscal: nada disso estava dito, e é a
      // primeira pergunta do contador do parceiro.
      'O valor acima é bruto e nele já estão compreendidos os tributos devidos pela TUGGI sobre a ' +
        'prestação. A TUGGI emite o documento fiscal correspondente a cada competência. Retenções ' +
        'exigidas por lei são de responsabilidade da fonte pagadora e não alteram o valor pactuado.',
    ],
  },
  curation: {
    id: 'curation',
    title: 'Da curadoria do conteúdo',
    ruleIds: ['BR-B2B-016', 'BR-B2B-025'],
    body: () => [
      'O ESTABELECIMENTO fornece o insumo; a TUGGI redige, produz e narra o texto que chega ao turista. ' +
        'A redação final, a extensão, o tom e a decisão de publicar são da TUGGI, e o ESTABELECIMENTO não ' +
        'tem direito de exigir a publicação de texto de sua própria autoria.',
      'A TUGGI pode recusar ou solicitar a substituição de insumo que não atenda à sua régua editorial, ' +
        'sem que isso configure descumprimento deste contrato por qualquer das partes.',
      // O contraponto que faltava. A curadoria dá à TUGGI a redação inteira e a cláusula da
      // veracidade diz que ela não apura o que o parceiro afirma — de modo que um erro da TUGGI
      // sobre o estabelecimento não tinha remédio nenhum no instrumento. Sem isto, é o tipo de
      // assimetria que o art. 424 do Código Civil alcança.
      `O ESTABELECIMENTO pode apontar à TUGGI, por escrito, erro factual sobre si na descrição ` +
        `publicada — nome, endereço, horário, produto ou fato que não corresponda à realidade — e a ` +
        `TUGGI obriga-se a corrigi-lo em até ${FACTUAL_CORRECTION_BUSINESS_DAYS} dias úteis contados do ` +
        `recebimento do apontamento. Esta obrigação alcança o erro, e não a linha editorial.`,
    ],
  },
  payment_default: {
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
      // A escada parava na suspensão: no 60º dia o contrato seguia vigente, com o ponto no ar e a
      // comissão correndo, e a TUGGI sem remédio nenhum além de esperar.
      `Persistindo a inadimplência por ${TERMINATION_FOR_DEFAULT_DAYS} dias corridos contados do ` +
        `vencimento, a TUGGI poderá rescindir este contrato mediante aviso, sem o prazo de ` +
        `antecedência previsto na cláusula "Da vigência e do início da cobrança" e sem prejuízo da ` +
        `cobrança do débito. A suspensão da descrição não interrompe a contraprestação, que ` +
        `permanece devida enquanto o contrato vigorar.`,
      // O ENCARGO SÓ APARECE NO FIM, e isso é decisão do operador em 2026-08-18: *"eu nao vou
      // entrar em estresse com parceiro por cause de 1 real de juros"*. O remédio real é a
      // suspensão, e cobrar centavos de mora todo mês custa mais do que arrecada.
      //
      // Juros de mora não precisavam de cláusula: com vencimento certo a mora é automática
      // (Código Civil, arts. 397 e 406). A multa convencional precisa (art. 408), e por isso ela
      // está aqui — escopada ao débito que sobrevive à rescisão, que é quando de fato se cobra.
      `Rescindido este contrato por inadimplência, o débito remanescente fica sujeito a multa de ` +
        `${LATE_FINE_PERCENT}% e aos juros legais de mora, contados do vencimento de cada parcela.`,
      // A defesa contra a supressio. Sem esta linha, deixar de cobrar por meses vira expectativa
      // legítima, e o dia em que a TUGGI cobrar o parceiro alega que nunca foi assim.
      'Enquanto o contrato vigorar, a TUGGI pode deixar de cobrar encargos de atraso sem que isso ' +
        'importe novação, renúncia ou alteração dos prazos deste contrato.',
    ],
  },
  governing_law: {
    id: 'governing_law',
    title: 'Do foro e da lei aplicável',
    ruleIds: [],
    body: () => [
      'Este contrato é regido pelas leis da República Federativa do Brasil.',
      // O foro é escolha do operador — o docblock deste arquivo já dizia que ele é "do advogado
      // E do operador", diferente do índice, que é só do advogado. Decidido em 2026-08-18: a
      // comarca da sede. Num contrato de adesão, a eleição que acompanha a sede de quem redige é
      // a defensável; comarca sem relação com ninguém é a que o juiz reputa abusiva de ofício
      // (CPC, art. 63, §3º).
      `Fica eleito o foro da comarca de ${JURISDICTION_CITY}, Estado de ${JURISDICTION_STATE}, sede ` +
        `da TUGGI, para dirimir as controvérsias decorrentes deste contrato, com renúncia a qualquer ` +
        `outro, por mais privilegiado que seja.`,
    ],
  },
  commission: {
    id: 'commission',
    title: 'Da participação na receita',
    ruleIds: ['BR-MONETIZACAO-039', 'BR-B2B-018'],
    body: (s) => [
      `O ESTABELECIMENTO faz jus a ${formatCommissionRate(s.commissionRate)} da receita líquida ` +
        `atribuída à origem identificada pelo QR Code que lhe for fornecido.`,
      'A participação na receita e a contraprestação mensal da faixa paga, quando houver, são fluxos ' +
        'independentes e não se compensam entre si.',
      // "Apurada na forma acordada entre as partes" apontava para um acordo que não existia em
      // lugar nenhum: sem periodicidade, sem prazo, sem demonstrativo.
      'A apuração é mensal, tem por base o mês civil anterior, e a TUGGI disponibiliza ao ' +
        'ESTABELECIMENTO o demonstrativo do período até o dia 10 do mês seguinte ao apurado. O ' +
        'valor apurado é pago até o último dia útil desse mesmo mês, por Pix ou transferência à ' +
        'conta indicada pelo ESTABELECIMENTO.',
      'O percentual acima é o percentual aceito pelo ESTABELECIMENTO no ato da assinatura deste ' +
        'instrumento e é o percentual devido durante a sua vigência. A sua alteração depende de ' +
        'termo aditivo com novo aceite do ESTABELECIMENTO, e nenhuma alteração de cadastro interno ' +
        'da TUGGI altera o percentual aqui pactuado.',
    ],
  },
}

/**
 * As duas cláusulas que o instrumento não tinha, e a posição de cada uma.
 *
 * `liability` entra depois de `penalties`, porque é a resposta à pergunta que as penalidades
 * levantam: até onde vai a conta quando algo dá errado. `notices` entra antes do foro, que é o
 * lugar clássico das disposições finais — e é a cláusula mais barata do contrato inteiro, porque
 * `mediante aviso à outra parte`, sem canal e sem endereço, é o ponto de disputa mais provável
 * de todos.
 *
 * MINUTA. Como o resto deste arquivo, a redação final é do advogado.
 */
const V2_ADDITIONS: { after: string; clause: ContractClause }[] = [
  {
    after: 'penalties',
    clause: {
      id: 'liability',
      title: 'Da responsabilidade, da disponibilidade e do caso fortuito',
      ruleIds: [],
      body: (s) => [
        'A TUGGI emprega esforços comerciais razoáveis para manter o aplicativo disponível, e não ' +
          'promete disponibilidade ininterrupta. Interrupções para manutenção, falha de terceiro de ' +
          'que a TUGGI dependa — inclusive lojas de aplicativo, provedores de hospedagem e redes de ' +
          'telecomunicação — e indisponibilidade do aparelho do turista não constituem ' +
          'descumprimento deste contrato.',
        s.tier === 'paid'
          ? `Interrupção contínua superior a ${OUTAGE_CREDIT_DAYS} dias corridos, imputável à TUGGI, ` +
            `que impeça a entrega da descrição da faixa paga dá ao ESTABELECIMENTO crédito ` +
            `proporcional aos dias de indisponibilidade, abatido da contraprestação seguinte.`
          : 'Na faixa gratuita não há contraprestação e, por consequência, não há crédito a apurar ' +
            'por indisponibilidade.',
        'Nenhuma das partes responde perante a outra por lucros cessantes, perda de oportunidade, ' +
          'perda de clientela ou dano indireto de qualquer natureza decorrente deste contrato.',
        s.tier === 'paid'
          ? `A responsabilidade da TUGGI por danos diretos decorrentes deste contrato fica limitada ` +
            `ao total das contraprestações mensais efetivamente pagas pelo ESTABELECIMENTO nos ` +
            `${LIABILITY_CAP_MONTHS} meses anteriores ao fato que lhe der causa.`
          : 'Na faixa gratuita, em que não há contraprestação, as partes respondem nos termos da lei, ' +
            'observada a exclusão de danos indiretos prevista acima.',
        'As limitações desta cláusula não alcançam o dolo, a culpa grave, a violação de direito de ' +
          'terceiro nem as obrigações decorrentes da Lei nº 13.709/2018, e não se aplicam onde a lei ' +
          'as vedar.',
        'Nenhuma parte responde pelo descumprimento decorrente de caso fortuito ou força maior, na ' +
          'forma do art. 393 do Código Civil, enquanto durar o evento e desde que a outra parte seja ' +
          'comunicada por escrito.',
      ],
    },
  },
  {
    after: 'data_protection',
    clause: {
      id: 'notices',
      title: 'Dos avisos entre as partes',
      ruleIds: ['BR-B2B-023'],
      body: (s) => [
        `Os avisos previstos neste contrato, inclusive o de rescisão, são feitos por escrito e por ` +
          `correio eletrônico: à TUGGI, no endereço que constar do documento fiscal ou do domínio ` +
          `tuggi.app; ao ESTABELECIMENTO, no endereço de e-mail do seu representante legal, ` +
          `${s.partner.representativeName}, informado no cadastro e para o qual este contrato foi ` +
          `enviado.`,
        'Cada parte obriga-se a manter o seu endereço de e-mail atualizado e a comunicar a alteração ' +
          'à outra. O aviso enviado ao último endereço informado reputa-se recebido no primeiro dia ' +
          'útil seguinte ao do envio, ainda que não respondido.',
        'Aviso verbal, mensagem por aplicativo de conversa e comunicação a preposto sem poderes não ' +
          'produzem os efeitos deste contrato, salvo confirmação por escrito na forma acima.',
      ],
    },
  },
]

/** Insere cada acréscimo logo depois da cláusula que ele responde. */
function withAdditions(
  clauses: readonly ContractClause[],
  additions: { after: string; clause: ContractClause }[]
): ContractClause[] {
  return clauses.flatMap((clause) => [
    clause,
    ...additions.filter((addition) => addition.after === clause.id).map((addition) => addition.clause),
  ])
}

const V2: ContractTemplate = {
  version: 'v2-2026-08',
  title: V1.title,
  publishedAt: '2026-08-18',
  // Ajustada no mesmo dia, com ZERO contratos gerados nela — o teste de "publicada" é ter saído
  // documento, não ter data. Inflar para v3 sem ninguém na v2 só criaria versão que nunca vai
  // aparecer em linha nenhuma. A v1, essa sim, está congelada e defendida por hash.
  clauses: withAdditions(
    V1.clauses.map((clause) => V2_REPLACEMENTS[clause.id] ?? clause),
    V2_ADDITIONS
  ),
}

const TEMPLATES: Record<string, ContractTemplate> = {
  [V1.version]: V1,
  [V2.version]: V2,
}

/** The version a NEW contract is generated with. Sent and signed contracts keep their own. */
export const ACTIVE_TEMPLATE_VERSION = V2.version

export function activeTemplate(): ContractTemplate {
  return V2
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
  /** Restringe o parceiro, e por isso a tela a destaca — ver `RESTRICTIVE_CLAUSE_IDS`. */
  restrictive: boolean
  paragraphs: readonly string[]
}

/**
 * The single source both surfaces render from: the HTML page and the PDF walk this same
 * array. Two presentations of one document — never two documents.
 */
/**
 * O marcador de revisão que a versão ativa ainda carrega, ou `null`.
 *
 * Lê o TEXTO RENDERIZADO e não uma lista de marcadores conhecidos: quem abrir um buraco novo
 * numa cláusula futura fica bloqueado sem precisar lembrar de vir aqui. Mora neste módulo porque
 * é ele que sabe o que é marcador — `snapshot.ts` só reporta o que recebe, e importar daqui para
 * lá fecharia um ciclo.
 */
export function pendingReviewPlaceholder(tier: ContractTier): string | null {
  const probe: ContractSnapshot = {
    templateVersion: ACTIVE_TEMPLATE_VERSION,
    tier,
    provider: { legalName: '—', taxId: '—', addressLine: '—', representativeName: '—', representativeRole: '—' },
    partner: {
      clientId: '—', legalName: '—', tradeName: null, taxId: '—',
      addressLine: '—', representativeName: '—', representativeRole: '—',
    },
    monthlyFeeCents: tier === 'paid' ? 1 : null,
    isCourtesy: false,
    courtesyReason: null,
    paymentMethod: 'pix',
    commissionRate: 0,
    qrDeliveryDays: 1,
    generatedAt: '1970-01-01T00:00:00.000Z',
  }
  const text = renderClauses(probe)
    .flatMap((clause) => clause.paragraphs)
    .join(' ')
  return REVIEW_PLACEHOLDER_PATTERN.exec(text)?.[0] ?? null
}

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
      /** Decidido aqui, e não pela tela: quem lê a lista lê junto o motivo dela existir. */
      restrictive: RESTRICTIVE_CLAUSE_IDS.indexOf(clause.id) >= 0,
      paragraphs: [...clause.body(snapshot)],
    }))
}
