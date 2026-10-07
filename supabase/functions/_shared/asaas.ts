// _shared/asaas.ts — the one Asaas API client of the Edge Functions (#811).
//
// Doc (conferred 2026-10-04): https://docs.asaas.com
//   - auth: header `access_token` (not `Authorization: Bearer`) and a `User-Agent` naming the app
//     (mandatory for root accounts created after 2024-06-13);
//   - sandbox `https://api-sandbox.asaas.com/v3`, production `https://api.asaas.com/v3`;
//   - errors: `{ errors: [{ code, description }] }`;
//   - minimum timeout 60 s on card operations, so a slow answer does not become a second charge.
//
// Pure and import-free on purpose: `fetch` is injected, so the CMS tests (Node, `tsx`) run every
// flow against a mocked Asaas. The function `index.ts` files pass the real `fetch`.
//
// NEVER LOG A BODY. A customer carries name, CPF/CNPJ and e-mail; a subscription request carries
// the card. What leaves this module in an error is the HTTP status and the Asaas error codes.

export type AsaasFetch = (url: string, init: RequestInit) => Promise<Response>;

export type AsaasConfig = {
  baseUrl: string;
  apiKey: string;
  fetch: AsaasFetch;
  timeoutMs?: number;
};

export const ASAAS_USER_AGENT = 'Tuggi-Places/1.0';
export const ASAAS_TIMEOUT_MS = 60_000;

/** A non-2xx answer from Asaas. `status` 0 = network failure or timeout (nothing is known). */
export class AsaasError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string[],
  ) {
    super(`asaas ${status}${codes.length ? ` ${codes.join(',')}` : ''}`);
  }
  /** Transport or Asaas-side failure: retrying later can succeed. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  customer?: string | null;
  subscription?: string | null;
  externalReference?: string | null;
  billingType?: string;
  dueDate?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  deleted?: boolean;
  refunds?: { status?: string | null; value?: number | null }[] | null;
};

export type AsaasSubscription = {
  id: string;
  status: string;
  value: number;
  nextDueDate?: string | null;
  endDate?: string | null;
  cycle?: string;
  billingType?: string;
  externalReference?: string | null;
  deleted?: boolean;
};

export type AsaasCreditCard = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};

export type AsaasCardHolder = {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
};

/**
 * Pix Automático authorization — read and cancelled only: no checkout creates one since #898; plans
 * that paid by journey 3 before it still renew on it (doc conferred 2026-10-05:
 * https://docs.asaas.com/reference/criar-uma-autorizacao-pix-automatico). With
 * `paymentCreationMode: SUBSCRIPTION` Asaas creates the subscription only when the payer's bank
 * ACTIVATES the authorization, so `subscriptionId` is null until then. The copy-and-paste code and
 * the image of the immediate QR (journey 3) are read from the top level or from `immediateQrCode`:
 * the doc shows both shapes.
 */
export type AsaasPixAuthorization = {
  id: string;
  status: string;
  customerId?: string | null;
  contractId?: string | null;
  subscriptionId?: string | null;
  frequency?: string | null;
  payload?: string | null;
  encodedImage?: string | null;
  immediateQrCode?: {
    payload?: string | null;
    encodedImage?: string | null;
    expirationDate?: string | null;
    conciliationIdentifier?: string | null;
  } | null;
};

/**
 * NFS-e of a payment (#901). Doc conferred 2026-10-07: https://docs.asaas.com/reference/recuperar-uma-nota-fiscal.
 * `number`, `pdfUrl` and `xmlUrl` are normally filled only after AUTHORIZED. The body also carries
 * the taker's CPF/CNPJ, name and e-mail through `customer`: never log it.
 */
export type AsaasInvoice = {
  id: string;
  status: string;
  customer?: string | null;
  payment?: string | null;
  externalReference?: string | null;
  value?: number | null;
  effectiveDate?: string | null;
  number?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  statusDescription?: string | null;
};

/** Taxes of an invoice. Asaas reads the object as the whole desired state: omitted = null. */
export type AsaasInvoiceTaxes = { retainIss: boolean; iss: number; pis: number; cofins: number; csll: number; inss: number; ir: number };

/** `POST /v3/subscriptions/{id}/invoiceSettings` (https://docs.asaas.com/reference/criar-configuracao-para-emissao-de-notas-fiscais). */
export type AsaasSubscriptionInvoiceSettings = {
  municipalServiceCode: string;
  municipalServiceName: string;
  effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION';
  observations: string;
  taxes: AsaasInvoiceTaxes;
};

/** `POST /v3/invoices` (https://docs.asaas.com/reference/agendar-nota-fiscal): every field below is required there. */
export type AsaasScheduleInvoice = {
  payment: string;
  serviceDescription: string;
  observations: string;
  externalReference: string;
  value: number;
  deductions: number;
  effectiveDate: string;
  municipalServiceCode: string;
  municipalServiceName: string;
  taxes: AsaasInvoiceTaxes;
};

type List<T> = { data?: T[] | null; hasMore?: boolean | null };

