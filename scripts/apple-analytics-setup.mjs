#!/usr/bin/env node
// scripts/apple-analytics-setup.mjs (#1062)
//
// One-off setup of the Apple downloads collector (`supabase/functions/_shared/apple-downloads.ts`), run by the
// operator on his own machine. It never runs on a server.
//
//   node scripts/apple-analytics-setup.mjs --issuer <ISSUER_ID> \
//     --admin-key-id <ID> --admin-p8 <path> --sales-key-id <ID> --sales-p8 <path> [--set-secrets]
//
// 1. Admin key: reuse the app's live ONGOING analytics report request, or create one.
// 2. Sales key: check it lists the requests and reads the request's reports.
// 3. With --set-secrets and step 2 good: store the Sales key in the Edge Function secrets.
// 4. Remind the operator to revoke the Admin key.
//
// RULE (security-reviewer, #1062): the Admin key NEVER goes to the secrets. A leaked Admin key controls the whole
// App Store Connect account (users, pricing, availability, builds), and an Edge Function secret is readable by
// every function of the project. Only the Sales and Reports key is stored, and the script refuses to run when the
// two keys are the same.
//
// Nothing here prints a key, a key file or a JWT. Apple errors show only the HTTP status and `errors[].code`.
//
// Checked 2026-10-29 against the official documentation:
// - Downloading Analytics Reports (roles: only Admin may POST/DELETE a request; Admin, Sales and Reports and
//   Finance list and download reports; a request left unread turns `stoppedDueToInactivity`):
//   https://developer.apple.com/documentation/appstoreconnectapi/downloading-analytics-reports
// - POST /v1/analyticsReportRequests (body `AnalyticsReportRequestCreateRequest`):
//   https://developer.apple.com/documentation/appstoreconnectapi/post-v1-analyticsreportrequests
// - GET /v1/apps/{id}/analyticsReportRequests (`filter[accessType]` accepts ONGOING):
//   https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-analyticsreportrequests
// - Creating API Keys for App Store Connect API (team keys carry a role):
//   https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
// - Generating Tokens for API Requests (ES256, kid, iss, aud appstoreconnect-v1, at most 20 minutes):
//   https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export const SUPABASE_PROJECT_REF = 'tysnkzmljlmmqpbotkxv';
const REQUEST_ID_SECRET = 'APPLE_ASC_REQUEST_ID';

// Test-only seams: a fake App Store Connect and a fake `supabase` binary. The operator never sets these.
const BASE_URL_OVERRIDE = process.env.APPLE_SETUP_TEST_BASE_URL;
const SUPABASE_BIN = process.env.APPLE_SETUP_TEST_SUPABASE_BIN || 'supabase';

// The JWT signature is the collector's (`ascToken`), not a second copy. Node strips the types of a `.ts` import
// since 22.18; the "module type not specified" warning that import raises is noise for the operator.
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const code = typeof rest[0] === 'object' ? rest[0]?.code : rest[1];
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  return originalEmitWarning.call(process, warning, ...rest);
};
let collector;
try {
  collector = await import(new URL('../supabase/functions/_shared/apple-downloads.ts', import.meta.url));
} catch {
  console.error('Não consegui carregar apple-downloads.ts. Este script precisa do Node 22.18 ou mais novo.');
  process.exit(1);
}
process.emitWarning = originalEmitWarning;
const { APPLE_APP_ID, APPLE_ENV, ASC_HOST, ascToken } = collector;
const HOST = BASE_URL_OVERRIDE || ASC_HOST;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArgs() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        issuer: { type: 'string' },
        'admin-key-id': { type: 'string' },
        'admin-p8': { type: 'string' },
        'sales-key-id': { type: 'string' },
        'sales-p8': { type: 'string' },
        'set-secrets': { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (e) {
    fail(`Argumento inválido: ${e.message}`);
  }
  const missing = ['issuer', 'admin-key-id', 'admin-p8', 'sales-key-id', 'sales-p8'].filter((k) => !values[k]?.trim());
  if (missing.length) fail(`Faltou: ${missing.map((k) => `--${k}`).join(', ')}`);
  return values;
}

/** Reads a `.p8` without ever echoing it: a bad file is reported by path only. */
function readKey(path, label) {
  let pem;
  try {
    pem = readFileSync(path, 'utf8').trim();
  } catch {
    fail(`Não consegui ler o arquivo da chave ${label}: ${path}`);
  }
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) fail(`O arquivo da chave ${label} não parece um .p8: ${path}`);
  return pem;
}

/** Apple error as `HTTP 403 (FORBIDDEN_ERROR)`: the status and the codes, never the detail text or the URL. */
function describe(res) {
  if (res.status === 0) return 'sem resposta da Apple (rede)';
  const codes = Array.isArray(res.body?.errors)
    ? res.body.errors.map((e) => e?.code).filter((c) => typeof c === 'string')
    : [];
  return codes.length ? `HTTP ${res.status} (${codes.join(', ')})` : `HTTP ${res.status}`;
}

