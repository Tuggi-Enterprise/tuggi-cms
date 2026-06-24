# Spec: Vincular App User a Client (QR de parceiro para hotéis, restaurantes, etc.)

**Status:** pronto para implementação
**Repo:** tuggi-cms (Next.js 16 App Router + Supabase)
**Autor:** definição de produto/arquitetura — feature "QR de parceiro"
**Data:** 2026-06-24

---

## 1. Objetivo

Permitir que um **admin do CMS** vincule um ou mais **usuários do app** (mobile) a um **client**
(`core.clients` — hotel, restaurante, influencer, motorista, business). Uma vez vinculado, o app do
usuário passa a exibir, no Passaporte, o **QR Code daquele client** (`https://tuggi.app/d/<slug>`), que
passageiros/hóspedes/clientes escaneiam para baixar o app — gerando atribuição e revenue share para o
client.

Hoje o app **já consome** esse vínculo, mas **não existe nenhuma interface/rota no CMS para criá-lo**.
Esta spec descreve o que falta construir.

---

## 2. Contexto e modelo de dados (já existente — NÃO precisa criar)

O vínculo é a coluna **`drive.profiles.client_id`** (FK → `core.clients(id)`, `ON DELETE SET NULL`),
criada na migration `tuggi-drive-v2/supabase/migrations/20260624120300_profiles_client_id.sql`.

- **Cardinalidade:** N usuários : 1 client. Vários perfis podem ter o mesmo `client_id` (ex.: equipe de
  um hotel). Cada perfil pertence a **no máximo um** client (coluna única, não-array).
- **Índice:** `idx_profiles_client_id`.
- O RPC `drive.get_user_profile_v1` já resolve o objeto `owned_client`
  (`{ is_client, client_type, slug, qr_url, client_id }`) a partir de `profiles.client_id`. **Nenhuma
  mudança de RPC é necessária** — basta popular a coluna.

### 2.1. ⚠️ Não confundir com o vínculo de CMS user (já existente)

O CMS **já** tem a aba **"Team"** (`components/admin/clients/tabs/TeamTab.tsx` +
`app/api/admin/users/[userId]/link-client/route.ts`) que vincula **`core.cms_users`** a clients via a
junção `core.client_cms_users`. **Isso é outra coisa** — são logins do portal/CMS, não usuários do app.

| Conceito | Tabela | Identidade | Para o QR do app? |
|---|---|---|---|
| CMS user → client (já existe) | `core.client_cms_users` | `core.cms_users` | ❌ Não |
| **App user → client (esta spec)** | **`drive.profiles.client_id`** | `auth.users` / `drive.profiles` | ✅ Sim |

Não reutilizar a rota `link-client` nem `client_cms_users` para isto.

---

## 3. Escopo

1. **Backend (rota):** endpoint admin para definir/limpar `drive.profiles.client_id` de um app user.
2. **UI (modal do app user):** seção "Client vinculado" no `UserDetailModal` para escolher/remover o client.
3. **(Opcional, fase 2):** aba "Equipe (app)" no `ClientEditorModal` listando/gerenciando os app users
   vinculados a um client.

---

## 4. Backend — endpoint

### Opção recomendada: rota dedicada
**Criar:** `app/api/admin/users/[userId]/client/route.ts`

Seguir **exatamente** o padrão de `app/api/admin/users/[userId]/subscription/route.ts`:
- Auth: validar sessão e `cmsUser.role === 'admin'` (mesmo gate; retornar `403` caso contrário).
- Escrita via **service role** (`getSupabaseService()` de `@/lib/core/supabase-client`) para passar o RLS
  de `drive.profiles`.
- Auditoria: `logAuditEvent(...)` de `@/lib/services/audit-service` (como a rota de subscription faz).

#### `PATCH /api/admin/users/[userId]/client`
Define ou remove o vínculo do app user.

Request body:
```json
{ "client_id": "<uuid|null>" }
```
- `client_id` = UUID de `core.clients` → vincula.
- `client_id = null` → desvincula (seta `drive.profiles.client_id = NULL`).

Lógica:
1. Gate admin.
2. Se `client_id` não for null: validar que existe em `core.clients` (`select id from core.clients where id = client_id`); se não existir → `400 { error: 'client_not_found' }`.
3. `getSupabaseService().schema('drive').from('profiles').update({ client_id }).eq('id', userId)`.
4. `logAuditEvent` (ator = cms_user, ação = `app_user_client_linked` / `_unlinked`, alvo = userId, metadata = `{ client_id }`).
5. Resposta `200 { success: true, client_id }`. Erros: `401` (sem sessão), `403` (não-admin), `400` (client inexistente), `500`.

> Alternativa aceitável: estender o PATCH de `.../subscription/route.ts` para também aceitar `client_id`.
> Preferimos rota dedicada por clareza/escopo, mas se o time preferir consolidar, o padrão é o mesmo.

---

## 5. UI — seção no modal de detalhe do app user

**Arquivo:** `app/[locale]/users/app/page.tsx` → componente `UserDetailModal`.

Adicionar uma seção **"Client vinculado"** (sugestão: logo após o bloco de assinatura). Comportamento:

- Mostrar o client atual do usuário (nome + tipo + slug), lido de `drive.profiles.client_id`.
  - O endpoint de detalhe atual (`core.dashboard_user_detail` / a rota que alimenta o modal) precisa
    **retornar `client_id`** (e idealmente nome/tipo/slug do client). Se ainda não retornar, incluir um
    JOIN `core.clients` por `profiles.client_id` no RPC/consulta que monta o detalhe. **Verificar e ajustar.**