/** `GET /v3/transfers` publishes `limit` max 10. */
export const TRANSFER_PAGE = 10;

/**
 * `POST /v3/transfers` and `GET /v3/transfers/{id}` (#903, doc conferred 2026-10-07:
 * https://docs.asaas.com/reference/transferir-para-conta-de-outra-instituicao-ou-chave-pix).
 * `status`: PENDING, BANK_PROCESSING, DONE, CANCELLED, FAILED. `authorized` is false while the
 * account's critical-action token (SMS/APP) waits for the operator: the transfer stays PENDING.
 */
export type AsaasTransfer = {
  id: string;
  status: string;
  value?: number;
  authorized?: boolean | null;
  failReason?: string | null;
  externalReference?: string | null;
};

export function asaasClient(cfg: AsaasConfig) {
  const base = cfg.baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await cfg.fetch(`${base}${path}`, {
        method,
        headers: {
          access_token: cfg.apiKey,
          'User-Agent': ASAAS_USER_AGENT,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? ASAAS_TIMEOUT_MS),
      });
    } catch {
      throw new AsaasError(0, []);
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const errors = Array.isArray(data?.errors) ? (data!.errors as { code?: unknown }[]) : [];
      throw new AsaasError(
        res.status,
        errors.map((e) => (typeof e?.code === 'string' ? e.code : '')).filter(Boolean),
      );
    }
    return data as T;
  }

  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

  return {
    findCustomerByReference: async (externalReference: string) =>
      (await call<List<{ id: string }>>('GET', `/customers?${q({ externalReference })}`)).data?.[0] ?? null,

    createCustomer: (c: { name: string; cpfCnpj: string; email: string; externalReference: string }) =>
      // Asaas e-mails (invoice, reminders) off: the Tuggi tells the place, in the Tuggi voice.
      call<{ id: string }>('POST', '/customers', { ...c, notificationDisabled: true }),

    getCustomer: (id: string) =>
      call<{ id: string; externalReference?: string | null; email?: string | null }>('GET', `/customers/${encodeURIComponent(id)}`),

    listSubscriptionsByReference: async (externalReference: string) =>
      (await call<List<AsaasSubscription>>('GET', `/subscriptions?${q({ externalReference })}`)).data ?? [],

    getSubscription: (id: string) => call<AsaasSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`),

    createCardSubscription: (s: {
      customer: string;
      value: number;
      nextDueDate: string;
      cycle: string;
      description: string;
      externalReference: string;
      creditCard: AsaasCreditCard;
      creditCardHolderInfo: AsaasCardHolder;
      remoteIp: string;
    }) => call<AsaasSubscription>('POST', '/subscriptions', { ...s, billingType: 'CREDIT_CARD' }),

    /**
     * Subscription paid by Pix (`billingType: PIX`, https://docs.asaas.com/reference/criar-nova-assinatura):
     * every fee is an ordinary Pix charge the payer pays by hand — no debit, no authorization. Asaas
     * generates each one ahead of its `dueDate` (40 days by default, docs.asaas.com "Assinaturas").
     */
    createPixSubscription: (s: {
      customer: string;
      value: number;
      nextDueDate: string;
      cycle: string;
      description: string;
      externalReference: string;
    }) => call<AsaasSubscription>('POST', '/subscriptions', { ...s, billingType: 'PIX' }),

    /** `PUT /v3/customers/{id}` (https://docs.asaas.com/reference/atualizar-cliente-existente). */
    setCustomerNotifications: (id: string, enabled: boolean) =>
      call<{ id: string }>('PUT', `/customers/${encodeURIComponent(id)}`, { notificationDisabled: !enabled }),

    /** `PUT /v3/subscriptions/{id}`. `nextDueDate` does not move charges already generated. */
    updateSubscription: (id: string, patch: { value?: number; nextDueDate?: string; endDate?: string; updatePendingPayments?: boolean }) =>
      call<AsaasSubscription>('PUT', `/subscriptions/${encodeURIComponent(id)}`, patch),

    /** 404 = already gone, which is what the caller wanted: true either way. */
    deleteSubscription: async (id: string): Promise<true> => {
      try {
        await call('DELETE', `/subscriptions/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404)) throw e;
      }
      return true;
    },

    listSubscriptionPayments: async (subscription: string, status?: string) =>
      (
        await call<List<AsaasPayment>>(
          'GET',
          `/payments?${q({ subscription, ...(status ? { status } : {}) })}`,
        )
      ).data ?? [],

    getPixAutomaticAuthorization: (id: string) =>
      call<AsaasPixAuthorization>('GET', `/pix/automatic/authorizations/${encodeURIComponent(id)}`),

    /** 404 = gone, 400 = no longer cancellable (already ended): both are what the caller wanted. */
    cancelPixAutomaticAuthorization: async (id: string): Promise<true> => {
      try {
        await call('DELETE', `/pix/automatic/authorizations/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof AsaasError && (e.status === 404 || e.status === 400))) throw e;
      }
      return true;
    },

    /**
     * A one-off Pix charge (`POST /v3/payments`, `billingType: PIX`), outside any subscription: the
     * early-termination fee of a Pix Automático plan, whose authorized `value` cannot change.
     * `invoiceUrl` is the page where the payer gets the QR (the customer has Asaas e-mails off).
     */
    createPixPayment: (c: { customer: string; value: number; dueDate: string; description: string }) =>
      call<AsaasPayment & { invoiceUrl?: string | null }>('POST', '/payments', { ...c, billingType: 'PIX' }),

    getPayment: (id: string) => call<AsaasPayment>('GET', `/payments/${encodeURIComponent(id)}`),

    deletePayment: (id: string) => call('DELETE', `/payments/${encodeURIComponent(id)}`),

    /** `GET /v3/subscriptions/{id}/invoiceSettings`; 404 = none configured (or no such subscription). */
    getSubscriptionInvoiceSettings: async (id: string) => {
      try {
        return await call<Record<string, unknown>>('GET', `/subscriptions/${encodeURIComponent(id)}/invoiceSettings`);
      } catch (e) {
        if (e instanceof AsaasError && e.status === 404) return null;
        throw e;
      }
    },

    createSubscriptionInvoiceSettings: (id: string, settings: AsaasSubscriptionInvoiceSettings) =>
      call<Record<string, unknown>>('POST', `/subscriptions/${encodeURIComponent(id)}/invoiceSettings`, settings),

    scheduleInvoice: (inv: AsaasScheduleInvoice) => call<AsaasInvoice>('POST', '/invoices', inv),

    getInvoice: (id: string) => call<AsaasInvoice>('GET', `/invoices/${encodeURIComponent(id)}`),

    /** `GET /v3/invoices` (https://docs.asaas.com/reference/listar-notas-fiscais), every page (limit 100). */
    listInvoices: async (filter: { payment?: string; customer?: string; effectiveDateFrom?: string }) => {
      const params: Record<string, string> = { limit: '100' };
      if (filter.payment) params.payment = filter.payment;
      if (filter.customer) params.customer = filter.customer;
      if (filter.effectiveDateFrom) params['effectiveDate[ge]'] = filter.effectiveDateFrom;
      const all: AsaasInvoice[] = [];
      for (let offset = 0; offset < 10_000; offset += 100) {
        const page = await call<List<AsaasInvoice>>('GET', `/invoices?${q({ ...params, offset: String(offset) })}`);
        all.push(...(page.data ?? []));
        if (!page.hasMore) break;
      }
      return all;
    },

    /**
     * `POST /v3/invoices/{id}/cancel` (https://docs.asaas.com/reference/cancelar-uma-nota-fiscal). At the
     * city hall too (`cancelOnlyOnAsaas: false`): where the city must approve, the invoice goes to
     * PROCESSING_CANCELLATION and ends CANCELED or CANCELLATION_DENIED.
     */
    cancelInvoice: (id: string) => call<AsaasInvoice>('POST', `/invoices/${encodeURIComponent(id)}/cancel`, { cancelOnlyOnAsaas: false }),

    /**
     * `POST /v3/transfers` by Pix key (#903). NO IDEMPOTENCY at Asaas and a sent Pix does not come
     * back: the caller calls this only after `partner.release_place_payout` returned `applied`, and
     * never twice for the same release. `externalReference` = the payout uuid, the operator's way
     * back to the transfer when the database lost it.
     */
    createPixTransfer: (t: { valueCents: number; pixKey: string; description: string; externalReference: string }) =>
      call<AsaasTransfer>('POST', '/transfers', {
        value: Math.round(t.valueCents) / 100,
        operationType: 'PIX',
        pixAddressKey: t.pixKey,
        pixAddressKeyType: 'CNPJ',
        description: t.description,
        externalReference: t.externalReference,
      }),

    getTransfer: (id: string) => call<AsaasTransfer>('GET', `/transfers/${encodeURIComponent(id)}`),

    /**
     * `GET /v3/transfers`, one PIX page created since `since` (`YYYY-MM-DD`). Doc conferred
     * 2026-10-07 (https://docs.asaas.com/reference/listar-transferencias): the filters are
     * `dateCreated[ge|le]`, `transferDate[ge|le]` and `type`; there is NO `externalReference`
     * filter, so the caller matches it in the page; `limit` is at most 10.
     */
    listPixTransfersSince: async (since: string, offset: number) =>
      await call<List<AsaasTransfer>>(
        'GET',
        `/transfers?${q({ 'dateCreated[ge]': since, type: 'PIX', offset: String(offset), limit: String(TRANSFER_PAGE) })}`,
      ),

    /** `POST /v3/payments/{id}/refund`. Asynchronous: the refund is born PENDING. */
    refundPayment: (id: string, value: number, description: string) =>
      call<AsaasPayment>('POST', `/payments/${encodeURIComponent(id)}/refund`, { value, description }),
  };
}

export type AsaasClient = ReturnType<typeof asaasClient>;
