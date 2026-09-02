import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_CHANGE'
  | 'UPDATE_PROFILE'
  | 'CREATE_POI'
  | 'UPDATE_POI'
  | 'DELETE_POI'
  // Hour-credit ledger (epic #283). `core.audit_logs.action` is free text — the only
  // CHECK on the table is on `status` — so a value added here reaches the row as written.
  | 'GRANT_TIME_CREDIT'
  // A period grant is two transactions: the access period committed and the ledger row did
  // not. The right exists with no grant row behind it, so this row is the only record of
  // who applied it — and of the fact that it must not be applied again.
  | 'GRANT_TIME_CREDIT_UNRECORDED'
  | 'REVOKE_TIME_CREDIT'
  // Partnership (#341). Promoting and discarding are irreversible acts of the team over a
  // live record, so each one leaves a row saying who, when and over which proposal.
  | 'PROMOTE_PARTNER_PROPOSAL'
  // Same class as `GRANT_TIME_CREDIT_UNRECORDED`: the first write committed and the second did
  // not. The promotion writes `partner.clients` first (BR-B2B-026 — the claim needs a destination
  // in the same statement), so a claim that fails leaves a client record carrying full personal
  // data with no promotion behind it. `partner.clients` has no authorship column, no audit trigger
  // and no unique `tax_id`, so this row is the ONLY thing tying that record to who created it
  // and to the proposal it came from.
  | 'PROMOTE_PARTNER_PROPOSAL_UNCLAIMED'
  | 'DISCARD_PARTNER_PROPOSAL'
  | 'RESTORE_PARTNER_PROPOSAL'
  // The conference annotation. It writes no `status` and reaches no client record, and it is
  // audited anyway: it is the write that decides whether a CONTRACT can be produced
  // (BR-B2B-022 through BR-B2B-030), it is an UPDATE that OVERWRITES the previous operator's
  // assertion, and `reviewed_by` on the row only ever names the last one. Without this row
  // the single write that opens the contract door is the one act on the screen with no
  // history — which is what the security review of 2026-08-16 found (M-2).
  | 'REVIEW_PARTNER_PROPOSAL'
  // The same annotation, against the CLIENT, and it exists for the reason the one above did
  // not cover: a client registered directly has no proposal, so the door the line above guards
  // had no key at all for 10 of the 12 clients that existed on 2026-08-21. Same overwrite, same
  // `reviewed_by` naming only the last operator, same need for the row that keeps the earlier
  // assertion. See `lib/services/client-conference-service.ts`.
  | 'REVIEW_CLIENT_CONFERENCE'
  // The place the approval creates (#360). It is a write into a catalogue of 2.2 million rows
  // made by a side-effect and not by the Places screen, so the row that says which approval
  // produced which POI is the only way back from one to the other.
  | 'CREATE_PARTNER_PLACE'
  // Pointing the client at a place the catalogue ALREADY carried (#409), which is the ordinary
  // act and not the exception: the three clients that used `CREATE_PARTNER_PLACE` each got an
  // empty second row beside an establishment that was already published. This row is what
  // distinguishes "the operator recognised the existing POI" from "a POI was born here", and
  // the two answer different questions when somebody asks why a partner has two addresses.
  | 'LINK_PARTNER_PLACE'
  // Soltar o local do parceiro (2026-08-26). É o par de `LINK_PARTNER_PLACE`, e existe pela
  // mesma razão que ele: `partner_client_id` é a única coluna por onde a esteira, a fila e o
  // faturamento enxergam de quem é o estabelecimento, e desfazê-la some com o local da tela do
  // cliente sem deixar rastro nenhum no registro — que continua no catálogo, intacto e no ar.
  // Sem esta linha, "por que este parceiro não tem mais local?" não tem resposta.
  | 'UNLINK_PARTNER_PLACE'
  // Which of the client's places greets the tourist on `/d/{slug}`. It is a separate action
  // from the link because it is a separate question: linking says whose place it is, this says
  // which one speaks first. Written by hand only when the client has more than one place —
  // linking the first adopts it — and never again by pasting a UUID into a text field.
  | 'SET_PARTNER_WELCOME_POI'
  // Apagar um local do catálogo (#409). A linha fica porque o registro não fica: `DELETE` em
  // `core.attractions` propaga para 17 tabelas, e o que sobra de que aquilo existiu é isto.
  // Só chega aqui um local sem visita, sem feedback, sem sessão, sem recusa de triagem e sem
  // parceiro vinculado — `lib/core/place-delete` recusa o resto.
  | 'DELETE_PLACE'
  // The 4 → 5 act of the pipeline (#359), and its reverse. Publishing is what starts the
  // monthly fee of the paid tier (BR-B2B-018, item 1), so "who put this place in front of
  // tourists, and when" is the only record of when money began — the fee itself is frozen on
  // the contract, and nothing on the client record moves when the place goes live.
  | 'PUBLISH_PARTNER_PLACE'
  | 'UNPUBLISH_PARTNER_PLACE'
  // The other outcome of the triage (#377), and the two acts are deliberately two rows.
  // `partner.partner_triage_refusals` is append-only and already carries who decided and when, so
  // these rows are not the record of the refusal — they are the record of the DECISION HAVING
  // BEEN TAKEN IN THE CMS, next to the publication it is the alternative to, on the one screen
  // that shows the whole trail. The communication is separate because it is a separate act:
  // BR-B2B-010, item 4, stops the 72h clock at the communication and not at the decision.
  | 'REFUSE_PARTNER_PLACE_AT_TRIAGE'
  | 'COMMUNICATE_PARTNER_PLACE_TRIAGE_REFUSAL'
  // Furar a régua da faixa gratuita (2026-08-26). BR-B2B-016, item 1, diz que o local de um
  // parceiro gratuito é só o nome; o operador pode abrir exceção caso a caso, e pediu, na mesma
  // frase, que a decisão ficasse gravada. As colunas em `core.attractions` guardam a exceção EM
  // VIGOR — quem furou, quando e por quê —, mas elas são um UPDATE: fechar e reabrir apaga a
  // anterior. Estas duas linhas são o histórico, que é o que responde "quantas vezes este local
  // já entrou e saiu da regra, e com que motivo cada vez".
  | 'PARTNER_DESCRIPTION_EXCEPTION_OPENED'
  | 'PARTNER_DESCRIPTION_EXCEPTION_CLOSED'

