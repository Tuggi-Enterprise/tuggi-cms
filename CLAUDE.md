# tuggi-cms: CMS interno da curadoria (Next.js) e a maioria das Edge Functions

Vale junto com o `CLAUDE.md` do workspace. Aqui fica só o que é deste repo.

## Teste do card

- API e lib: `npx tsx --import ./tests/api/setup/console-to-stderr.mjs --experimental-test-module-mocks --test
  tests/api/<arquivo>.test.ts`. A suíte inteira (`npm run -s test:api`) leva minutos; rode só o que o card toca.
- Edge Functions: na pasta `supabase/functions/`, `~/.deno/bin/deno test --allow-all --no-check _tests/<arquivo>`.
- O `pre-commit` roda `npm run check-all` (tsc e eslint). Rota nova em `app/api/`: `npm run check:routes`, que exige
  `withAuth(...)` ou `withPublicRoute(...)` de `lib/auth-middleware` em todo método exportado.
- Teste e commit/push vão em chamadas separadas. O hook `block-teste-e-push-juntos.sh` barra os dois juntos.

## Publicar

- O CMS publica pela Vercel quando o commit entra na main. Não existe workflow de deploy, e run do GitHub não é prova.
  Prova é a lista de deploys da Vercel ou o `curl` da página no ar.
- Edge Function: o deploy é comando para o operador colar, `npx supabase functions deploy <nome>` (nunca o
  `supabase` global). Agente não publica nem lê produção.

## Armadilhas

- Edge Function nova nasce aqui, inclusive a que o app chama com o JWT do usuário. Reuse `supabase/functions/_shared`;
  copiar de lá para outro repo é segunda implementação.
- `app/`, `lib/`, `components/` e `supabase/functions/` podem andar em paralelo. Nesse caso cada um comita só os seus
  arquivos e nenhum empurra; o Tech Lead empurra depois da revisão.
- Texto do CMS mora em `messages/<idioma>.json` (pt, en, es).