async function call(token, path, init = {}) {
  try {
    const res = await fetch(`${HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function tokenFor(issuerId, keyId, privateKey, label) {
  try {
    return await ascToken({ issuerId, keyId, privateKey }, Math.floor(Date.now() / 1000));
  } catch {
    fail(`A chave ${label} não é uma chave P-256 válida.`);
  }
}

const listPath = `/v1/apps/${APPLE_APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`;

/** Step 1, Admin key: the live ONGOING request of the app, created when none is live. */
async function ensureRequest(adminToken) {
  const listed = await call(adminToken, listPath);
  if (!listed.ok) fail(`1. Pedido ONGOING: a Apple recusou a listagem com a chave Admin, ${describe(listed)}.`);
  const live = (Array.isArray(listed.body?.data) ? listed.body.data : []).find(
    (r) => typeof r?.id === 'string' && r.attributes?.stoppedDueToInactivity !== true,
  );
  if (live) {
    console.log(`1. Pedido ONGOING já existia e foi reaproveitado: ${live.id}`);
    return live.id;
  }
  const created = await call(adminToken, '/v1/analyticsReportRequests', {
    method: 'POST',
    body: {
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: APPLE_APP_ID } } },
      },
    },
  });
  const id = created.body?.data?.id;
  if (!created.ok || typeof id !== 'string') {
    fail(`1. Pedido ONGOING: a Apple recusou a criação com a chave Admin, ${describe(created)}.`);
  }
  console.log(`1. Pedido ONGOING criado: ${id} (a Apple leva de 1 a 2 dias para gerar o primeiro relatório)`);
  return id;
}

/** Step 2, Sales key: can it do what the collector does? Returns true when it reads the reports. */
async function checkSales(salesToken, requestId) {
  const listed = await call(salesToken, listPath);
  const reports = await call(salesToken, `/v1/analyticsReportRequests/${requestId}/reports`);
  if (listed.ok && reports.ok) {
    console.log('2. Sales lê: sim');
    return true;
  }
  const failed = listed.ok ? reports : listed;
  console.log(`2. Sales lê: não (${describe(failed)})`);
  if (!listed.ok && listed.status === 403 && reports.ok) {
    console.log(
      [
        '   A chave Sales lê os relatórios, mas não a lista de pedidos. O coletor hoje começa pela lista, então',
        `   ele vai precisar ler o id do pedido do segredo ${REQUEST_ID_SECRET} (mudança de código, card do dev).`,
        '   Quando essa mudança estiver no ar, cadastre o segredo com:',
        `   supabase secrets set ${REQUEST_ID_SECRET}=${requestId} --project-ref ${SUPABASE_PROJECT_REF}`,
      ].join('\n'),
    );
  } else if (!reports.ok) {
    console.log('   Confira se a chave Sales foi criada com o papel "Sales and Reports".');
  }
  return false;
}

function runSupabase(args) {
  return new Promise((resolve) => {
    const child = spawn(SUPABASE_BIN, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

/**
 * Step 3: only the SALES key goes to the secrets (the Admin key never does). The PEM travels in a 600 file inside a
 * 700 temp folder, removed at the end even on Ctrl-C, never on a command line. The CLI's output is not relayed.
 */
async function setSalesSecrets(issuerId, salesKeyId, salesPem) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-asc-'));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const file = join(dir, 'secrets.env');
    const escapedPem = salesPem.replace(/\r?\n/g, '\\n');
    writeFileSync(
      file,
      `${APPLE_ENV.keyId}=${salesKeyId}\n${APPLE_ENV.issuerId}=${issuerId}\n${APPLE_ENV.privateKey}="${escapedPem}"\n`,
      { mode: 0o600 },
    );
    const code = await runSupabase(['secrets', 'set', '--env-file', file, '--project-ref', SUPABASE_PROJECT_REF]);
    if (code !== 0) {
      console.log(
        `3. Segredos: o supabase secrets set falhou (saída ${code}). Confira o supabase login e rode de novo com --set-secrets.`,
      );
      return false;
    }
    console.log(
      `3. Segredos: chave Sales ${salesKeyId} cadastrada no projeto ${SUPABASE_PROJECT_REF} ` +
        `(${APPLE_ENV.keyId}, ${APPLE_ENV.issuerId}, ${APPLE_ENV.privateKey})`,
    );
    return true;
  } finally {
    cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

async function main() {
  const args = readArgs();
  const issuerId = args.issuer.trim();
  const adminKeyId = args['admin-key-id'].trim();
  const salesKeyId = args['sales-key-id'].trim();
  const adminPem = readKey(args['admin-p8'], 'Admin');
  const salesPem = readKey(args['sales-p8'], 'Sales');
  if (adminKeyId === salesKeyId || adminPem === salesPem) {
    fail('A chave Admin e a chave Sales são a mesma. A Admin nunca vai para os segredos: use a chave Sales and Reports.');
  }

  const adminToken = await tokenFor(issuerId, adminKeyId, adminPem, 'Admin');
  const requestId = await ensureRequest(adminToken);

  const salesToken = await tokenFor(issuerId, salesKeyId, salesPem, 'Sales');
  const salesReads = await checkSales(salesToken, requestId);

  let ok = salesReads;
  if (!args['set-secrets']) {
    console.log('3. Segredos: não cadastrados (rode de novo com --set-secrets para cadastrar a chave Sales)');
  } else if (!salesReads) {
    console.log('3. Segredos: não cadastrados, porque a chave Sales não passou no passo 2');
  } else {
    ok = await setSalesSecrets(issuerId, salesKeyId, salesPem);
  }

  console.log(`4. Agora revogue a chave Admin ${adminKeyId} no App Store Connect (Usuários e Acesso, Integrações).`);
  process.exitCode = ok ? 0 : 1;
}

await main();