/**
 * `CLIENT` is the record the promotion writes; `PARTNER_PROPOSAL` is the thing outside the
 * client that the act happened to. Two entities and not one,
 * because "who changed this client" and "what happened to this proposal" are two questions
 * the audit page is asked separately.
 */  // Financeiro (#módulo finance). Todo lançamento de dinheiro é auditado porque nenhuma das
  // tabelas de `finance` tem coluna de autoria própria além de `created_by`, e porque um preço
  // de compra reescreve o custo de todo parceiro que consumir depois dele: quem cadastrou e
  // quando é a única forma de reconstituir por que um total mudou de um dia para o outro.
  // As tabelas de lançamento não aceitam `delete` no grant, então não existe ação de exclusão.
  | 'CREATE_FINANCE_PURCHASE'
  | 'CREATE_FINANCE_FIXED_COST'
  | 'CREATE_FINANCE_CLIENT_COST'
  | 'CREATE_FINANCE_SHIPMENT'
  // A compra é o único registro de `finance` que se edita e se apaga, porque é o registro de uma
  // NOTA e não um custo apurado — ver `20260901_04_finance_purchase_edit.sql`. Por isso os dois
  // atos são auditados: eles mudam o custo por peça de tudo que for derivado daqui em diante.
  | 'UPDATE_FINANCE_PURCHASE'
  | 'DELETE_FINANCE_PURCHASE'
  // Apagar uma regra de receita ou embalagem, e recalcular o custo de um pedido. Os dois mudam
  // dinheiro já apurado ou o que será apurado, e nenhum tem oposto — por isso deixam rastro.
  | 'DELETE_FINANCE_RULE'
  | 'RECOMPUTE_FINANCE_CONSUMPTION'
  | 'UPDATE_FINANCE_CATALOG'
  // O preco declarado do passe e as contas de teste. Os dois mudam numero financeiro sem tocar
  // em lancamento nenhum: o primeiro e a unica fonte de receita do app que o CMS enxerga
  // (BR-MONETIZACAO-048), e o segundo tira uma conta inteira de toda soma da Visao geral.
  // `RESTORE` existe porque desfazer e escrever `removed_at`, nunca apagar a linha — e uma conta
  // que volta a contar muda o total tanto quanto uma que saiu.
  | 'CREATE_FINANCE_PASS_PRICE'
  | 'CREATE_FINANCE_EXCLUSION'
  | 'RESTORE_FINANCE_EXCLUSION'

export type AuditEntity = 'USER' | 'POI' | 'AUTH' | 'CLIENT' | 'PARTNER_PROPOSAL' | 'FINANCE'

interface AuditLogInput {
  request: NextRequest
  action: AuditAction
  entity: AuditEntity
  description: string
  userId?: string | null
  userEmail?: string | null
  entityId?: string | null
}

const SENSITIVE_PATTERNS = [/password/i, /token/i, /secret/i]

function sanitizeDescription(description: string): string {
  if (!description) return ''
  const hasSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(description))
  return hasSensitive ? 'Sensitive details omitted' : description
}

export function getRequestIp(request: NextRequest): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  return 'unknown'
}

export function getUserAgent(request: NextRequest): string | null {
  return request.headers.get('user-agent') || null
}

/**
 * Centralized audit logger.
 * Errors are swallowed to avoid breaking the main flow.
 */
export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  try {
    const supabase = getSupabase('service')
    await supabase
      .schema('core')
      .from('audit_logs')
      .insert({
        user_id: input.userId ?? null,
        user_email: input.userEmail ?? null,
        action: input.action,
        entity: input.entity,
        entity_id: input.entityId ?? null,
        description: sanitizeDescription(input.description),
        ip_address: getRequestIp(input.request),
        user_agent: getUserAgent(input.request),
        request_ip: getRequestIp(input.request),
        resource_type: input.entity,
        resource_id: input.entityId ?? null
      })
  } catch (error) {
    console.error('Audit log insert failed:', error)
  }
}