- Um **select com busca de clients** para escolher/trocar o vínculo. Reaproveitar o padrão de busca/seleção
  de client já usado na aba Team (`components/admin/clients/tabs/TeamTab.tsx`) e/ou o `ClientService` que
  lista clients.
- Botão **"Salvar"** → `PATCH /api/admin/users/[userId]/client` com `{ client_id }`.
- Botão **"Remover vínculo"** → mesmo PATCH com `{ client_id: null }`.
- UX de loading/erro/sucesso igual ao bloco de edição de assinatura do mesmo modal.

---

## 6. (Opcional — Fase 2) Aba "Equipe (app)" no editor de client

**Arquivo:** novo tab em `components/admin/clients/ClientEditorModal.tsx` (espelhar `TeamTab.tsx`, mas para
app users).

- Listar app users com `drive.profiles.client_id = <este client>` (nova consulta/rota:
  `GET /api/clients/[clientId]/app-users`).
- Vincular/desvincular reutilizando o `PATCH /api/admin/users/[userId]/client`.
- Benefício: o operador vê e gerencia a "equipe" do hotel num só lugar.

---

## 7. Regras de negócio e edge cases

1. **N:1:** vários app users podem apontar para o mesmo client. Não há limite por client. Não criar
   constraint de unicidade em `profiles.client_id`.
2. **1 client por usuário:** a coluna é única (não-array). Vincular a um novo client **substitui** o
   anterior (a UI deve deixar isso claro: "Este usuário já está vinculado a X — substituir por Y?").
3. **Motorista self-service:** o RPC `register_professional_driver_v1` também grava `profiles.client_id`.
   Se um usuário já é motorista (tem `client_id` do próprio client driver), vincular a um hotel pelo CMS
   **sobrescreve** o vínculo (passa a apontar para o hotel). Decisão de produto: aceitável (1 client por
   usuário). A UI deve avisar.
4. **`ON DELETE SET NULL`:** se o client for deletado, `profiles.client_id` vira null automaticamente
   (usuário perde o QR). Esperado.
5. **Não exige assinatura:** vincular a um client **não** concede Pro. O comp de 90 dias é exclusivo do
   fluxo de motorista (RPC). Hotéis/etc. recebem só o QR. (Se no futuro quiserem conceder Pro à equipe,
   é outra feature.)
6. **Slug obrigatório:** todo client tem `slug` (trigger `core.ensure_client_slug`), então o `qr_url`
   sempre resolve. Não há caso de client sem slug.

---

## 8. Segurança / RLS

- Apenas **admin** (`core.cms_users.role = 'admin'`) pode vincular/desvincular.
- A escrita em `drive.profiles` deve usar **service role** (bypassa RLS), igual à rota de subscription.
  Nunca expor escrita de `profiles.client_id` ao cliente/anon.
- Registrar **audit log** em toda mutação.

---

## 9. Critérios de aceite

1. Admin abre o modal de um app user, vê a seção "Client vinculado" (vazia ou com o client atual).
2. Admin seleciona um client e salva → `drive.profiles.client_id` é atualizado; o modal reflete o novo
   client.
3. No **app** daquele usuário, ao recarregar o perfil (`get_user_profile_v1`), o Passaporte passa a
   mostrar **"Meu QR Code"** apontando para `https://tuggi.app/d/<slug-do-client>`.
4. Vincular um 2º (e 3º) app user ao **mesmo** client funciona (N:1) — todos mostram o mesmo QR.
5. "Remover vínculo" zera `client_id`; o item de QR some do Passaporte (volta a aparecer o CTA de
   cadastro de motorista).
6. Não-admin recebe `403`. `client_id` inexistente recebe `400`.
7. Toda mutação gera audit log.

---

## 10. Fora de escopo

- Conceder assinatura/Pro à equipe de um client (feature separada).
- Permitir 1 usuário em múltiplos clients (decisão: 1 client por usuário; exigiria tabela de junção).
- Auto-vínculo/convite pelo próprio usuário no app (esta spec é admin-only no CMS).

---

## 11. Arquivos de referência (no tuggi-cms)

| Para que | Arquivo |
|---|---|
| Padrão de rota admin escrevendo em `drive.profiles` (service role + audit + gate) | `app/api/admin/users/[userId]/subscription/route.ts` |
| Helper service role | `lib/core/supabase-client.ts` (`getSupabaseService`) |
| Helper de auditoria | `lib/services/audit-service.ts` (`logAuditEvent`) |
| Modal de detalhe do app user (onde adicionar a UI) | `app/[locale]/users/app/page.tsx` (`UserDetailModal`) |
| Padrão de seleção de client (copiar) | `components/admin/clients/tabs/TeamTab.tsx` |
| Editor de client (para a aba opcional fase 2) | `components/admin/clients/ClientEditorModal.tsx` |
| Schema do vínculo (FK) | `tuggi-drive-v2/supabase/migrations/20260624120300_profiles_client_id.sql` |
| RPC que consome o vínculo (já pronto) | `drive.get_user_profile_v1` (mesma migration) |

---

## 12. Notas de implementação

- O RPC de detalhe que alimenta o `UserDetailModal` (`core.dashboard_user_detail`) provavelmente **não
  retorna `client_id` hoje** — confirmar e, se necessário, incluir `profiles.client_id` + um JOIN em
  `core.clients` para exibir nome/tipo/slug do client vinculado. (É a única possível mudança de
  RPC; a escrita em si não precisa de RPC novo.)
- Reaproveitar 100% o gate de admin e o `logAuditEvent` da rota de subscription — não reinventar auth.
