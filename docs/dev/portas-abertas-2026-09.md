# As portas que estavam abertas no banco — o que fechou, o que sobrou, e o que o operador executa

Escrito em 2026-09-10, durante a correção do módulo de Marketing. Está aqui, e não no card,
porque duas coisas sobrevivem ao card: um `DROP` pendente que só o humano executa (§3), e a
consulta que encontra a próxima porta dessa família.

## O padrão, porque ele vai se repetir

Três buracos independentes foram achados no mesmo dia, todos com a mesma forma:

> função `SECURITY DEFINER`, sem autorização no corpo, com `GRANT EXECUTE ... TO authenticated`,
> num schema que tem `USAGE` para `authenticated` e está exposto no PostgREST.

Qualquer um dos 522 perfis do app — ou dos 39 `cms_users` com papel `client` — chega nela com um
`POST /rest/v1/rpc/<nome>`. Não é preciso ser admin, e a chave publicável que o app carrega
basta para autenticar.

O default da plataforma empurra para isso: função nova nasce com `EXECUTE` para `PUBLIC`, e o
`ALTER DEFAULT PRIVILEGES` que o projeto usa concede a `authenticated`. **Quem escreve a função
precisa revogar de propósito**; esquecer é o caminho de menor esforço.

### A consulta que acha a próxima

```sql
select n.nspname||'.'||p.proname, pg_get_function_identity_arguments(p.oid),
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       case when p.prosrc ~ 'net\.http_post|[^a-z_]http\s*\(\(' then 'CHAMA HTTP' else '' end,
       case when p.prosrc ~* 'delete\s+from|truncate' then 'APAGA' else '' end,
       case when p.prosrc ~ 'decrypted_secrets' then 'USA VAULT' else '' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname in ('core','marketing','partner','drive')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and p.prorettype <> 'trigger'::regtype
  and (p.prosrc ~ 'net\.http_post|[^a-z_]http\s*\(\('
       or p.prosrc ~* 'delete\s+from|truncate')
  and p.prosrc !~* 'assert_platform_admin|is_caller_platform_admin|auth\.uid\(\)';
```

Duas armadilhas que essa consulta já custou:

- **`net.http_post` não é a única forma de chamar para fora.** Os dois orquestradores de FOMO
  usam `http(( ... ))` da extensão `http`, e um filtro por `net.http_post` os declara inofensivos.
- **Ler o corpo truncado engana.** Vários `cleanup_*` parecem apagar tudo e têm `WHERE` que os
  limita a linha expirada ou já inativa. Leia o `WHERE` antes de classificar a severidade — §4:
  achado correto não basta, precisa doer.

## O que foi fechado

| Migration | Função | O que ela entregava |
| :-- | :-- | :-- |
| `07` | `core.cleanup_old_notification_logs(int)` | `days_old: 0` apagava as 587 linhas de histórico de push |
| `07` | `core.delete_notification_template`, `marketing.delete_newsletter_template` | DELETE por id, sem portão |
| `08` | `core.dispatch_partner_user_notification` | e-mail com nosso DKIM e texto livre, para um `user_id` arbitrário, mais push |
| `09` | `core.trigger_daily_fomo_orchestrator`, `drive.trigger_fomo_orchestrator` | disparar o push diário para a base inteira, à vontade |
| `09` | `core.automated_audio_cleanup` | ⚠ estava aberta a **`anon`**; gasta a `ef_secret_key` |
| `09` | `core.trigger_city_correction_monitor` | idem, sem cron que a use |
| `09` | `core.automated_storage_cleanup`, `core.cleanup_audit_logs`, `drive.cleanup_expired_caches`, `drive.cleanup_old_email_logs`, `drive.cleanup_old_fcm_tokens` | perda de histórico e de trilha de auditoria |

Verificação antes de escrever a `09`: os 35 jobs de `cron.job` rodam como `postgres`, que mantém
`EXECUTE`; e `grep` nos três repos não achou **nenhum** chamador de cliente para as nove.

## O que NÃO foi revogado, de propósito

**`core.replace_trigger_points_atomic`.** Tem autorização no próprio corpo (#128), o CMS a chama
autenticado como `authenticated`, e revogar quebraria a tela para tirar uma checagem que já
existe. O comentário dentro dela diz que o `REVOKE` seria a primeira camada — mas nesta base o
chamador legítimo é `authenticated`, então a camada de corpo é a que vale.

**As funções `*_template` de leitura e escrita** (`get/create/update`, em `core` e `marketing`).
Continuam abertas a `authenticated`. São chamadas pelo CMS, o dano é template interno, e nenhum
turista é alcançado. Fica como achado, não como card — §4.

## Ação destrutiva pendente — o operador executa (§3)

Duas funções órfãs, nenhuma em cron e nenhuma em código cliente. **Ambas foram revogadas na `09`,
então já não são alcançáveis**; o `DROP` é higiene, não urgência.

```sql
-- Confirme que continuam órfãs antes de executar:
SELECT count(*) FROM cron.job WHERE command ILIKE '%trigger_daily_fomo_orchestrator%';  -- espera 0
SELECT count(*) FROM cron.job WHERE command ILIKE '%trigger_city_correction_monitor%';  -- espera 0

DROP FUNCTION core.trigger_daily_fomo_orchestrator();
DROP FUNCTION core.trigger_city_correction_monitor();
```

**Impacto:** nenhum caminho de execução perde função. `core.trigger_daily_fomo_orchestrator` é a
segunda implementação de `drive.trigger_fomo_orchestrator`, que é a que o job
`fomo-hourly-push-orchestrator` (jobid 31) roda de hora em hora.

**Rollback:** o `pg_get_functiondef` das duas, tirado **antes** do `DROP`. Guarde a saída — o
banco está à frente das migrations, e o corpo do arquivo não é o corpo do banco.

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core'
  AND p.proname IN ('trigger_daily_fomo_orchestrator','trigger_city_correction_monitor');
```

## Uma mentira recorrente no banco, que já custou um defeito

Várias funções dizem `SERVICE_ROLE_KEY` na mensagem de `RAISE` enquanto leem `ef_secret_key` na
linha de cima — os dois orquestradores de FOMO fazem exatamente isso. Foi essa mentira que fez a
primeira versão de `isOwnMachineKey` aceitar a chave legada, aberta em produção, sem chamador
nenhum que precisasse dela.

**O Vault deste projeto tem duas entradas: `ef_secret_key` e `SUPABASE_URL`.** Não existe
`SERVICE_ROLE_KEY` nele. Qualquer função que ainda leia aquele nome resolve chave nula e já não
está enviando nada hoje. Confira no banco, nunca no arquivo de migration.
